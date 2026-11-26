import type { Backup } from "../../model/types.js";
import type { BackupImportOptions } from "../../model/backup-import.js";
import type { DriveAuth } from "./auth.js";
import type { DriveSync } from "./sync.js";
import type { DriveAuthorization, DriveLocalAssociation, DriveErrorCode } from "./types.js";

export interface DriveRecord extends DriveLocalAssociation {
  lastSyncedAt?: string;
  automatic: boolean;
  pendingChanges?: boolean;
}
export interface DriveSummary {
  instruments: number;
  drawings: number;
  images: number;
  date?: string;
}
export interface DriveChoice extends DriveSummary {
  nodeId: string;
}
export interface DriveConflict {
  local: DriveSummary;
  remotes: DriveChoice[];
}
export interface DriveStatus {
  legacyAvailable?: boolean;
  phase:
    "disconnected" | "connecting" | "idle" | "syncing" | "conflict" | "auth-required" | "error";
  prepared: boolean;
  preparing: boolean;
  connected: boolean;
  connectedThisSession?: boolean | undefined;
  automatic: boolean;
  automaticBlockedByFormat?: boolean | undefined;
  pendingChanges: boolean;
  pauseReason?: "offline" | "auth-required" | "network" | undefined;
  authorizationStored: boolean;
  credentialSaveError: boolean;
  lastSyncedAt?: string | undefined;
  error?: DriveErrorCode | "local-changed" | undefined;
  conflict?: DriveConflict | undefined;
}
export interface DriveBridge {
  profile(): { owner: string; session: unknown; authenticated: boolean; blocked: boolean };
  exportBackup(): Promise<Backup>;
  importBackup(backup: Backup, options: BackupImportOptions): Promise<void>;
}
export interface DriveDependencies {
  legacySync?(authorization: DriveAuthorization): Pick<DriveSync, "inspect" | "download">;
  auth: Pick<
    DriveAuth,
    "prepare" | "connectFromUserGesture" | "disconnect" | "restore" | "suspend"
  >;
  online?(): boolean;
  sync(
    authorization: DriveAuthorization
  ): Pick<DriveSync, "inspect" | "download" | "validateHeads" | "publish" | "resolve">;
  load(owner: string): Promise<DriveRecord>;
  save(owner: string, record: DriveRecord): Promise<void>;
}
export function summarize(backup: Backup, date = backup.exportedAt): DriveSummary {
  return {
    instruments: backup.watchlist?.length ?? 0,
    drawings: backup.drawings.reduce((sum, item) => sum + item.items.length, 0),
    images: backup.images.length,
    ...(date ? { date } : {})
  };
}
