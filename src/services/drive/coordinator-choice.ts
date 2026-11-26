import type { Backup } from "../../model/types.js";
import { driveBackupDigest, sanitizeDriveBackup } from "./backup.js";
import type {
  DriveChoiceAction,
  DriveChoicePreview,
  DriveDependencies
} from "./coordinator-types.js";
import { assertDriveInspectionUnchanged, driveInspectionIdentity } from "./reader-guard.js";
import type { DriveInspection } from "./types.js";

type ChoiceResolution =
  | { kind: "review"; inspection: DriveInspection; backup: Backup; digest: string }
  | { kind: "accept"; heads: string[]; backup: Backup; digest: string };

interface ChoiceOperation {
  remote: ReturnType<DriveDependencies["sync"]>;
  deviceId: string;
  revision: number;
  exportBackup: () => Promise<Backup>;
  check: () => void;
}

export function finishDriveChoice(
  choice: DriveChoiceAction | undefined,
  state: "confirmed" | "unconfirmed"
): DriveChoiceAction | undefined {
  return choice?.state === "running" ? { ...choice, state } : choice;
}

/** Resolve only the selected preview. The coordinator accepts the result after its profile fence. */
export async function resolveDriveChoice(
  nodeId: string,
  preview: DriveChoicePreview,
  { remote, deviceId, revision, exportBackup, check }: ChoiceOperation
): Promise<ChoiceResolution> {
  const local = sanitizeDriveBackup(await exportBackup()),
    digest = await driveBackupDigest(local);
  check();
  const inspection = await remote.inspect();
  check();
  if (
    digest !== preview.digest ||
    revision !== preview.revision ||
    driveInspectionIdentity(inspection) !== preview.identity
  )
    return { kind: "review", inspection, backup: local, digest };
  const backup = nodeId === "local" ? local : await remote.download(nodeId, inspection);
  check();
  const heads = inspection.heads;
  if (nodeId === "local" || heads.length > 1) {
    const options = { deviceId, parents: heads, expectedInspection: inspection };
    const result = await (heads.length > 1
      ? remote.resolve(backup, options)
      : remote.publish(backup, options));
    check();
    if (result.inspection.conflict)
      return { kind: "review", inspection: result.inspection, backup: local, digest };
    // A newer descendant may already be the inspected head. Acknowledge only our own snapshot.
    return { kind: "accept", heads: [result.nodeId], backup, digest };
  }
  const latest = await remote.inspect();
  check();
  assertDriveInspectionUnchanged(inspection, latest);
  return { kind: "accept", heads, backup, digest };
}
