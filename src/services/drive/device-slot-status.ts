import type {
  CloudErrorCode,
  CloudClientMode,
  CloudProgress,
  CloudRemoteChoice,
  CloudSyncStatus
} from "../../model/cloud-sync.js";
import type { Backup } from "../../model/types.js";
import { summarize } from "./coordinator-types.js";
import { DeviceSlotCasError } from "./device-slot-cas.js";
import type { GoogleArchiveStatus } from "./device-slot-migration.js";
import type { SlotPreview, SlotSyncResult } from "./device-slot-sync.js";
import type { DriveOperationTime, DriveProgress, DriveStage } from "./progress.js";
import { DriveError } from "./types.js";
import type { WriteCapabilityStatus } from "./write-capability.js";
import type { LegacyCompactionProgress, LegacyLateInspection } from "./legacy-compaction-types.js";
import { cloudClientLabel, defaultCloudClientMode } from "../../model/cloud-client-identity.js";

export const googleClientStatus = (mode: CloudClientMode) => ({
  mode,
  clientMode: mode,
  clientLabel: cloudClientLabel(mode)
});

export interface GoogleStatus extends CloudSyncStatus {
  mode: "normal" | "test";
  migrationRequired?: boolean;
  uploadProbeBytes: number;
  writeCapability?: WriteCapabilityStatus;
  driveProgress?: DriveProgress;
  lastOperation?: DriveOperationTime;
  previousVersions?: readonly { id: string; deviceId: string; size: number }[];
  archive?: GoogleArchiveStatus;
  compaction?: Omit<Partial<LegacyCompactionProgress>, "phase"> & {
    phase: LegacyCompactionProgress["phase"] | "checking" | "paused";
    error?: CloudErrorCode;
    checkedFiles?: number;
    totalFiles?: number;
  };
  legacyArchives?: readonly { id: string; createdAt: string; bytes: number; fileCount?: number }[];
  legacyLateChanges?: readonly LegacyLateInspection[];
}

export type GoogleTransientStatusKey =
  | "error"
  | "pauseReason"
  | "conflict"
  | "comparison"
  | "archive"
  | "progress"
  | "driveProgress"
  | "writeCapability"
  | "choiceAction"
  | "lastSyncedAt"
  | "previousVersions"
  | "compaction"
  | "legacyArchives"
  | "legacyLateChanges"
  | "migrationRequired";

export const replacedGoogleAccountStatusKeys = [
  "conflict",
  "comparison",
  "choiceAction",
  "lastSyncedAt",
  "previousVersions",
  "migrationRequired",
  "compaction",
  "legacyArchives",
  "legacyLateChanges"
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
  ...googleClientStatus(
    defaultCloudClientMode(
      globalThis.location,
      !!globalThis.document?.querySelector?.('script[type="module"][src="/__dev/client.js"]')
    )
  ),
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
  error: CloudErrorCode | undefined,
  receipt?: GoogleStatus["choiceAction"]
): NonNullable<GoogleStatus["choiceAction"]>["state"] {
  if (receipt?.state === "confirmed") return "confirmed";
  return error === "indeterminate" ? "unconfirmed" : error === "conflict" ? "review" : "blocked";
}

export function deviceSlotOutcome(
  result: SlotSyncResult,
  archive: GoogleArchiveStatus | undefined,
  archiveChoices: readonly CloudRemoteChoice[] | undefined,
  local: Backup,
  newLocalChanges: boolean
): Partial<GoogleStatus> {
  if (result.state === "comparison" || result.state === "received") {
    const { preview, checkedAt } = result;
    const comparison = {
      local: preview.conflict.local,
      remotes: preview.conflict.remotes.map(({ nodeId, ...summary }) => ({
        ...summary,
        id: nodeId
      })),
      checkedAt
    };
    if (result.state === "comparison") return { comparison };
    const outcome: SlotSyncResult =
      preview.snapshot.heads.length > 1
        ? { state: "choice", record: result.record, preview }
        : { state: "idle", record: result.record, snapshot: preview.snapshot };
    return {
      ...deviceSlotOutcome(outcome, archive, archiveChoices, local, newLocalChanges),
      comparison
    };
  }
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

export function googleSlotReceiveReceipt(
  status: GoogleStatus,
  backup: Backup,
  id: string
): Partial<GoogleStatus> {
  return {
    choiceAction: { selection: { kind: "remote", id }, state: "confirmed" },
    ...(status.conflict ? { conflict: { ...status.conflict, local: summarize(backup) } } : {})
  };
}

export function googleSlotPublication(
  result: SlotSyncResult,
  status: GoogleStatus,
  previous: SlotPreview | undefined,
  archive: GoogleArchiveStatus | undefined,
  archiveChoices: readonly CloudRemoteChoice[] | undefined,
  local: Backup,
  localChanged: boolean
): {
  preview: SlotPreview | undefined;
  comparisonPreview: SlotPreview | undefined;
  clear: GoogleTransientStatusKey[];
  patch: Partial<GoogleStatus>;
} {
  const phase = status.conflict ? "conflict" : "idle";
  if (result.state === "legacy-inspection")
    return {
      preview: previous,
      comparisonPreview: undefined,
      clear: ["comparison"],
      patch: { migrationRequired: true, phase }
    };
  if (result.state === "comparison")
    return {
      preview: previous,
      comparisonPreview: result.preview,
      clear: [],
      patch: { ...deviceSlotOutcome(result, undefined, undefined, local, localChanged), phase }
    };
  return {
    preview:
      result.state === "choice" ||
      (result.state === "received" && result.preview.snapshot.heads.length > 1)
        ? result.preview
        : undefined,
    comparisonPreview: result.state === "received" ? result.preview : undefined,
    clear: ["error", "pauseReason", "conflict", "archive", "comparison"],
    patch: deviceSlotOutcome(result, archive, archiveChoices, local, localChanged)
  };
}
