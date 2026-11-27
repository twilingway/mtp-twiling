import type { CloudSelection, CloudSyncProvider, CloudSyncStatus } from "../../model/cloud-sync.js";
import type {
  CloudOperationGuard,
  CloudPreparedSnapshot,
  CloudSyncHost
} from "../../screens/terminal/controller-cloud-host.js";
import { YandexAuth } from "./auth.js";
import { YandexJournal, yandexWriterLock } from "./journal.js";
import { YandexRevisions } from "./revisions.js";
import type { YandexRemote } from "./revisions.js";
import { YandexTransport } from "./transport.js";
import { hasYandexConfig, validateYandexConfig, YandexError } from "./types.js";
import { runYandexSyntheticProbe } from "./probe.js";
import { yandexFailureStatus } from "./coordinator-status.js";
import { backupSummary, sameHeads, yandexTransfer } from "./coordinator-transfer.js";
import type { YandexAuthorization, YandexPublicConfig } from "./types.js";
import type { YandexAuthClient, YandexCoordinatorOptions } from "./coordinator-options.js";
type ClearKey = "error" | "pauseReason" | "conflict" | "choiceAction" | "progress";
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
  private settingsQueue = Promise.resolve();
  private settingsIntent = 0;
  private desiredEnabled: boolean | undefined;
  private desiredAutomatic: boolean | undefined;
  private readonly remoteCache = new Map<string, YandexRemote>();
  private epoch = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scopeSession: unknown;
  private previewRevision: number | undefined;
  private previewHeads: readonly string[] = [];
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
    const configured = hasYandexConfig(config);
    this.status = Object.freeze({
      provider: this.id,
      enabled: false,
      configured,
      prepared: false,
      preparing: false,
      connected: false,
      automatic: false,
      phase: "disabled",
      pendingChanges: false,
      authorizationStored: false,
      credentialSaveError: false
    });
  }
  getSnapshot = (): CloudSyncStatus => this.status;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<CloudSyncStatus>, clear: readonly ClearKey[] = []): void {
    if (this.disposed) return;
    const next = { ...this.status, ...patch };
    for (const key of clear) delete next[key];
    if (!next.enabled) {
      next.phase = "disabled";
      for (const key of ["error", "pauseReason", "conflict", "choiceAction", "progress"] as const)
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
        this.update({
          prepared: true,
          preparing: false,
          automatic: this.desiredAutomatic ?? settings.automatic
        });
        return;
      }
      this.update({
        ...settings,
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
      ["error", "pauseReason"]
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
    if (!automatic) clearTimeout(this.timer);
    await this.commitPreferences(intent);
  };
  private async commitPreferences(intent: number): Promise<void> {
    await this.prepare();
    if (this.disposed || intent !== this.settingsIntent) return;
    const settings = {
      enabled: this.desiredEnabled ?? this.status.enabled,
      automatic: this.desiredAutomatic ?? this.status.automatic
    };
    this.settingsQueue = this.settingsQueue
      .catch(() => undefined)
      .then(() => this.journal.saveSettings(settings, new AbortController().signal));
    try {
      await this.settingsQueue;
    } catch {
      throw new YandexError("local-save");
    }
    if (this.disposed || intent !== this.settingsIntent) return;
    const unchangedEnabled = settings.enabled === this.status.enabled;
    this.update(
      {
        ...settings,
        prepared: true,
        preparing: false,
        ...(!unchangedEnabled
          ? { phase: settings.enabled ? ("disconnected" as const) : ("disabled" as const) }
          : {})
      },
      unchangedEnabled ? [] : ["error", "pauseReason", "conflict", "choiceAction", "progress"]
    );
    if (settings.enabled && !this.authorization) {
      try {
        await this.restoreAuthorization();
      } catch (error) {
        this.failure(error);
      }
    } else if (settings.automatic) this.resume();
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
  localIntent = (): void => this.update({ pendingChanges: true });
  localChanged = (): void => {
    this.localIntent();
    this.resume();
  };
  resume = (): void => {
    clearTimeout(this.timer);
    if (!this.status.prepared) {
      void this.prepare();
      return;
    }
    if (
      !this.status.enabled ||
      !this.status.automatic ||
      !this.authorization ||
      this.operation ||
      !this.host.scope(this.id).ready ||
      this.host.scope(this.id).blocked ||
      this.status.conflict ||
      this.status.error === "indeterminate"
    )
      return;
    this.timer = setTimeout(() => {
      void this.sync();
    }, 750);
  };
  sync = (): Promise<void> => this.run();
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
  choose = async (selection: CloudSelection): Promise<void> => {
    if (
      selection.kind === "remote" &&
      this.appliedReceipt?.targetId !== selection.id &&
      (!this.status.conflict || this.previewRevision !== this.host.scope(this.id).revision)
    ) {
      this.failure(new YandexError("local-changed"));
      return;
    }
    await this.run(selection);
  };
  private async run(selection?: CloudSelection): Promise<void> {
    if (!this.status.enabled || this.disposed || this.operation) return;
    const auth = this.authorization;
    if (!auth || !this.config) {
      this.failure(new YandexError("auth-required"));
      return;
    }
    const operation = new AbortController();
    this.operation = operation;
    const epoch = this.epoch,
      session = this.host.scope(this.id).session;
    const guard: CloudOperationGuard = {
      signal: AbortSignal.any([operation.signal, auth.signal]),
      isCurrent: () =>
        !this.disposed &&
        this.status.enabled &&
        epoch === this.epoch &&
        this.authorization === auth &&
        this.host.scope(this.id).ready &&
        this.host.scope(this.id).session === session
    };
    // Transport shares the operation signal; disabling aborts bodies, retries and queued locks.
    const scopedAuth: YandexAuthorization = { ...auth, signal: guard.signal },
      revisions = new YandexRevisions(
        this.transportFactory(scopedAuth),
        this.journal,
        scopedAuth,
        this.config.clientId,
        this.remoteCache
      );
    this.update(
      {
        phase: "syncing",
        progress: { stage: "inspect" },
        ...(selection ? { choiceAction: { selection, state: "running" as const } } : {})
      },
      ["error", "pauseReason"]
    );
    try {
      auth.getAccessToken();
      await this.lock(scopedAuth, () =>
        yandexTransfer(
          this.host,
          revisions,
          this.journal,
          this.config!.clientId,
          auth.accountId,
          guard,
          {
            preview: () => ({
              revision: this.previewRevision,
              heads: this.previewHeads
            }),
            publish: (captured, heads, explicit) =>
              this.publish(revisions, captured, heads, guard, explicit),
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
            unchanged: (association) =>
              this.update(
                { phase: "idle", pendingChanges: false, lastSyncedAt: association.syncedAt },
                ["conflict", "progress"]
              ),
            conflict: (captured, remotes, heads) => {
              this.previewRevision = captured.revision;
              this.previewHeads = heads;
              this.update(
                {
                  phase: "conflict",
                  conflict: {
                    local: backupSummary(captured.backup),
                    remotes: remotes.map(({ remote, summary }) => ({
                      id: remote.revision.revisionId,
                      ...summary
                    }))
                  }
                },
                ["progress", "choiceAction"]
              );
            }
          },
          selection
        )
      );
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
    }
  }
  private async publish(
    revisions: YandexRevisions,
    captured: CloudPreparedSnapshot,
    heads: readonly string[],
    guard: CloudOperationGuard,
    explicit: boolean
  ): Promise<void> {
    this.update({ progress: { stage: "upload" } });
    const revision = await revisions.publish(
      captured.prepared,
      captured.digest,
      heads,
      () => guard.isCurrent(),
      explicit
    );
    this.update({ progress: { stage: "verify" } });
    const after = await revisions.inspect(() => guard.isCurrent());
    if (!sameHeads(after.heads, [revision.revisionId])) throw new YandexError("conflict");
    await this.accept(after.heads, revision.digest, guard, captured.revision);
    await this.journal.clearPending(
      this.config!.clientId,
      this.authorization!.accountId,
      guard.signal
    );
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
    const choiceAction = this.status.choiceAction;
    this.previewRevision = undefined;
    this.update(
      {
        phase: "idle",
        pendingChanges: false,
        lastSyncedAt: syncedAt,
        ...(choiceAction ? { choiceAction: { ...choiceAction, state: "confirmed" as const } } : {})
      },
      ["error", "pauseReason", "conflict", "progress"]
    );
  }
  private failure(error: unknown, selection?: CloudSelection): void {
    if (!this.status.enabled || this.disposed) return;
    this.update(yandexFailureStatus(error, selection), ["progress"]);
  }

  private cancel(cancelAttempt = false): void {
    this.epoch++;
    clearTimeout(this.timer);
    this.operation?.abort();
    this.auth.suspend(cancelAttempt);
    this.authorization = undefined;
    this.previewRevision = undefined;
  }
  dispose = (): void => {
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
  };
}
