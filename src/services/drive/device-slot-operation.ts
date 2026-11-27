import type { Backup } from "../../model/types.js";
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
import type { DriveAuthorization } from "./types.js";
import { DriveWriteCapability } from "./write-capability.js";
import type { WriteCapabilityStatus } from "./write-capability.js";

export type GoogleSlotOperation = (
  context: SlotSyncContext,
  record: DeviceSlotRecord
) => Promise<SlotSyncResult>;
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
