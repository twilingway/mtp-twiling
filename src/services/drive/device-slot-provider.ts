import type { CloudClientMode, CloudSelection, CloudSyncProvider } from "../../model/cloud-sync.js";
import type { Backup } from "../../model/types.js";
import { changed, providerId } from "./device-slot-context.js";
import type { GoogleSlotHost, GoogleSlotScope } from "./device-slot-context.js";
import type { DeviceSlotRecord } from "./device-slot-local.js";
import {
  connectGoogleSlotTarget,
  loadGoogleSlotTarget,
  restoreGoogleSlotTarget,
  updateGoogleSlotTarget
} from "./device-slot-link.js";
import type { GoogleSlotTarget } from "./device-slot-link.js";
import { LegacyDeviceSlotMigration } from "./device-slot-migration.js";
import {
  initialGoogleSlotStatus,
  googleClientStatus,
  operationError,
  replacedGoogleAccountStatusKeys
} from "./device-slot-status.js";
import type { GoogleStatus, GoogleTransientStatusKey } from "./device-slot-status.js";
import { synchronizeDeviceSlots } from "./device-slot-sync.js";
import { GoogleSlotPreviews, inspectDeviceSlotVersions } from "./device-slot-inspection.js";
import type { SlotSyncResult } from "./device-slot-sync.js";
import { finishDriveProgress } from "./progress.js";
import { DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
export type { GoogleStatus } from "./device-slot-status.js";

export type { GoogleSlotHost } from "./device-slot-context.js";

import {
  runGoogleSlotJob,
  guardedGoogleCapability,
  defaultGoogleSlotDependencies,
  googleCapabilityManager,
  runGoogleProviderUploadProbe,
  sameGoogleSlotScope as sameScope
} from "./device-slot-operation.js";
import type {
  GoogleSlotOperation,
  GoogleSlotDependencies,
  GoogleSlotCompletion
} from "./device-slot-operation.js";
import {
  compactGoogleLegacy,
  inspectGoogleLegacyArchives,
  downloadGoogleLegacyArchive,
  probeGoogleLegacyDelete,
  inspectGoogleLateLegacy,
  runGoogleLegacyAction
} from "./legacy-compaction-google.js";
import type { GoogleLegacyJob } from "./legacy-compaction-google.js";
import { createGoogleSlotProviderActions } from "./device-slot-provider-actions.js";
import { takeGoogleLegacyJob } from "./legacy-compaction-provider-job.js";

export class GoogleSlotProvider implements CloudSyncProvider {
  readonly id = providerId;
  private state = initialGoogleSlotStatus();
  private readonly listeners = new Set<() => void>();
  private scope: GoogleSlotScope | undefined;
  private target: GoogleSlotTarget | undefined;
  private authorization: DriveAuthorization | undefined;
  private readonly previews = new GoogleSlotPreviews();
  private readonly migration = new LegacyDeviceSlotMigration();
  private readonly actions = createGoogleSlotProviderActions({
    previews: this.previews,
    migration: this.migration,
    fetcher: (input, init) => this.dependencies.fetch(input, init),
    state: () => this.state,
    authorization: () => this.authorization,
    run: (operation, selection) => this.run(operation, selection),
    inspect: () => this.inspect(),
    compact: (completion) => this.compactLegacyAutomatically(completion),
    update: (patch) => this.update(patch),
    omit: (...keys) => this.omit(...keys)
  });
  private epoch = 0;
  private lifecycle = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private operation: object | undefined;
  private disposed = false;
  private load: Promise<void> | undefined;
  private localIntentRevision = 0;
  constructor(
    private readonly host: GoogleSlotHost,
    private readonly dependencies: GoogleSlotDependencies = defaultGoogleSlotDependencies()
  ) {}
  getSnapshot = (): GoogleStatus => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<GoogleStatus>) {
    const next = { ...this.state, ...patch };
    this.state = { ...next, ...googleClientStatus(next.mode) };
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
    this.previews.clear();
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
    if (this.state.writeCapability?.phase === "checking") this.omit("writeCapability");
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
      const { automatic, mode, lastSyncedAt } = target.record;
      if (!enabled) {
        this.update({ mode, automatic });
        return;
      }
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
    this.omit("error", "pauseReason", "archive", "writeCapability");
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
        this.omit(
          "archive",
          "conflict",
          "comparison",
          "writeCapability",
          "driveProgress",
          "progress"
        );
        this.update({
          connected: false,
          phase: this.state.phase === "connecting" ? "connecting" : "auth-required",
          pauseReason: "auth-required",
          uploadProbeBytes: 0
        });
      },
      { once: true }
    );
    if (this.target && authorization.credentialId) {
      const target = this.target;
      void googleCapabilityManager({
        authorization,
        target,
        signal: this.lifecycle.signal,
        load: this.dependencies.load,
        fetcher: this.dependencies.fetch,
        current: () =>
          this.current(epoch) &&
          this.authorization === authorization &&
          this.state.enabled &&
          !this.operation &&
          this.target === target,
        reset: (enabled) => this.reset(enabled),
        capability: (writeCapability) =>
          this.update({ writeCapability, uploadProbeBytes: writeCapability.verifiedBytes })
      })
        .restore()
        .catch(() => {});
    }
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
    if (this.state.enabled) this.localIntentRevision++;
    this.actions.localIntent();
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
        this.previews.clear();
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
    if (mode === this.state.mode) return;
    await this.patchLocal({ mode });
    this.previews.clear();
    this.omit("comparison", "conflict", "choiceAction", "compaction");
    this.update({ mode, pendingChanges: true });
  };
  setClientMode = (mode: CloudClientMode): Promise<void> => this.setSlotMode(mode);
  disconnect = async (): Promise<void> => {
    const disabling = this.setEnabled(false);
    const epoch = this.epoch;
    await disabling;
    if (this.target && this.current(epoch) && !this.state.enabled)
      await this.dependencies.auth.forgetOwner(this.target.owner);
  };
  dispose = (): void => {
    this.disposed = true;
    this.reset();
    this.listeners.clear();
  };
  private takeLegacyJob = (): GoogleLegacyJob | undefined =>
    takeGoogleLegacyJob({
      dependencies: this.dependencies,
      signal: this.lifecycle.signal,
      scope: () => this.host.scope(providerId),
      authorization: () => this.authorization,
      target: () => this.target,
      state: () => this.state,
      epoch: () => this.epoch,
      current: (epoch) => this.current(epoch),
      operation: () => this.operation,
      claim: (job) => {
        this.operation = job;
      },
      timer: () => this.timer,
      clearTimer: () => {
        clearTimeout(this.timer);
        this.timer = undefined;
      },
      intentRevision: () => this.localIntentRevision,
      reset: (enabled) => this.reset(enabled),
      update: (patch) => this.update(patch),
      schedule: () => this.schedule()
    });
  compactLegacy = async (): Promise<void> => {
    await runGoogleLegacyAction(this.takeLegacyJob, compactGoogleLegacy);
  };
  private compactLegacyAutomatically = async (completed: GoogleSlotCompletion): Promise<void> => {
    if (
      completed.authorization !== this.authorization ||
      completed.epoch !== this.epoch ||
      completed.target !== this.target
    )
      return;
    await runGoogleLegacyAction(this.takeLegacyJob, (job) => compactGoogleLegacy(job, false));
  };
  inspectLegacyArchives = async (): Promise<void> => {
    await runGoogleLegacyAction(this.takeLegacyJob, inspectGoogleLegacyArchives);
  };
  downloadLegacyRawArchive = (id: string): Promise<Blob | undefined> =>
    runGoogleLegacyAction(this.takeLegacyJob, (job) => downloadGoogleLegacyArchive(job, id));
  runLegacyDeleteProbe = () => runGoogleLegacyAction(this.takeLegacyJob, probeGoogleLegacyDelete);
  inspectLateLegacy = () => runGoogleLegacyAction(this.takeLegacyJob, inspectGoogleLateLegacy);
  runUploadProbe = async (imageBytes?: number) => {
    const job = this.takeLegacyJob();
    if (!job || !this.target)
      throw new DriveError("not-ready", "Подключите Google Диск для пробы записи.");
    return runGoogleProviderUploadProbe(
      job,
      this.target,
      imageBytes,
      (error) => this.fail(error, this.epoch),
      () => this.omit("error", "pauseReason")
    );
  };
  sync = async (): Promise<void> => {
    const completed = await this.run(synchronizeDeviceSlots);
    if (completed) await this.compactLegacyAutomatically(completed);
  };
  inspect = async (): Promise<void> => {
    await this.run(inspectDeviceSlotVersions);
  };
  receive = (id: string): Promise<void> => this.actions.receive(id);
  choose = (selection: CloudSelection): Promise<void> => this.actions.choose(selection);
  restorePrevious = (revisionId: string): Promise<void> => this.actions.restorePrevious(revisionId);
  prepareLegacyArchive = (): Promise<Blob | undefined> => this.actions.prepareLegacyArchive();
  verifyLegacyArchive = (file: Blob): Promise<void> => this.actions.verifyLegacyArchive(file);
  migrateLegacy = (selection: CloudSelection): Promise<void> =>
    this.actions.migrateLegacy(selection);
  private async run(
    operation: GoogleSlotOperation,
    selection?: CloudSelection
  ): Promise<GoogleSlotCompletion | undefined> {
    const authorization = this.authorization,
      scope = this.host.scope(providerId);
    if (!authorization || !this.state.enabled || this.operation || !scope.ready || scope.blocked)
      return;
    if (!this.dependencies.online()) {
      this.update({ pendingChanges: true, pauseReason: "offline" });
      return;
    }
    const automaticPending = operation === inspectDeviceSlotVersions && this.timer !== undefined;
    if (automaticPending) {
      clearTimeout(this.timer);
      this.timer = undefined;
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
    let successful = false;
    let finishedTarget: GoogleSlotTarget | undefined;
    await runGoogleSlotJob({
      host: this.host,
      scope,
      authorization,
      dependencies: this.dependencies,
      signal,
      current,
      operation,
      ...(selection ? { selection } : {}),
      reset: (enabled) => this.reset(enabled),
      target: (target) => {
        this.target = target;
        finishedTarget = target;
      },
      outcome: (result, local, localChanged) => {
        successful = result.state === "idle";
        this.publishOutcome(result, local, localChanged);
      },
      capability: guardedGoogleCapability(current, (patch) => this.update(patch)),
      update: (patch) => this.update(patch),
      fail: (error) => this.fail(error, epoch),
      status: () => this.state,
      finish: (progress) => {
        if (this.operation !== job) return;
        this.operation = undefined;
        this.omit("driveProgress", "progress");
        this.update({ lastOperation: finishDriveProgress(progress) });
        if (
          automaticPending ||
          (operation !== inspectDeviceSlotVersions &&
            this.state.phase === "idle" &&
            this.state.pendingChanges)
        )
          this.schedule();
      }
    });
    return successful && finishedTarget
      ? { authorization, epoch, target: finishedTarget }
      : undefined;
  }
  private omit(...keys: GoogleTransientStatusKey[]) {
    const next = { ...this.state };
    for (const key of keys) delete next[key];
    this.state = next;
  }
  private publishOutcome(result: SlotSyncResult, local: Backup, changed: boolean) {
    const publication = this.previews.publish(result, this.state, this.migration, local, changed);
    this.omit(...publication.clear);
    this.update(publication.patch);
  }
}
