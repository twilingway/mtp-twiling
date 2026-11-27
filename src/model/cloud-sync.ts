export type CloudProviderId = "google-drive" | "yandex-disk";
export type CloudClientMode = "normal" | "test";
export type CloudErrorCode =
  | "configuration-required"
  | "auth-required"
  | "auth-cancelled"
  | "not-ready"
  | "busy"
  | "network"
  | "local-save"
  | "quota"
  | "permission"
  | "remote-invalid"
  | "unsupported-format"
  | "conflict"
  | "limit"
  | "local-changed"
  | "indeterminate";
export type CloudPhase =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "idle"
  | "syncing"
  | "conflict"
  | "auth-required"
  | "error";
export type CloudSelection = { kind: "local" } | { kind: "remote"; id: string };
export type CloudChoiceState = "running" | "confirmed" | "review" | "blocked" | "unconfirmed";
export interface CloudSummary {
  instruments: number;
  drawings: number;
  images: number;
  date?: string;
}
export interface CloudRemoteChoice extends CloudSummary {
  id: string;
  deviceLabel?: string;
  readonly deviceId?: string;
}
export interface CloudComparison {
  local: CloudSummary;
  remotes: readonly CloudRemoteChoice[];
  checkedAt: string;
}
export interface CloudProgress {
  stage: "inspect" | "download" | "validate" | "upload" | "verify" | "apply" | "save";
  completedBytes?: number;
  totalBytes?: number;
}
export interface CloudRetentionStatus {
  phase: "pending" | "complete";
  keptFiles?: number;
  deletedFiles?: number;
  error?: CloudErrorCode;
}
export interface CloudSyncStatus {
  provider: CloudProviderId;
  enabled: boolean;
  configured: boolean;
  prepared: boolean;
  preparing: boolean;
  connected: boolean;
  automatic: boolean;
  phase: CloudPhase;
  pendingChanges: boolean;
  authorizationStored: boolean;
  credentialSaveError: boolean;
  clientMode?: CloudClientMode;
  clientLabel?: string;
  retention?: CloudRetentionStatus;
  lastSyncedAt?: string;
  error?: CloudErrorCode;
  pauseReason?: "offline" | "auth-required" | "network" | "configuration-required";
  conflict?: { local: CloudSummary; remotes: readonly CloudRemoteChoice[] };
  comparison?: CloudComparison;
  choiceAction?: { selection: CloudSelection; state: CloudChoiceState };
  progress?: CloudProgress;
}
export interface CloudSyncProvider {
  readonly id: CloudProviderId;
  getSnapshot(this: void): CloudSyncStatus;
  subscribe(this: void, listener: () => void): () => void;
  prepare(): Promise<void>;
  resume(): void;
  profileChanged(): void;
  localIntent(): void;
  localChanged(): void;
  setEnabled(enabled: boolean): Promise<void>;
  setAutomatic(automatic: boolean): Promise<void>;
  setClientMode?(mode: CloudClientMode): Promise<void>;
  connectFromUserGesture(): Promise<void>;
  disconnect(): Promise<void>;
  sync(): Promise<void>;
  /** Reads versions without publishing, importing, or acknowledging synchronization. */
  inspect?(): Promise<void>;
  /** Applies a pinned remote version locally; does not publish a cloud conflict resolution. */
  receive?(id: string): Promise<void>;
  choose(selection: CloudSelection): Promise<void>;
  dispose(): void;
}
