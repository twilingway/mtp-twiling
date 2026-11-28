import type {
  CloudClientMode,
  CloudSelection,
  CloudSyncProvider,
  CloudSyncStatus
} from "../../model/cloud-sync.js";
import type { CloudSyncHost } from "../../screens/terminal/controller-cloud-host.js";
import { YandexAuth } from "./auth.js";
import { YandexJournal, yandexWriterLock } from "./journal.js";
import type { YandexRemote } from "./revisions.js";
import { YandexTransport } from "./transport.js";
import { hasYandexConfig, validateYandexConfig, YandexError } from "./types.js";
import { yandexCoordinatorProbe } from "./coordinator-probe.js";
import { yandexSubscribe, yandexUpdatedStatus } from "./coordinator-state.js";
import { yandexSnapshotAcceptor } from "./coordinator-accept.js";
import * as yandexStatus from "./coordinator-status.js";
import type { YandexStatusClear } from "./coordinator-status.js";
import { yandexTransfer } from "./coordinator-transfer.js";
import { YandexPreview } from "./coordinator-preview.js";
import { YandexScheduler } from "./coordinator-scheduler.js";
import { YandexContextBaseline } from "./context-baseline.js";
import { yandexTransferActions } from "./coordinator-actions.js";
import type { YandexReceiptState } from "./coordinator-actions.js";
import { yandexManualDeletion } from "./coordinator-delete.js";
import { yandexMaintenanceTarget } from "./maintenance-journal.js";
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
  private readonly baseline = new YandexContextBaseline();
  private readonly receipts: YandexReceiptState = {};
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
    this.baseline.open(this.journal, config?.clientId, this.host.scope(this.id).revision);
  }
  getSnapshot = (): CloudSyncStatus => this.status;
  subscribe = (listener: () => void): (() => void) => yandexSubscribe(this.listeners, listener);
  private update(patch: Partial<CloudSyncStatus>, clear: readonly YandexStatusClear[] = []): void {
    if (this.disposed) return;
    this.status = yandexUpdatedStatus(this.status, patch, clear);
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
    const durable = await this.journal.association(this.config!.clientId, authorization.accountId);
    if (this.disposed || !this.status.enabled || epoch !== this.epoch) return;
    const association = await this.baseline.restore(
      authorization.accountId,
      durable,
      this.host.scope(this.id).revision
    );
    const maintenance = await this.journal.maintenance(
      this.config!.clientId,
      authorization.accountId
    );
    if (this.disposed || !this.status.enabled || epoch !== this.epoch) return;
    this.remoteCache.clear();
    this.authorization = authorization;
    this.update(
      {
        connected: true,
        phase: "idle",
        authorizationStored: authorization.stored,
        credentialSaveError: authorization.persistenceError,
        ...(association ? { lastSyncedAt: association.syncedAt } : {}),
        ...(maintenance
          ? {
              deleteAction: {
                id: maintenance.plan.remoteId,
                state: "unconfirmed" as const,
                target: yandexMaintenanceTarget(maintenance.plan)
              }
            }
          : {})
      },
      [
        "error",
        "pauseReason",
        "comparison",
        ...(!association ? ["lastSyncedAt" as const] : []),
        ...(!maintenance ? ["deleteAction" as const] : [])
      ]
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
      save: () => this.commitPreferences(++this.settingsIntent, true)
    });
  private async commitPreferences(intent: number, locked = false): Promise<void> {
    await this.prepare();
    if (this.disposed || intent !== this.settingsIntent) return;
    const settings = {
      enabled: this.desiredEnabled ?? this.status.enabled,
      automatic: this.desiredAutomatic ?? this.status.automatic,
      clientMode: this.identity.desiredMode ?? this.status.clientMode ?? "normal"
    };
    const save = () =>
      this.identity.save(this.journal, settings, this.desiredEnabled, this.desiredAutomatic);
    if (locked) await save();
    else if (this.authorization) await this.lock(this.authorization, save);
    else await yandexClientSettingsLock(save);
    if (this.disposed || intent !== this.settingsIntent) return;
    this.desiredEnabled = this.desiredAutomatic = undefined;
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
      () => this.run(undefined, false, true),
      () => !!this.operation
    );
  };
  sync = (): Promise<void> => this.run();
  inspect = (): Promise<void> => this.run(undefined, true);
  receive = (id: string): Promise<void> => this.choose({ kind: "remote", id });
  remove = (id: string): Promise<void> =>
    yandexManualDeletion({
      host: this.host,
      journal: this.journal,
      cache: this.remoteCache,
      preview: this.preview,
      lock: (...args) => this.lock(...args),
      transport: (auth) => this.transportFactory(auth),
      prepare: this.prepare,
      authorization: () => this.authorization,
      clientId: () => this.config?.clientId,
      status: () => this.status,
      epoch: () => this.epoch,
      current: () => !this.disposed,
      busy: () => !!this.operation || this.identity.changing,
      begin: (operation) => {
        this.scheduler.clear();
        this.operation = operation;
      },
      finish: (operation) => {
        if (this.operation === operation) this.operation = undefined;
        this.scheduler.complete(() => {});
      },
      update: (patch, clear) => this.update(patch, clear),
      inspect: this.inspect
    })(id);
  runSyntheticProbe = yandexCoordinatorProbe({
    authorization: () => this.authorization,
    enabled: () => this.status.enabled && !this.disposed,
    busy: () => !!this.operation,
    epoch: () => this.epoch,
    settings: async () => [await this.journal.settings(), this.status.clientMode] as const,
    lock: (auth, run) => this.lock(auth, run)
  });
  choose = (selection: CloudSelection): Promise<void> => this.run(selection);
  private async run(
    selection?: CloudSelection,
    inspectionOnly = false,
    automatic = false
  ): Promise<void> {
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
      clientMode: this.status.clientMode ?? "normal",
      automatic,
      refresh: (settings) =>
        this.update({
          ...settings,
          ...(!settings.enabled ? { connected: false } : {})
        })
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
        if (!(await checkClientMode())) {
          this.update({ phase: previousPhase }, ["progress"]);
          return;
        }
        if (
          !inspectionOnly &&
          (await this.journal.maintenance(this.config!.clientId, auth.accountId))
        )
          throw new YandexError("indeterminate");
        const contextAssociation = await this.baseline.operation(
          this.host,
          guard,
          this.journal,
          this.config!.clientId,
          auth.accountId,
          inspectionOnly || !!selection
        );
        return yandexTransfer(
          this.host,
          revisions,
          this.journal,
          this.config!.clientId,
          auth.accountId,
          guard,
          yandexTransferActions({
            host: this.host,
            revisions,
            journal: this.journal,
            clientId: this.config!.clientId,
            accountId: auth.accountId,
            guard,
            preview: this.preview,
            receipts: this.receipts,
            previousPhase,
            selection,
            accept: this.accept,
            observed: (association, revision) => this.baseline.accepted(association, revision),
            update: this.update.bind(this)
          }),
          selection,
          inspectionOnly,
          contextAssociation
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
  private accept = yandexSnapshotAcceptor({
    journal: () => this.journal,
    clientId: () => this.config!.clientId,
    accountId: () => this.authorization!.accountId,
    revision: () => this.host.scope(this.id).revision,
    status: () => this.status,
    clearPreview: () => this.preview.clear(),
    accepted: (association, revision) => this.baseline.accepted(association, revision),
    update: (patch, clear) => this.update(patch, clear)
  });
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
    this.receipts.applied = undefined;
    this.remoteCache.clear();
    this.update({}, ["comparison"]);
  }
  dispose = (): void => {
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
  };
}
