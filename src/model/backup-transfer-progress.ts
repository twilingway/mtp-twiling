import type { Backup } from "./types.js";

export interface BackupFileSummary {
  instruments?: number;
  drawings: number;
  images: number;
}

export function summarizeBackupFile(backup: Backup): BackupFileSummary {
  return {
    ...(backup.watchlist === undefined ? {} : { instruments: backup.watchlist.length }),
    drawings: backup.drawings.reduce((count, document) => count + document.items.length, 0),
    images: backup.images.length
  };
}

export type ExportStorageStage = "flush" | "collect";
export type ExportStorageObserver = (stage: ExportStorageStage) => void;

export type FileImportProgress =
  | { stage: "read" | "validate"; summary?: never }
  | { stage: "write" | "restore"; summary: BackupFileSummary };

export type FileImportObserver = (progress: FileImportProgress) => void;
