import type { CloudSelection, CloudSyncProvider } from "../../model/cloud-sync.js";
import type { Backup } from "../../model/types.js";
import { DriveAuth } from "./auth.js";
import { runDriveSlotBinaryProbe } from "./device-slot-binary-probe.js";
import { changed, createDeviceSlotContext, providerId } from "./device-slot-context.js";
import type { GoogleSlotHost, GoogleSlotScope } from "./device-slot-context.js";
import { loadDeviceSlotRecord, saveDeviceSlotRecord } from "./device-slot-local.js";
import type { DeviceSlotRecord } from "./device-slot-local.js";
import {
  connectGoogleSlotTarget,
  loadGoogleSlotTarget,
  matchesGoogleSlotCredential,
  restoreGoogleSlotTarget,
  updateGoogleSlotTarget
} from "./device-slot-link.js";
import type { GoogleSlotTarget } from "./device-slot-link.js";
import { LegacyDeviceSlotMigration } from "./device-slot-migration.js";
import {
  deviceSlotOutcome,
  initialGoogleSlotStatus,
  operationError,
  replacedGoogleAccountStatusKeys,
  stageNames
} from "./device-slot-status.js";
import type { GoogleStatus, GoogleTransientStatusKey } from "./device-slot-status.js";
import {
  chooseDeviceSlotVersion,
  restorePreviousDeviceSlotVersion,
  synchronizeDeviceSlots
} from "./device-slot-sync.js";
import type { SlotPreview, SlotSyncContext, SlotSyncResult } from "./device-slot-sync.js";
import { hasDriveHistory } from "./local.js";
import { advanceDriveProgress, beginDriveProgress, finishDriveProgress } from "./progress.js";
import { DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
export type { GoogleStatus } from "./device-slot-status.js";

export type { GoogleSlotHost } from "./device-slot-context.js";

interface Dependencies {
  auth: Pick<
    DriveAuth,
    "prepare" | "connectFromUserGesture" | "restore" | "suspend" | "forgetOwner"
  >;
  load: typeof loadDeviceSlotRecord;
  save: typeof saveDeviceSlotRecord;
  hasHistory: typeof hasDriveHistory;
  fetch: typeof fetch;
  online(): boolean;
}
type Operation = (context: SlotSyncContext, record: DeviceSlotRecord) => Promise<SlotSyncResult>;

const sameScope = (a: GoogleSlotScope | undefined, b: GoogleSlotScope) =>
  a?.ready === b.ready &&
  a?.cloudOwner === b.cloudOwner &&
  a?.session === b.session &&
  a?.associationConflict === b.associationConflict;

export class GoogleSlotProvider implements CloudSyncProvider {
  readonly id = providerId;
  private state = initialGoogleSlotStatus();
  private readonly listeners = new Set<() => void>();
  private scope: GoogleSlotScope | undefined;
  private target: GoogleSlotTarget | undefined;
  private authorization: DriveAuthorization | undefined;
  private preview: SlotPreview | undefined;
  private readonly migration = new LegacyDeviceSlotMigration();
  private epoch = 0;
  private lifecycle = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private operation: object | undefined;
  private disposed = false;
  private load: Promise<void> | undefined;

  constructor(
    private readonly host: GoogleSlotHost,
    private readonly dependencies: Dependencies = {
      auth: new DriveAuth(),
      load: loadDeviceSlotRecord,
      save: saveDeviceSlotRecord,
      hasHistory: hasDriveHistory,
      fetch: (...args) => fetch(...args),
      online: () => navigator.onLine
    }
  ) {}

  getSnapshot = (): GoogleStatus => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<GoogleStatus>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private reset(enabled = false) {
    this.epoch++;
    this.lifecycle.abort();
    this.lifecycle = new AbortController();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dependencies.auth.suspend();
    this.authorization = undefined;
    this.preview = undefined;
    this.migration.clear();
    this.operation = undefined;
    this.target = undefined;
    this.load = undefined;
    this.state = initialGoogleSlotStatus(enabled);
    this.update({});
  }
  private current(epoch: number): boolean {
    return (
      !this.disposed && this.epoch === epoch && sameScope(this.scope, this.host.scope(providerId))
    );
  }
  private fail(error: unknown, epoch: number) {
    if (!this.current(epoch) || !this.state.enabled) return;
    if (error instanceof DOMException && error.name === "AbortError") {
      this.update({ phase: this.authorization ? "idle" : "disconnected", pendingChanges: true });
      return;
    }
    const code = operationError(error);
    this.update({
      error: code,
      phase: code === "auth-required" ? "auth-required" : "error",
      pendingChanges: true,
      ...(code === "network" ? { pauseReason: "network" as const } : {})
    });
  }

  resume = (): void => this.profileChanged();
  profileChanged = (): void => {
    const next = this.host.scope(providerId);
    if (sameScope(this.scope, next)) {
      if (!next.blocked && this.state.pendingChanges) this.schedule();
      return;
    }
    this.reset();
    this.scope = next;
    if (next.ready) this.load = this.restore(next, this.epoch);
  };
  private async restore(scope: GoogleSlotScope, epoch: number) {
    try {
      const restored = await restoreGoogleSlotTarget(scope, this.dependencies, () =>
        this.current(epoch)
      );
      if (!restored || !this.current(epoch)) return;
      const { target, enabled, authorization } = restored;
      this.target = target;
      if (!enabled) return;
      const { automatic, mode, lastSyncedAt } = target.record;
      this.update({
        enabled,
        automatic,
        mode,
        phase: "disconnected",
        ...(lastSyncedAt ? { lastSyncedAt } : {})
      });
      if (authorization) this.attach(authorization, epoch);
    } catch (error) {
      this.fail(error, epoch);
    }
  }

  private attach(authorization: DriveAuthorization, epoch: number) {
    this.authorization = authorization;
    this.migration.clear();
    this.omit("error", "pauseReason", "archive");
    this.update({
      connected: true,
      phase: "idle",
      authorizationStored: authorization.stored === true,
      credentialSaveError: authorization.persistenceError === true,
      pendingChanges: true,
      uploadProbeBytes: 0
    });
    authorization.signal.addEventListener(
      "abort",
      () => {
        if (!this.current(epoch) || this.authorization !== authorization) return;
        this.authorization = undefined;
        this.migration.clear();
        this.omit("archive", "conflict");
        this.update({
          connected: false,
          phase: this.state.phase === "connecting" ? "connecting" : "auth-required",
          pauseReason: "auth-required",
          uploadProbeBytes: 0
        });
      },
      { once: true }
    );
    this.schedule();
  }
  private schedule() {
    if (
      this.timer ||
      this.operation ||
      !this.authorization ||
      !this.state.enabled ||
      !this.state.automatic ||
      this.host.scope(providerId).blocked ||
      this.state.migrationRequired ||
      this.state.conflict ||
      (this.state.error && this.state.error !== "network")
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sync();
    }, 1000);
  }
  localIntent = (): void => {
    if (!this.state.enabled) return;
    this.preview = undefined;
    this.update({ pendingChanges: true });
  };
  localChanged = (): void => {
    this.localIntent();
    this.schedule();
  };

  prepare = async (): Promise<void> => {
    if (this.load) await this.load;
    if (!this.state.enabled || this.state.preparing || this.state.prepared) return;
    const epoch = this.epoch;
    this.update({ preparing: true });
    try {
      await this.dependencies.auth.prepare();
      if (this.current(epoch)) this.update({ prepared: true });
    } catch (error) {
      this.fail(error, epoch);
    } finally {
      if (this.current(epoch)) this.update({ preparing: false });
    }
  };
  connectFromUserGesture = async (): Promise<void> => {
    const scope = this.scope;
    if (
      !scope ||
      !this.state.enabled ||
      !this.state.prepared ||
      this.operation ||
      !scope.ready ||
      this.state.phase === "connecting"
    )
      return;
    const epoch = this.epoch;
    this.update({ phase: "connecting" });
    try {
      const linked = await connectGoogleSlotTarget(
        scope,
        this.dependencies,
        this.lifecycle.signal,
        () => this.current(epoch)
      );
      if (!linked || !this.current(epoch) || linked.authorization.signal.aborted) return;
      if (linked.target) {
        this.target = linked.target;
        this.preview = undefined;
        this.omit(...replacedGoogleAccountStatusKeys);
      }
      this.attach(linked.authorization, epoch);
    } catch (error) {
      this.fail(error, epoch);
    }
  };

  private async patchLocal(patch: Partial<DeviceSlotRecord>) {
    const scope = this.host.scope(providerId);
    const epoch = this.epoch;
    if (!scope.ready) throw new DriveError("busy", "Рабочее пространство недоступно.");
    const target = await loadGoogleSlotTarget(scope, this.dependencies);
    if (!sameScope(scope, this.host.scope(providerId)) || epoch !== this.epoch) throw changed();
    const saved = await updateGoogleSlotTarget(
      target,
      patch,
      this.dependencies,
      this.lifecycle.signal
    );
    if (!this.current(epoch)) throw changed();
    this.target = saved;
    return saved;
  }
  setEnabled = async (enabled: boolean): Promise<void> => {
    const scope = this.host.scope(providerId);
    this.reset(enabled);
    this.scope = scope;
    await this.patchLocal({ enabled });
    if (enabled) this.load = this.restore(scope, this.epoch);
  };
  setAutomatic = async (automatic: boolean): Promise<void> => {
    if (!this.state.enabled || this.operation) return;
    await this.patchLocal({ automatic });
    this.update({ automatic });
    if (automatic) this.schedule();
  };
  setSlotMode = async (mode: "normal" | "test") => {
    if (!this.state.enabled || this.operation || this.target?.record.pending) return;
    await this.patchLocal({ mode });
    this.update({ mode });
  };
  disconnect = async (): Promise<void> => {
    const scope = this.host.scope(providerId);
    const disabling = this.setEnabled(false);
    const epoch = this.epoch;
    await disabling;
    if (
      this.target &&
      this.current(epoch) &&
      !this.state.enabled &&
      sameScope(scope, this.host.scope(providerId))
    )
      await this.dependencies.auth.forgetOwner(this.target.owner);
  };
  dispose = (): void => {
    this.disposed = true;
    this.reset();
    this.listeners.clear();
  };

  runUploadProbe = async (imageBytes?: number) => {
    const authorization = this.authorization;
    if (!authorization || !this.state.enabled || this.operation)
      throw new DriveError("not-ready", "Подключите Google Диск для пробы записи.");
    const epoch = this.epoch;
    const job = {};
    this.operation = job;
    try {
      const result = await runDriveSlotBinaryProbe(
        authorization,
        this.dependencies.fetch,
        this.lifecycle.signal,
        imageBytes
      );
      if (!this.current(epoch) || authorization !== this.authorization) throw changed();
      this.omit("error", "pauseReason");
      this.update({ uploadProbeBytes: result.maxBytes, phase: "idle" });
      return result;
    } finally {
      if (this.operation === job) this.operation = undefined;
    }
  };

  sync = async (): Promise<void> => this.run(synchronizeDeviceSlots);
  choose = async (selection: CloudSelection): Promise<void> => {
    if (this.state.migrationRequired) return this.migrateLegacy(selection);
    const preview = this.preview;
    if (!preview) {
      if (this.state.conflict) {
        this.update({ choiceAction: { selection, state: "review" } });
        await this.sync();
      }
      return;
    }
    await this.run(
      (context, record) => chooseDeviceSlotVersion(context, record, preview, selection),
      selection
    );
  };

  restorePrevious = async (revisionId: string): Promise<void> => {
    if (!this.state.previousVersions?.some(({ id }) => id === revisionId)) return;
    await this.run((context, record) =>
      restorePreviousDeviceSlotVersion(context, record, revisionId)
    );
  };

  prepareLegacyArchive = async (): Promise<Blob | undefined> => {
    const authorization = this.authorization;
    if (!authorization || !this.state.migrationRequired) return;
    let body: Blob | undefined;
    await this.run(async (context, record) => {
      body = await this.migration.prepare(context, record, authorization, this.dependencies.fetch);
      return { state: "migration", record };
    });
    return body;
  };

  verifyLegacyArchive = async (file: Blob): Promise<void> => {
    if (!this.migration.current || !this.state.migrationRequired) return;
    await this.run(async (context, record) => {
      await this.migration.verify(context, file);
      return { state: "migration", record };
    });
  };

  migrateLegacy = async (selection: CloudSelection): Promise<void> => {
    if (!this.migration.current?.verified || !this.state.migrationRequired) return;
    await this.run(
      (context, record) => this.migration.migrate(context, record, selection),
      selection
    );
  };

  private async run(operation: Operation, selection?: CloudSelection) {
    const authorization = this.authorization,
      scope = this.host.scope(providerId);
    if (!authorization || !this.state.enabled || this.operation || !scope.ready || scope.blocked)
      return;
    if (!this.dependencies.online()) {
      this.update({ pendingChanges: true, pauseReason: "offline" });
      return;
    }
    const epoch = this.epoch;
    const job = {};
    this.operation = job;
    const signal = AbortSignal.any([this.lifecycle.signal, authorization.signal]);
    const current = () =>
      !signal.aborted &&
      this.current(epoch) &&
      this.authorization === authorization &&
      this.operation === job &&
      this.state.enabled;
    const checkIdentity = () => {
      if (!current()) throw changed();
    };
    let progress = beginDriveProgress();
    this.update({
      phase: "syncing",
      driveProgress: progress,
      progress: { stage: "validate" },
      ...(selection ? { choiceAction: { selection, state: "running" as const } } : {})
    });
    try {
      const target = await loadGoogleSlotTarget(scope, this.dependencies);
      const { owner, record } = target;
      checkIdentity();
      if (target.enabled === false) {
        this.reset();
        return;
      }
      if (!matchesGoogleSlotCredential(scope, record, authorization)) {
        this.dependencies.auth.suspend();
        return;
      }
      const captured = await this.host.capture(providerId, { signal, isCurrent: current });
      checkIdentity();
      const context = createDeviceSlotContext({
        host: this.host,
        capture: captured,
        guard: { signal, isCurrent: current },
        authorization,
        fetcher: this.dependencies.fetch,
        save: async (prior, patch) => {
          const next = await this.dependencies.save(owner, prior, patch, signal);
          if (current()) this.target = { ...target, record: next };
          return next;
        },
        report: (stage, details) => {
          if (!current()) return;
          progress = advanceDriveProgress(progress, stage, details);
          const amount = details?.transfer;
          this.update({
            driveProgress: progress,
            progress: {
              stage: stageNames[stage],
              ...(amount ? { completedBytes: amount.transferredBytes } : {})
            }
          });
        }
      });
      context.check();
      const result = await operation(context, record);
      checkIdentity();
      this.target = { ...target, record: result.record };
      this.publishOutcome(result, captured.backup, context.localChanged());
      if (selection)
        this.update({
          choiceAction: { selection, state: result.state === "idle" ? "confirmed" : "review" }
        });
    } catch (error) {
      if (current()) {
        this.fail(error, epoch);
        if (selection)
          this.update({
            choiceAction: {
              selection,
              state:
                this.state.error === "indeterminate"
                  ? "unconfirmed"
                  : this.state.error === "conflict"
                    ? "review"
                    : "blocked"
            }
          });
      }
    } finally {
      if (this.operation === job) {
        this.operation = undefined;
        this.omit("driveProgress", "progress");
        this.update({ lastOperation: finishDriveProgress(progress) });
        if (this.state.phase === "idle" && this.state.pendingChanges) this.schedule();
      }
    }
  }

  private omit(...keys: GoogleTransientStatusKey[]) {
    const next = { ...this.state };
    for (const key of keys) delete next[key];
    this.state = next;
  }

  private publishOutcome(result: SlotSyncResult, local: Backup, newLocalChanges: boolean) {
    this.preview = result.state === "choice" ? result.preview : undefined;
    this.omit("error", "pauseReason", "conflict", "archive");
    this.update(
      deviceSlotOutcome(
        result,
        this.migration.current,
        this.migration.choices,
        local,
        newLocalChanges
      )
    );
  }
}
