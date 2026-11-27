import { get, put, transaction } from "../storage-db.js";
import { isRecord } from "../../model/backup-format.js";
import { uuidPattern, shaPattern } from "./backup.js";
import type { DriveRecord } from "./coordinator-types.js";
import { unsupportedDriveFormat } from "./reader-guard.js";
import { DriveError } from "./types.js";
import { readOrCreateDriveDeviceId } from "./device-slot-identity.js";

function readDriveRecord(value: unknown): DriveRecord {
  if (isRecord(value) && isRecord(value.value)) {
    const record = value.value;
    const fields = [
      "schemaVersion",
      "markerId",
      "deviceId",
      "baseHeads",
      "automatic",
      "pendingChanges",
      "lastSyncedDigest",
      "lastSyncedAt"
    ];
    if (record.schemaVersion !== 1 || Object.keys(record).some((key) => !fields.includes(key)))
      throw unsupportedDriveFormat();
    if (
      record.schemaVersion === 1 &&
      typeof record.markerId === "string" &&
      uuidPattern.test(record.markerId) &&
      typeof record.deviceId === "string" &&
      uuidPattern.test(record.deviceId) &&
      Array.isArray(record.baseHeads) &&
      record.baseHeads.length <= 10000 &&
      record.baseHeads.every((item) => typeof item === "string" && uuidPattern.test(item)) &&
      (record.lastSyncedDigest === undefined ||
        (typeof record.lastSyncedDigest === "string" && shaPattern.test(record.lastSyncedDigest)))
    ) {
      return {
        schemaVersion: 1,
        markerId: record.markerId,
        deviceId: record.deviceId,
        baseHeads: record.baseHeads.map((item: unknown) => String(item)),
        automatic: record.automatic !== false,
        pendingChanges: record.pendingChanges === true,
        ...(typeof record.lastSyncedDigest === "string"
          ? { lastSyncedDigest: record.lastSyncedDigest }
          : {}),
        ...(typeof record.lastSyncedAt === "string" &&
        Number.isFinite(Date.parse(record.lastSyncedAt))
          ? { lastSyncedAt: record.lastSyncedAt }
          : {})
      };
    }
  }
  throw new DriveError("remote-invalid", "Invalid local Drive association; data is retained.");
}

export async function loadDriveRecord(owner: string): Promise<DriveRecord> {
  const id = `drive-v2:${owner}`;
  const existing = await get("preferences", id);
  if (existing !== undefined) return readDriveRecord(existing);

  let current: unknown;
  let created: DriveRecord | undefined;
  await transaction(["preferences"], (tx) => {
    const store = tx.objectStore("preferences");
    const association = store.get(id);
    association.onsuccess = () => {
      current = association.result;
      if (current !== undefined) return;
      readOrCreateDriveDeviceId(store, (deviceId) => {
        created = {
          schemaVersion: 1,
          markerId: crypto.randomUUID(),
          deviceId,
          baseHeads: [],
          automatic: true
        };
        store.put({ id, owner, value: created });
      });
    };
  });
  return created ?? readDriveRecord(current);
}
export function saveDriveRecord(owner: string, record: DriveRecord): Promise<void> {
  return put("preferences", { id: `drive-v2:${owner}`, owner, value: record });
}

export async function hasDriveHistory(owner: string): Promise<boolean> {
  const stored = await get("preferences", `drive-v2:${owner}`);
  if (stored === undefined) return false;
  const record = readDriveRecord(stored);
  return record.baseHeads.length > 0 || !!(record.lastSyncedAt || record.lastSyncedDigest);
}
