import type { Backup } from "../../model/types.js";
import type { DriveDependencies, DriveRecord, DriveStatus } from "./coordinator-types.js";
import type { DriveInspection, DriveAuthorization } from "./types.js";
import { DriveError } from "./types.js";
import { prepareDriveConflict } from "./conflict.js";
import { restoreDriveProfile } from "./restore.js";
import { assertDriveInspectionUnchanged, driveInspectionIdentity } from "./reader-guard.js";

type Remote = ReturnType<DriveDependencies["sync"]>;
export function initialDriveStatus(prepared = false): DriveStatus {
  return {
    phase: "disconnected",
    prepared,
    preparing: false,
    connected: false,
    automatic: true,
    pendingChanges: false,
    authorizationStored: false,
    credentialSaveError: false
  };
}
export function restoredDriveStatus(
  record: DriveRecord,
  status: DriveStatus
): Partial<DriveStatus> {
  return {
    automatic: record.automatic,
    pendingChanges: status.pendingChanges || record.pendingChanges === true,
    lastSyncedAt: record.lastSyncedAt
  };
}
export async function restoreReadableDriveProfile(
  dependencies: DriveDependencies,
  owner: string,
  current: () => boolean,
  accept: (record: DriveRecord) => void,
  attach: (authorization: DriveAuthorization) => Promise<void>,
  update: (patch: Partial<DriveStatus>) => void,
  fail: (error: unknown) => void
): Promise<void> {
  try {
    const restored = await restoreDriveProfile(dependencies, owner, current, accept);
    if (!restored) return;
    if (restored.authorization) await attach(restored.authorization);
    else update({ pauseReason: "auth-required" });
  } catch (error) {
    // A failed local restore never starts OAuth; unsupported data must remain visibly paused.
    if (current() && error instanceof DriveError) fail(error);
  }
}
export function unreadableDrivePause(
  error: unknown,
  authorization: DriveAuthorization | undefined,
  auth: DriveDependencies["auth"],
  reset: () => void,
  update: (patch: Partial<DriveStatus>) => void
): boolean {
  if (!(error instanceof DriveError) || error.code !== "unsupported-format") return false;
  auth.suspend();
  reset();
  update({
    phase: "error",
    error: error.code,
    connected: false,
    automatic: false,
    conflict: undefined,
    pauseReason: undefined,
    authorizationStored: authorization?.stored === true,
    credentialSaveError: authorization?.persistenceError === true
  });
  return true;
}
export function needsDriveConflict(
  inspection: DriveInspection,
  record: DriveRecord,
  digest: string
): boolean {
  const knownNodes = new Set(inspection.snapshots.map(({ manifest }) => manifest.nodeId));
  return (
    inspection.conflict ||
    record.baseHeads.some((nodeId) => !knownNodes.has(nodeId)) ||
    (!!inspection.heads.length &&
      [...inspection.heads].sort().join() !== [...record.baseHeads].sort().join() &&
      digest !== record.lastSyncedDigest)
  );
}
export async function readDriveHeads(
  remote: Remote,
  inspection: DriveInspection,
  check: () => void
) {
  if (inspection.heads.length > 8)
    throw new DriveError("limit", "Too many conflicting Drive heads.");
  await remote.validateHeads(inspection);
  check();
}
export async function readableDriveConflict(
  remote: Remote,
  inspection: DriveInspection,
  backup: Backup,
  digest: string,
  revision: number,
  check: () => void
) {
  const next = await prepareDriveConflict(remote, inspection, backup, digest, revision, check);
  const latest = await remote.inspect();
  check();
  assertDriveInspectionUnchanged(inspection, latest);
  return { ...next, preview: { ...next.preview, identity: driveInspectionIdentity(inspection) } };
}
