import type {
  CloudComparison,
  CloudPhase,
  CloudSelection,
  CloudSyncStatus
} from "../../model/cloud-sync.js";
import { yandexErrorCode } from "./types.js";
import type { YandexAssociation } from "./journal.js";

export type YandexStatusClear =
  "error" | "pauseReason" | "conflict" | "choiceAction" | "progress" | "comparison";

export function yandexUnchangedStatus(association: YandexAssociation): Partial<CloudSyncStatus> {
  return {
    phase: association.heads.length > 1 ? "conflict" : "idle",
    pendingChanges: false,
    lastSyncedAt: association.syncedAt
  };
}

export function yandexInspectionStatus(
  comparison: CloudComparison,
  phase: CloudPhase,
  review?: CloudSelection
): Partial<CloudSyncStatus> {
  return {
    comparison,
    phase: review ? "error" : phase,
    ...(review
      ? {
          error: "local-changed" as const,
          choiceAction: { selection: review, state: "review" as const }
        }
      : {})
  };
}

export function yandexAcceptedStatus(
  status: CloudSyncStatus,
  heads: readonly string[],
  syncedAt: string
): { patch: Partial<CloudSyncStatus>; clear: readonly YandexStatusClear[] } {
  const choiceAction = status.choiceAction,
    comparison = status.comparison ?? status.conflict,
    selection = choiceAction?.selection,
    received = selection?.kind === "remote" && heads.length > 1,
    selected =
      selection?.kind === "remote"
        ? comparison?.remotes.find(({ id }) => id === selection.id)
        : undefined;
  return {
    patch: {
      phase: received ? "conflict" : "idle",
      pendingChanges: false,
      lastSyncedAt: syncedAt,
      ...(received && comparison
        ? {
            conflict: {
              local: selected ?? comparison.local,
              remotes: comparison.remotes
            }
          }
        : {}),
      ...(choiceAction ? { choiceAction: { ...choiceAction, state: "confirmed" as const } } : {})
    },
    clear: received
      ? ["error", "pauseReason", "progress", "comparison"]
      : ["error", "pauseReason", "conflict", "progress", "comparison"]
  };
}

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
    ...(selection
      ? {
          choiceAction: {
            selection,
            state: code === "local-changed" ? ("review" as const) : ("unconfirmed" as const)
          }
        }
      : {})
  };
}
