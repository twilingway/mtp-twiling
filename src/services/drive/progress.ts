export type DriveStage =
  | "collect-local"
  | "read-versions"
  | "check-versions"
  | "prepare-upload"
  | "upload"
  | "download"
  | "confirm"
  | "apply"
  | "save-status";

export interface DriveTransferAmount {
  completedFiles: number;
  totalFiles: number;
  transferredBytes: number;
}
interface DriveProgressDetails {
  transfer?: DriveTransferAmount;
  listedVersions?: number;
}
export type DriveReport = (stage: DriveStage, details?: DriveProgressDetails) => void;
export interface DriveStageTime {
  stage: DriveStage;
  elapsedMs: number;
}
export interface DriveProgress {
  stage: DriveStage;
  startedAt: number;
  stageStartedAt: number;
  previous: readonly DriveStageTime[];
  transfer?: DriveTransferAmount | undefined;
  listedVersions?: number | undefined;
}
export interface DriveOperationTime {
  elapsedMs: number;
  stages: readonly DriveStageTime[];
  listedVersions?: number;
}

export function beginDriveProgress(
  stage: DriveStage = "collect-local",
  now = performance.now()
): DriveProgress {
  return { stage, startedAt: now, stageStartedAt: now, previous: [] };
}

export function advanceDriveProgress(
  current: DriveProgress,
  stage: DriveStage,
  details?: DriveProgressDetails,
  now = performance.now()
): DriveProgress {
  const transfer = details?.transfer;
  const listedVersions = details?.listedVersions ?? current.listedVersions;
  if (stage === current.stage) return { ...current, transfer, listedVersions };
  return {
    stage,
    startedAt: current.startedAt,
    stageStartedAt: now,
    previous: [
      ...current.previous,
      { stage: current.stage, elapsedMs: now - current.stageStartedAt }
    ],
    transfer,
    listedVersions
  };
}

export function finishDriveProgress(
  current: DriveProgress,
  now = performance.now()
): DriveOperationTime {
  const stages = new Map<DriveStage, number>();
  for (const { stage, elapsedMs } of current.previous)
    stages.set(stage, (stages.get(stage) ?? 0) + elapsedMs);
  stages.set(current.stage, (stages.get(current.stage) ?? 0) + now - current.stageStartedAt);
  return {
    elapsedMs: now - current.startedAt,
    stages: Array.from(stages, ([stage, elapsedMs]) => ({ stage, elapsedMs })),
    ...(current.listedVersions === undefined ? {} : { listedVersions: current.listedVersions })
  };
}
