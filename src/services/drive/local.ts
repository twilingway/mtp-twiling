import { get, put } from "../storage-db.js";
import { isRecord } from "../../model/backup-format.js";
import { uuidPattern, shaPattern } from "./backup.js";
import type { DriveRecord } from "./coordinator-types.js";
import { unsupportedDriveFormat } from "./reader-guard.js";
import { DriveError } from "./types.js";

export async function loadDriveRecord(owner: string): Promise<DriveRecord> {
  const value = await get("preferences", `drive-v2:${owner}`);
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
  if (value !== undefined)
    throw new DriveError("remote-invalid", "Invalid local Drive association; data is retained.");
  const device = await get("preferences", "drive-device"),
    deviceId =
      isRecord(device) && typeof device.value === "string" && uuidPattern.test(device.value)
        ? device.value
        : crypto.randomUUID();
  await put("preferences", { id: "drive-device", value: deviceId });
  const record: DriveRecord = {
    schemaVersion: 1,
    markerId: crypto.randomUUID(),
    deviceId,
    baseHeads: [],
    automatic: true
  };
  await saveDriveRecord(owner, record);
  return record;
}
export function saveDriveRecord(owner: string, record: DriveRecord): Promise<void> {
  return put("preferences", { id: `drive-v2:${owner}`, owner, value: record });
}
