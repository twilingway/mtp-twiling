import type {
  CloudClientMode,
  CloudSelection,
  CloudSyncProvider,
  CloudSyncStatus
} from "../../model/cloud-sync.js";
import type {
  CloudOperationGuard,
  CloudSyncHost
} from "../../screens/terminal/controller-cloud-host.js";
import { YandexAuth } from "./auth.js";
import { YandexJournal, yandexWriterLock } from "./journal.js";
import type { YandexRemote } from "./revisions.js";
import { YandexTransport } from "./transport.js";
import { hasYandexConfig, validateYandexConfig, YandexError } from "./types.js";
import { runYandexSyntheticProbe } from "./probe.js";
import * as yandexStatus from "./coordinator-status.js";
import type { YandexStatusClear } from "./coordinator-status.js";
import { yandexTransfer } from "./coordinator-transfer.js";
import { YandexPreview } from "./coordinator-preview.js";
import { YandexScheduler } from "./coordinator-scheduler.js";
import * as yandexPublishing from "./coordinator-publish.js";
import type { YandexAuthorization, YandexPublicConfig } from "./types.js";
import type { YandexAuthClient, YandexCoordinatorOptions } from "./coordinator-options.js";
import {
  initialYandexClientStatus,
  yandexClientStatus,
  yandexPreparedClientStatus,
  yandexClientPreferences,
  yandexIdentityOperation,
  yandexClientSettingsLock,
  YandexClientIdentity
} from "./coordinator-identity.js";
export class YandexCoordinator implements CloudSyncProvider {
  readonly id = "yandex-disk" as const;
  private readonly listeners = new Set<() => void>();
  private readonly auth: YandexAuthClient;
  private readonly journal: YandexJournal;
  private readonly transportFactory: NonNullable<YandexCoordinatorOptions["transport"]>;
  private readonly lock: typeof yandexWriterLock;
  private authorization: YandexAuthorization | undefined;
  private operation: AbortController | undefined;
  private preparation: Promise<void> | undefined;
  private restoration: { epoch: number; promise: Promise<void> } | undefined;
  private settingsIntent = 0;
  private desiredEnabled: boolean | undefined;
  private desiredAutomatic: boolean | undefined;
  private readonly identity = new YandexClientIdentity();
  private readonly remoteCache = new Map<string, YandexRemote>();
  private epoch = 0;
  private disposed = false;
  private readonly scheduler = new YandexScheduler();
  private scopeSession: unknown;
  private readonly preview = new YandexPreview();
  private appliedReceipt: { operationId: string; targetId: string; revision: number } | undefined;
  private status: CloudSyncStatus;
  constructor(
    private readonly host: CloudSyncHost,
    private readonly config: YandexPublicConfig | undefined,
    options: YandexCoordinatorOptions = {}
  ) {
    this.auth = options.auth ?? new YandexAuth(config);
    this.journal = options.journal ?? new YandexJournal();
    this.transportFactory =
      options.transport ?? ((authorization) => new YandexTransport(authorization));
    this.lock = options.lock ?? yandexWriterLock;
    this.status = initialYandexClientStatus(hasYandexConfig(config));
  }
  getSnapshot = (): CloudSyncStatus => this.status;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<CloudSyncStatus>, clear: readonly YandexStatusClear[] = []): void {
    if (this.disposed) return;
    const next = { ...this.status, ...patch };
    for (const key of clear) delete next[key];
    if (!next.enabled) {
      next.phase = "disabled";
      for (const key of [
        "error",
        "pauseReason",
        "conflict",
        "choiceAction",
        "progress",
        "comparison"
      ] as const)
        delete next[key];
    }
    this.status = Object.freeze(next);
    for (const listener of this.listeners) listener();
  }
  prepare = (): Promise<void> => {
    if (this.preparation) return this.preparation;
    if (this.status.prepared || this.disposed) return Promise.resolve();
    this.preparation = this.prepareInner().finally(() => {
      this.preparation = undefined;
    });
    return this.preparation;
  };
  private async prepareInner(): Promise<void> {
    this.update({ preparing: true });
    const epoch = this.epoch;
    try {
      const settings = await this.journal.settings();
      if (this.disposed || epoch !== this.epoch) return;
      if (this.settingsIntent > 0) {
        const mode = this.identity.desiredMode ?? settings.clientMode ?? this.status.clientMode;
        this.update(yandexPreparedClientStatus(settings, this.desiredAutomatic, mode));
        return;
      }
      this.update({
        ...settings,
        ...yandexClientStatus(settings.clientMode ?? this.status.clientMode ?? "normal"),
        prepared: true,
        preparing: false,
        phase: settings.enabled ? "disconnected" : "disabled"
      });
      if (!settings.enabled) return;
      await this.restoreAuthorization();
    } catch (error) {
      if (epoch === this.epoch) {
        this.update({ prepared: true, preparing: false });
        this.failure(error);
      }
    }
  }
  private restoreAuthorization(): Promise<void> {
    if (this.restoration?.epoch === this.epoch) return this.restoration.promise;
    const previous = this.restoration?.promise ?? Promise.resolve(),
      epoch = this.epoch;
    const promise = previous
      .catch(() => undefined)
      .then(async () => {
        if (epoch === this.epoch) await this.restoreAuthorizationInner();
      })
      .finally(() => {
        if (this.restoration?.promise === promise) this.restoration = undefined;
      });
    this.restoration = { epoch, promise };
    return promise;
  }
  private async restoreAuthorizationInner(): Promise<void> {
    if (!this.status.enabled || this.disposed) return;
    if (!this.status.configured) {
      this.update({
        phase: "disconnected",
        pauseReason: "configuration-required",
        error: "configuration-required"
      });
      return;
    }
    const scope = this.host.scope(this.id);
    if (!scope.ready) return;
    const epoch = this.epoch;
    const authorization = (await this.auth.completeCallback()) ?? (await this.auth.restore());
    if (this.disposed || !this.status.enabled || epoch !== this.epoch) return;
    this.scopeSession = scope.session;
    if (!authorization) {
      this.update({ phase: "disconnected", connected: false });
      return;
    }
    this.remoteCache.clear();
    this.authorization = authorization;
    this.update(
      {
        connected: true,
        phase: "idle",
        authorizationStored: authorization.stored,
        credentialSaveError: authorization.persistenceError
      },
      ["error", "pauseReason", "comparison"]
    );
    this.resume();
  }
  setEnabled = async (enabled: boolean): Promise<void> => {
    const intent = ++this.settingsIntent;
    this.desiredEnabled = enabled;
    if (!enabled) {
      this.cancel(true);
      this.update({
        enabled: false,
        connected: false,
        authorizationStored: false,
        credentialSaveError: false
      });
    }
    await this.commitPreferences(intent);
  };
  setAutomatic = async (automatic: boolean): Promise<void> => {
    const intent = ++this.settingsIntent;
    this.desiredAutomatic = automatic;
    if (!automatic) this.scheduler.clear();
    await this.commitPreferences(intent);
  };
  setClientMode = (mode: CloudClientMode): Promise<void> =>
    this.identity.change(mode, {
      prepare: this.prepare,
      current: () => !this.disposed,
      busy: () => !!this.operation,
      status: () => this.status,
      journal: this.journal,
      clientId: this.config?.clientId,
      accountId: () => this.authorization?.accountId,
      serialize: (run) =>
        this.authorization ? this.lock(this.authorization, run) : yandexClientSettingsLock(run),
      save: () => this.commitPreferences(++this.settingsIntent)
    });
  private async commitPreferences(intent: number): Promise<void> {
    await this.prepare();
    if (this.disposed || intent !== this.settingsIntent) return;
    const settings = {
      enabled: this.desiredEnabled ?? this.status.enabled,
      automatic: this.desiredAutomatic ?? this.status.automatic,
      clientMode: this.identity.desiredMode ?? this.status.clientMode ?? "normal"
    };
    await this.identity.save(this.journal, settings);
    if (this.disposed || intent !== this.settingsIntent) return;
    const { changedMode, patch, clear } = yandexClientPreferences(this.status, settings);
    if (changedMode) {
      this.epoch++;
      this.scheduler.clear();
      this.preview.clear();
      this.remoteCache.clear();
    }
    this.update(patch, clear);
    if (settings.enabled && !this.authorization && !changedMode) {
      try {
        await this.restoreAuthorization();
      } catch (error) {
        this.failure(error);
      }
    } else if (settings.automatic && !changedMode) this.resume();
  }
  connectFromUserGesture = async (): Promise<void> => {
    await this.prepare();
    if (!this.status.enabled) await this.setEnabled(true);
    if (!this.status.enabled || this.disposed) return;
    try {
      validateYandexConfig(this.config);
      if (!this.host.scope(this.id).ready) throw new YandexError("not-ready");
      this.cancel();
      this.update({ phase: "connecting", connected: false }, ["error", "pauseReason", "conflict"]);
      await this.auth.begin();
    } catch (error) {
      this.failure(error);
    }
  };
  disconnect = async (): Promise<void> => {
    const generation = this.authorization?.credentialGeneration;
    let failure: unknown;
    try {
      await this.setEnabled(false);
    } catch (error) {
      failure = error;
    }
    try {
      await this.auth.disconnect(generation);
    } catch {
      failure ??= new YandexError("local-save");
    }
    if (failure) throw failure instanceof Error ? failure : new YandexError("local-save");
  };
  profileChanged = (): void => {
    const scope = this.host.scope(this.id);
    if (this.authorization && (!scope.ready || scope.session !== this.scopeSession)) {
      this.cancel();
      this.update({ connected: false, phase: "disconnected" });
    }
    if (this.status.enabled && !this.authorization && scope.ready && this.status.prepared)
      void this.restoreAuthorization().catch((error: unknown) => this.failure(error));
  };
  localIntent = (): void => {
    this.preview.clear();
    this.update({ pendingChanges: true }, ["comparison"]);
  };
  localChanged = (): void => {
    this.localIntent();
    this.resume();
  };
  resume = (): void => {
    this.scheduler.clear();
    if (!this.status.prepared) {
      void this.prepare();
      return;
    }
    if (
      !this.status.enabled ||
      !this.status.automatic ||
      !this.authorization ||
      !this.host.scope(this.id).ready ||
      this.host.scope(this.id).blocked ||
      this.status.conflict ||
      this.status.error === "indeterminate"
    )
      return;
    this.scheduler.schedule(
      () => this.sync(),
      () => !!this.operation
    );
  };
  sync = (): Promise<void> => this.run();
  inspect = (): Promise<void> => this.run(undefined, true);
  receive = (id: string): Promise<void> => this.choose({ kind: "remote", id });
  runSyntheticProbe = async (cleanup = false) => {
    const authorization = this.authorization,
      epoch = this.epoch;
    if (!this.status.enabled || !authorization || this.disposed)
      throw new YandexError("auth-required");
    if (this.operation) throw new YandexError("busy");
    const result = await this.lock(authorization, () =>
      runYandexSyntheticProbe(authorization, {}, cleanup)
    );
    if (epoch !== this.epoch || !this.status.enabled) throw new YandexError("auth-cancelled");
    return result;
  };
  choose = (selection: CloudSelection): Promise<void> => this.run(selection);
  private async run(selection?: CloudSelection, inspectionOnly = false): Promise<void> {
    if (!this.status.enabled || this.disposed || this.operation || this.identity.changing) return;
    const auth = this.authorization;
    if (!auth || !this.config) {
      this.failure(new YandexError("auth-required"));
      return;
    }
    const operation = new AbortController();
    this.operation = operation;
    const epoch = this.epoch;
    const { guard, session, scopedAuth, revisions, checkClientMode } = yandexIdentityOperation({
      host: this.host,
      auth,
      operation,
      current: () =>
        !this.disposed &&
        this.status.enabled &&
        epoch === this.epoch &&
        this.authorization === auth,
      transport: this.transportFactory,
      journal: this.journal,
      clientId: this.config.clientId,
      cache: this.remoteCache,
      clientMode: this.status.clientMode ?? "normal"
    });
    const previousPhase = this.status.phase;
    this.update(
      {
        phase: "syncing",
        progress: { stage: "inspect" },
        ...(selection ? { choiceAction: { selection, state: "running" as const } } : {})
      },
      inspectionOnly ? ["comparison"] : ["error", "pauseReason"]
    );
    try {
      auth.getAccessToken();
      await this.lock(scopedAuth, async () => {
        await checkClientMode();
        return yandexTransfer(
          this.host,
          revisions,
          this.journal,
          this.config!.clientId,
          auth.accountId,
          guard,
          {
            preview: () => ({
              revision:
                selection?.kind === "remote" && this.appliedReceipt?.targetId === selection.id
                  ? this.appliedReceipt.revision
                  : this.preview.revision,
              heads: this.preview.heads,
              remoteFingerprint: this.preview.remoteFingerprint
            }),
            publish: (captured, heads, explicit, beforeEffect) =>
              yandexPublishing.publishYandexSnapshot(
                revisions,
                captured,
                heads,
                guard,
                explicit,
                this.journal,
                this.config!.clientId,
                auth.accountId,
                (accepted, digest, expected) => this.accept(accepted, digest, guard, expected),
                (stage) => this.update({ progress: { stage } }),
                () => this.host.scope(this.id).revision,
                beforeEffect,
                (retention) => this.update({ retention })
              ),
            accept: (heads, digest, expected) => this.accept(heads, digest, guard, expected),
            committed: (intent, revision) => {
              this.appliedReceipt = {
                operationId: intent.operationId,
                targetId: intent.targetId,
                revision
              };
            },
            committedRevision: (id) =>
              this.appliedReceipt?.operationId === id ? this.appliedReceipt.revision : undefined,
            clearCommitted: (id) => {
              if (this.appliedReceipt?.operationId === id) this.appliedReceipt = undefined;
            },
            applying: () => this.update({ progress: { stage: "apply" } }),
            unchanged: (association, revision) =>
              yandexPublishing.unchangedYandexSnapshot(
                revisions,
                association,
                guard,
                revision,
                () => this.host.scope(this.id).revision,
                this.update.bind(this)
              ),
            inspected: (captured, remotes, heads, review) => {
              const comparison = this.preview.capture(
                captured,
                remotes,
                heads,
                new Date().toISOString()
              );
              this.update(yandexStatus.yandexInspectionStatus(comparison, previousPhase, review), [
                "progress"
              ]);
            },
            conflict: (captured, remotes, heads) => {
              const comparison = this.preview.capture(
                captured,
                remotes,
                heads,
                new Date().toISOString()
              );
              this.update(
                {
                  phase: "conflict",
                  comparison,
                  conflict: { local: comparison.local, remotes: comparison.remotes }
                },
                ["progress", "choiceAction"]
              );
            }
          },
          selection,
          inspectionOnly
        );
      });
    } catch (error) {
      if (
        !this.disposed &&
        this.status.enabled &&
        epoch === this.epoch &&
        !operation.signal.aborted &&
        this.host.scope(this.id).session === session
      )
        this.failure(error, selection);
    } finally {
      if (this.operation === operation) this.operation = undefined;
      this.scheduler.complete(this.resume);
    }
  }
  private async accept(
    heads: readonly string[],
    digest: string,
    guard: CloudOperationGuard,
    expectedRevision: number
  ): Promise<void> {
    guard.signal.throwIfAborted();
    if (!guard.isCurrent() || this.host.scope(this.id).revision !== expectedRevision)
      throw new YandexError("local-changed");
    const syncedAt = new Date().toISOString();
    await this.journal.accept(
      this.config!.clientId,
      { version: 1, accountId: this.authorization!.accountId, heads, digest, syncedAt },
      guard.signal
    );
    guard.signal.throwIfAborted();
    if (!guard.isCurrent() || this.host.scope(this.id).revision !== expectedRevision)
      throw new YandexError("local-changed");
    const accepted = yandexStatus.yandexAcceptedStatus(this.status, heads, syncedAt);
    this.preview.clear();
    this.update(accepted.patch, accepted.clear);
  }
  private failure(error: unknown, selection?: CloudSelection): void {
    if (!this.status.enabled || this.disposed) return;
    this.update(yandexStatus.yandexFailureStatus(error, selection), ["progress"]);
  }
  private cancel(cancelAttempt = false): void {
    this.epoch++;
    this.scheduler.clear();
    this.operation?.abort();
    this.auth.suspend(cancelAttempt);
    this.authorization = undefined;
    this.preview.clear();
    this.appliedReceipt = undefined;
    this.remoteCache.clear();
    this.update({}, ["comparison"]);
  }
  dispose = (): void => {
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
  };
}
