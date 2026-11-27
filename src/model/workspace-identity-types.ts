export const DEVICE_OWNER = "device" as const;
export interface WorkspaceMigrationConflict {
  sourceOwner: string;
  kind: "preferences" | "view" | "presentation" | "object-remap" | "cloud-association";
  key: string;
  recoveryRef: string;
}
export interface DeviceWorkspaceBinding {
  owner: typeof DEVICE_OWNER;
  primaryOwner: string;
  cloudOwner: string;
  legacyOwners: readonly string[];
  conflicts: readonly WorkspaceMigrationConflict[];
}
export interface DeviceWorkspaceOptions {
  preferredOwner?: string;
  valid: () => boolean;
  signal?: AbortSignal;
}
import type { Backup, ImageAsset } from "./types.js";
export interface WorkspaceSource {
  owner: string;
  physical: string;
  backup: Backup;
  images: readonly { image: ImageAsset; content: string }[];
  cameras: readonly Record<string, unknown>[];
  history: readonly Record<string, unknown>[];
  coverage: readonly Record<string, unknown>[];
  populated: boolean;
}
export interface WorkspaceWrite {
  store: "preferences" | "drawings" | "images" | "history" | "coverage";
  value: Record<string, unknown>;
}
export interface WorkspaceMerge {
  writes: WorkspaceWrite[];
  conflicts: WorkspaceMigrationConflict[];
}
