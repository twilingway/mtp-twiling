import type { Backup } from "../../model/types.js";
import { driveBackupDigest, sanitizeDriveBackup } from "./backup.js";
import { needsDriveConflict, readDriveHeads } from "./coordinator-reader.js";
import type { DriveBridge, DriveDependencies, DriveRecord } from "./coordinator-types.js";
import type { DriveReport } from "./progress.js";
import { assertDriveInspectionUnchanged } from "./reader-guard.js";
import type { DriveInspection } from "./types.js";

interface SyncAction {
  exportBackup: DriveBridge["exportBackup"];
  remote: ReturnType<DriveDependencies["sync"]>;
  record: DriveRecord;
  report: DriveReport;
  check: () => void;
  checkSession: () => void;
  detectLegacy: (inspection: DriveInspection) => Promise<boolean>;
  conflict: (inspection: DriveInspection, backup: Backup, digest: string) => Promise<void>;
  apply: (backup: Backup, heads: string[]) => Promise<void>;
  accept: (heads: string[], digest: string) => Promise<void>;
}

export async function synchronizeDrive(action: SyncAction): Promise<void> {
  const { accept, apply, check, checkSession, conflict, detectLegacy, record, remote, report } =
    action;
  const backup = sanitizeDriveBackup(await action.exportBackup());
  check();
  const digest = await driveBackupDigest(backup);
  report("read-versions");
  const inspection = await remote.inspect();
  check();
  if (await detectLegacy(inspection)) return;
  const nextHead = inspection.heads[0];
  const headsChanged = [...inspection.heads].sort().join() !== [...record.baseHeads].sort().join();
  const incoming = headsChanged ? nextHead : undefined;
  const choice = needsDriveConflict(inspection, record, digest);
  const unchanged = !!nextHead && digest === record.lastSyncedDigest;
  // Publish validates the same heads inside its write fence before touching cloud data.
  if (choice || incoming || unchanged) {
    report("check-versions", { listedVersions: inspection.snapshots.length });
    await readDriveHeads(remote, inspection, check);
  }
  if (choice) {
    await conflict(inspection, backup, digest);
    return;
  }
  if (incoming) {
    report("download");
    const backup = await remote.download(incoming, inspection, report);
    check();
    report("confirm");
    assertDriveInspectionUnchanged(inspection, await remote.inspect());
    check();
    await apply(backup, inspection.heads);
    return;
  }
  if (unchanged) {
    await accept(inspection.heads, digest);
    return;
  }
  report("prepare-upload", { listedVersions: inspection.snapshots.length });
  check();
  const result = await remote.publish(
    backup,
    {
      deviceId: record.deviceId,
      parents: inspection.heads,
      expectedInspection: inspection,
      checkBeforeWrite: check
    },
    report
  );
  checkSession();
  if (result.inspection.conflict) await conflict(result.inspection, backup, digest);
  else {
    report("save-status", { listedVersions: result.inspection.snapshots.length });
    await accept([result.nodeId], digest);
  }
}
