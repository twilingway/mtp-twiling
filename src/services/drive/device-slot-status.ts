import type {
  CloudErrorCode,
  CloudProgress,
  CloudRemoteChoice,
  CloudSyncStatus
} from "../../model/cloud-sync.js";
import type { Backup } from "../../model/types.js";
import { summarize } from "./coordinator-types.js";
import { DeviceSlotCasError } from "./device-slot-cas.js";
import type { GoogleArchiveStatus } from "./device-slot-migration.js";
import type { SlotSyncResult } from "./device-slot-sync.js";
import type { DriveOperationTime, DriveProgress, DriveStage } from "./progress.js";
import { DriveError } from "./types.js";
import type { WriteCapabilityStatus } from "./write-capability.js";

export interface GoogleStatus extends CloudSyncStatus {
  mode: "normal" | "test";
  migrationRequired?: boolean;
  uploadProbeBytes: number;
  writeCapability?: WriteCapabilityStatus;
  driveProgress?: DriveProgress;
  lastOperation?: DriveOperationTime;
  previousVersions?: readonly { id: string; deviceId: string; size: number }[];
  archive?: GoogleArchiveStatus;
}

export type GoogleTransientStatusKey =
  | "error"
  | "pauseReason"
  | "conflict"
  | "archive"
  | "progress"
  | "driveProgress"
  | "writeCapability"
  | "choiceAction"
  | "lastSyncedAt"
  | "previousVersions"
  | "migrationRequired";

export const replacedGoogleAccountStatusKeys = [
  "conflict",
  "choiceAction",
  "lastSyncedAt",
  "previousVersions",
  "migrationRequired"
] satisfies GoogleTransientStatusKey[];

const stageNames: Record<DriveStage, CloudProgress["stage"]> = {
  "collect-local": "validate",
  "read-versions": "inspect",
  "check-versions": "validate",
  "prepare-upload": "validate",
  upload: "upload",
  download: "download",
  confirm: "verify",
  apply: "apply",
  "save-status": "save"
};
export function googleSlotProgress(driveProgress: DriveProgress): Partial<GoogleStatus> {
  const transfer = driveProgress.transfer;
  return {
    driveProgress,
    progress: {
      stage: stageNames[driveProgress.stage],
      ...(transfer ? { completedBytes: transfer.transferredBytes } : {})
    }
  };
}

export const initialGoogleSlotStatus = (enabled = false): GoogleStatus => ({
  provider: "google-drive",
  enabled,
  configured: true,
  phase: enabled ? "disconnected" : "disabled",
  prepared: false,
  preparing: false,
  connected: false,
  automatic: true,
  pendingChanges: false,
  authorizationStored: false,
  credentialSaveError: false,
  mode: "normal",
  uploadProbeBytes: 0
});

export function operationError(error: unknown): CloudErrorCode {
  if (error instanceof DeviceSlotCasError)
    return error.issue === "unconfirmed"
      ? "indeterminate"
      : error.issue === "probe" || error.issue === "validator"
        ? "not-ready"
        : "remote-invalid";
  if (error instanceof DriveError) return error.code;
  if (error instanceof Error && "code" in error) {
    if (error.code === "local-changed" || error.code === "remote-invalid" || error.code === "limit")
      return error.code;
  }
  return "local-save";
}

export function googleSlotChoiceFailure(
  error: CloudErrorCode | undefined
): NonNullable<GoogleStatus["choiceAction"]>["state"] {
  return error === "indeterminate" ? "unconfirmed" : error === "conflict" ? "review" : "blocked";
}

export function deviceSlotOutcome(
  result: SlotSyncResult,
  archive: GoogleArchiveStatus | undefined,
  archiveChoices: readonly CloudRemoteChoice[] | undefined,
  local: Backup,
  newLocalChanges: boolean
): Partial<GoogleStatus> {
  const snapshot =
    result.state === "idle"
      ? result.snapshot
      : result.state === "choice"
        ? result.preview.snapshot
        : undefined;
  const previousVersions =
    snapshot?.files.flatMap(({ envelope }) =>
      envelope.previous
        ? [
            {
              id: envelope.previous.revisionId,
              deviceId: envelope.previous.deviceId,
              size: envelope.previous.payload.size
            }
          ]
        : []
    ) ?? [];
  const legacyChoices = result.state === "migration" ? archiveChoices : undefined;
  return {
    phase: result.state === "idle" ? "idle" : result.state === "pending" ? "error" : "conflict",
    pendingChanges: result.state !== "idle" || newLocalChanges,
    migrationRequired: result.state === "migration",
    previousVersions,
    ...(archive ? { archive } : {}),
    ...(result.state === "pending" ? { error: "indeterminate" as const } : {}),
    ...(result.state === "choice"
      ? {
          conflict: {
            local: result.preview.conflict.local,
            remotes: result.preview.conflict.remotes.map(({ nodeId, ...summary }) => ({
              ...summary,
              id: nodeId
            }))
          }
        }
      : {}),
    ...(legacyChoices ? { conflict: { local: summarize(local), remotes: legacyChoices } } : {}),
    ...(result.record.lastSyncedAt ? { lastSyncedAt: result.record.lastSyncedAt } : {})
  };
}
