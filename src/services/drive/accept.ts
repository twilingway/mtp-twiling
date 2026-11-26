import type { DriveRecord } from "./coordinator-types.js";
import { DriveError } from "./types.js";
interface Acceptance {
  check(): void;
  revision(): number;
  save(record: DriveRecord): Promise<void>;
  assign(record: DriveRecord): void;
}
/** Persist exact observed heads; concurrent local edits retain a durable pending marker. */
export async function acceptDriveRecord(
  previous: DriveRecord,
  heads: string[],
  digest: string,
  revision: number,
  operations: Acceptance
): Promise<string> {
  operations.check();
  const save = async (record: DriveRecord) => {
    try {
      await operations.save(record);
    } catch {
      throw new DriveError("local-save", "Failed to save the local Google Drive association");
    }
  };
  let record: DriveRecord = {
    ...previous,
    baseHeads: [...heads],
    lastSyncedDigest: digest,
    pendingChanges: revision !== operations.revision(),
    lastSyncedAt: new Date().toISOString()
  };
  await save(record);
  operations.check();
  operations.assign(record);
  if (revision !== operations.revision() && !record.pendingChanges) {
    record = { ...record, pendingChanges: true };
    operations.assign(record);
    await save(record);
    operations.check();
  }
  return record.lastSyncedAt!;
}
