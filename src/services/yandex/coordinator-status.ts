import type { CloudSelection, CloudSyncStatus } from "../../model/cloud-sync.js";
import { yandexErrorCode } from "./types.js";

export function yandexFailureStatus(
  error: unknown,
  selection?: CloudSelection
): Partial<CloudSyncStatus> {
  const code = yandexErrorCode(error);
  return {
    phase: code === "auth-required" ? "auth-required" : "error",
    error: code,
    ...(code === "auth-required"
      ? { connected: false, pauseReason: "auth-required" as const }
      : {}),
    ...(selection ? { choiceAction: { selection, state: "unconfirmed" as const } } : {})
  };
}
