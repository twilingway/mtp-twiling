import type { CloudSyncStatus } from "../../model/cloud-sync.js";
import type { YandexStatusClear } from "./coordinator-status.js";

export function yandexUpdatedStatus(
  previous: CloudSyncStatus,
  patch: Partial<CloudSyncStatus>,
  clear: readonly YandexStatusClear[]
): CloudSyncStatus {
  const next = { ...previous, ...patch };
  for (const key of clear) delete next[key];
  if (!next.enabled) {
    next.phase = "disabled";
    for (const key of [
      "error",
      "pauseReason",
      "conflict",
      "choiceAction",
      "progress",
      "comparison"
    ] as const)
      delete next[key];
  }
  return Object.freeze(next);
}
