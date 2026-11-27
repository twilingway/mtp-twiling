import type { Backup } from "../../model/types.js";
import type { CloudSelection } from "../../model/cloud-sync.js";
import { DriveAuth } from "./auth.js";
import { hasDriveHistory } from "./local.js";
import { changed, createDeviceSlotContext, providerId } from "./device-slot-context.js";
import type { GoogleSlotHost, GoogleSlotScope } from "./device-slot-context.js";
import {
  googleSlotFence,
  loadGoogleSlotTarget,
  matchesGoogleSlotCredential
} from "./device-slot-link.js";
import type { GoogleSlotTarget } from "./device-slot-link.js";
import { loadDeviceSlotRecord, saveDeviceSlotRecord } from "./device-slot-local.js";
import type { DeviceSlotRecord } from "./device-slot-local.js";
import type { SlotSyncContext, SlotSyncResult } from "./device-slot-sync.js";
import type { DriveReport } from "./progress.js";
import { advanceDriveProgress, beginDriveProgress } from "./progress.js";
import type { DriveProgress } from "./progress.js";
import { googleSlotChoiceFailure, googleSlotProgress } from "./device-slot-status.js";
import type { GoogleStatus } from "./device-slot-status.js";
import type { DriveAuthorization } from "./types.js";
import { DriveWriteCapability } from "./write-capability.js";
import type { WriteCapabilityStatus } from "./write-capability.js";
import type { GoogleLegacyJob } from "./legacy-compaction-google.js";

export type GoogleSlotOperation = (
  context: SlotSyncContext,
  record: DeviceSlotRecord
) => Promise<SlotSyncResult>;
export interface GoogleSlotCompletion {
  readonly authorization: DriveAuthorization;
  readonly epoch: number;
  readonly target: GoogleSlotTarget;
}
export interface GoogleSlotDependencies {
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
export const defaultGoogleSlotDependencies = (): GoogleSlotDependencies => ({
  auth: new DriveAuth(),
  load: loadDeviceSlotRecord,
  save: saveDeviceSlotRecord,
  hasHistory: hasDriveHistory,
  fetch: (...args) => fetch(...args),
  online: () => navigator.onLine
});
export const sameGoogleSlotScope = (a: GoogleSlotScope | undefined, b: GoogleSlotScope) =>
  a?.ready === b.ready &&
  a?.cloudOwner === b.cloudOwner &&
  a?.session === b.session &&
  a?.associationConflict === b.associationConflict;
export const guardedGoogleCapability =
  (current: () => boolean, update: (patch: Partial<GoogleStatus>) => void) =>
  (writeCapability: WriteCapabilityStatus) => {
    if (current()) update({ writeCapability, uploadProbeBytes: writeCapability.verifiedBytes });
  };
interface OperationOptions {
  host: GoogleSlotHost;
  scope: GoogleSlotScope;
  authorization: DriveAuthorization;
  dependencies: {
    load: typeof loadDeviceSlotRecord;
    save: typeof saveDeviceSlotRecord;
    fetch: typeof fetch;
    auth: { suspend(): void };
  };
  signal: AbortSignal;
  current: () => boolean;
  reset: (enabled?: boolean) => void;
  target(target: GoogleSlotTarget): void;
  outcome(result: SlotSyncResult, local: Backup, localChanged: boolean): void;
  capability: (status: WriteCapabilityStatus) => void;
  report: DriveReport;
  operation: GoogleSlotOperation;
}
interface JobOptions extends Omit<OperationOptions, "report"> {
  selection?: CloudSelection;
  update(patch: Partial<GoogleStatus>): void;
  fail(error: unknown): void;
  status(): GoogleStatus;
  finish(progress: DriveProgress): void;
}
/** One shared progress/error lifecycle also covers read-only comparison and explicit receive. */
export async function runGoogleSlotJob(options: JobOptions) {
  const { selection } = options;
  let progress = beginDriveProgress();
  options.update({
    phase: "syncing",
    driveProgress: progress,
    progress: { stage: "validate" },
    ...(selection ? { choiceAction: { selection, state: "running" as const } } : {})
  });
  try {
    const result = await executeGoogleSlotOperation({
      ...options,
      report: (stage, details) => {
        if (!options.current()) return;
        progress = advanceDriveProgress(progress, stage, details);
        options.update(googleSlotProgress(progress));
      }
    });
    if (result && selection && options.current())
      options.update({
        choiceAction: {
          selection,
          state: result.state === "idle" || result.state === "received" ? "confirmed" : "review"
        }
      });
  } catch (error) {
    if (options.current()) {
      options.fail(error);
      if (selection)
        options.update({
          choiceAction: {
            selection,
            state: googleSlotChoiceFailure(options.status().error, options.status().choiceAction)
          }
        });
    }
  } finally {
    options.finish(progress);
  }
}
/** Executes one immutable credential/revision job; the provider owns scheduling and presentation. */
export async function executeGoogleSlotOperation(
  options: OperationOptions
): Promise<SlotSyncResult | undefined> {
  const { host, scope, authorization, dependencies, signal, current, reset } = options;
  const target = await loadGoogleSlotTarget(scope, dependencies);
  const { owner, record } = target;
  if (!current()) throw changed();
  if (target.enabled === false) {
    reset();
    return;
  }
  if (!matchesGoogleSlotCredential(scope, record, authorization)) {
    dependencies.auth.suspend();
    return;
  }
  const captured = await host.capture(providerId, { signal, isCurrent: current });
  const fence = googleSlotFence(target, dependencies, signal, current, reset);
  await fence.check();
  const context = createDeviceSlotContext({
    host,
    capture: captured,
    guard: { signal, isCurrent: current },
    authorization,
    fence,
    fetcher: dependencies.fetch,
    save: async (prior, patch) => {
      const next = await dependencies.save(owner, prior, patch, signal);
      if (current()) options.target({ ...target, record: next });
      return next;
    },
    report: options.report,
    capability: options.capability
  });
  context.check();
  const result = await options.operation(context, record);
  await fence.check();
  options.target({ ...target, record: result.record });
  options.outcome(result, captured.backup, context.localChanged());
  return result;
}
interface ProbeOptions {
  authorization: DriveAuthorization;
  fetcher: typeof fetch;
  target: GoogleSlotTarget;
  load: typeof loadDeviceSlotRecord;
  signal: AbortSignal;
  current: () => boolean;
  reset: (enabled: boolean) => void;
  capability: (status: WriteCapabilityStatus) => void;
}
export function googleCapabilityManager(options: ProbeOptions): DriveWriteCapability {
  const { authorization, target, signal, current, reset } = options;
  const fence = googleSlotFence(target, options, signal, current, reset);
  return new DriveWriteCapability({
    authorization,
    signal,
    fetcher: fence.guardFetch(options.fetcher),
    check: fence.check,
    publish: (status) => {
      if (current()) options.capability(status);
    }
  });
}

export async function runGoogleCapabilityDiagnostic(options: ProbeOptions, imageBytes?: number) {
  const manager = googleCapabilityManager(options);
  const result = await manager.diagnose(imageBytes);
  if (!options.current()) throw changed();
  options.signal.throwIfAborted();
  return result;
}

export async function runGoogleProviderUploadProbe(
  job: GoogleLegacyJob,
  target: GoogleSlotTarget,
  imageBytes: number | undefined,
  fail: (error: unknown) => void,
  success: () => void
) {
  try {
    const result = await runGoogleCapabilityDiagnostic(
      {
        authorization: job.authorization,
        target,
        signal: job.signal,
        load: job.dependencies.load,
        fetcher: job.dependencies.fetch,
        current: job.current,
        reset: job.reset,
        capability: (writeCapability) => {
          if (job.current())
            job.update({ writeCapability, uploadProbeBytes: writeCapability.verifiedBytes });
        }
      },
      imageBytes
    );
    if (job.current()) {
      success();
      job.update({ uploadProbeBytes: result.maxBytes, phase: "idle" });
    }
    return result;
  } catch (error) {
    if (job.current()) fail(error);
    throw error;
  } finally {
    job.finish();
  }
}
