import { db } from "./storage-db.js";
import { requestValue } from "./storage-guest-records.js";
import { isRecord } from "../model/backup-format.js";
import { uuidPattern, shaPattern } from "./drive/backup.js";
import type { WorkspaceMigrationConflict } from "../model/workspace-identity-types.js";

/** Reads association metadata only; never the auth vault, Google tokens or bank session. */
export async function chooseCloudOwner(
  primary: string,
  keys: readonly string[]
): Promise<{ owner: string; conflicts: WorkspaceMigrationConflict[] }> {
  const associationKeys = keys.filter((key) => /^drive-v2:[A-Za-z0-9_-]{1,200}$/.test(key));
  if (!associationKeys.length) return { owner: "device", conflicts: [] };
  const pref = db.transaction("preferences").objectStore("preferences");
  const candidates: string[] = [];
  for (const key of associationKeys) {
    const raw = await requestValue<unknown>(pref.get(key));
    if (!isRecord(raw) || !isRecord(raw.value)) throw new Error("Invalid local cloud association");
    const value = raw.value;
    if (
      value.schemaVersion !== 1 ||
      Object.keys(value).some(
        (key) =>
          ![
            "schemaVersion",
            "markerId",
            "deviceId",
            "baseHeads",
            "automatic",
            "pendingChanges",
            "lastSyncedDigest",
            "lastSyncedAt"
          ].includes(key)
      ) ||
      typeof value.markerId !== "string" ||
      !uuidPattern.test(value.markerId) ||
      typeof value.deviceId !== "string" ||
      !uuidPattern.test(value.deviceId) ||
      !Array.isArray(value.baseHeads) ||
      value.baseHeads.length > 10000 ||
      !value.baseHeads.every(
        (head: unknown) => typeof head === "string" && uuidPattern.test(head)
      ) ||
      (value.lastSyncedDigest !== undefined &&
        (typeof value.lastSyncedDigest !== "string" || !shaPattern.test(value.lastSyncedDigest))) ||
      (value.automatic !== undefined && typeof value.automatic !== "boolean") ||
      (value.pendingChanges !== undefined && typeof value.pendingChanges !== "boolean") ||
      (value.lastSyncedAt !== undefined &&
        (typeof value.lastSyncedAt !== "string" ||
          !Number.isFinite(Date.parse(value.lastSyncedAt))))
    )
      throw new Error("Invalid local cloud association");
    candidates.push(key.slice("drive-v2:".length));
  }
  const selected = candidates.includes(primary)
    ? primary
    : candidates.length === 1
      ? candidates[0]!
      : "device";
  return {
    owner: selected,
    conflicts: candidates
      .filter((owner) => owner !== selected)
      .map((owner) => ({
        sourceOwner: owner,
        kind: "cloud-association",
        key: selected === "device" ? "ambiguous-associations" : "unselected-association",
        recoveryRef: `drive-v2:${owner}`
      }))
  };
}
