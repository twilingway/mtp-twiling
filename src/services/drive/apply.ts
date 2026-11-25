import type { Backup } from "../../model/types.js";
import type { DriveBridge } from "./coordinator-types.js";
import { DriveError } from "./types.js";
import { driveBackupDigest } from "./backup.js";
interface Application {
  check(): void;
  current(): boolean;
  applying(active: boolean): void;
}
/** The commit barrier suppresses portable echo until restoration and digest capture finish. */
export async function applyDriveBackup(
  backup: Backup,
  bridge: DriveBridge,
  signal: AbortSignal,
  operation: Application
): Promise<string> {
  operation.check();
  if (!backup.layout || !backup.watchlist || !backup.views)
    throw new DriveError("remote-invalid", "Неполный снимок настроек Google Диска");
  try {
    await bridge.importBackup(backup, {
      replacePortable: true,
      signal,
      valid: () => operation.current(),
      onCommitted: () => operation.applying(true)
    });
    operation.check();
  } finally {
    operation.applying(false);
  }
  const applied = await bridge.exportBackup();
  operation.check();
  return driveBackupDigest(applied);
}
