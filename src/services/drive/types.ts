export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const DRIVE_CLIENT_ID =
  "570894753392-14e7houtg7kc4cdeq6ndpjo7e7sbvnc1.apps.googleusercontent.com";
export const DRIVE_NAMESPACE = "mtp-drive-v2";
export const LEGACY_DRIVE_NAMESPACE = "mtp-drive-v1";
export type DriveErrorCode =
  | "unsupported-format"
  | "auth-required"
  | "auth-cancelled"
  | "not-ready"
  | "busy"
  | "network"
  | "local-save"
  | "quota"
  | "permission"
  | "remote-invalid"
  | "conflict"
  | "limit";
export class DriveError extends Error {
  constructor(
    public readonly code: DriveErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "DriveError";
  }
}
export interface DriveAuthorization {
  readonly connectionId: string;
  readonly signal: AbortSignal;
  readonly stored?: boolean;
  readonly persistenceError?: boolean;
  getAccessToken(): string;
  invalidate(): void;
}
export interface DriveFile {
  id: string;
  name: string;
  size: number;
  appProperties: Record<string, string>;
}
export type DriveKind = "blob" | "snapshot";
export interface DriveStore {
  list(kind: DriveKind): Promise<DriveFile[]>;
  read(file: DriveFile, maxBytes: number): Promise<Blob>;
  create(kind: DriveKind, key: string, hash: string, body: Blob): Promise<DriveFile>;
}
export interface ContentReference {
  sha256: string;
  size: number;
}
export interface SnapshotManifest {
  protocol: 1;
  nodeId: string;
  deviceId: string;
  parents: string[];
  createdAt: string;
  payload: ContentReference;
  images: (ContentReference & { index: number; mimeType: string })[];
}
export interface RemoteSnapshot {
  manifest: SnapshotManifest;
  file: DriveFile;
}
export interface DriveInspection {
  snapshots: RemoteSnapshot[];
  heads: string[];
  conflict: boolean;
}

/** Local-only durable profile binding. Never upload this record or a bank owner. */
export interface DriveLocalAssociation {
  schemaVersion: 1;
  markerId: string;
  deviceId: string;
  baseHeads: string[];
  lastSyncedDigest?: string;
}
