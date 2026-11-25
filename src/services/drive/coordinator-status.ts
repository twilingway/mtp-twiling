import { DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
import type { DriveDependencies, DriveStatus } from "./coordinator-types.js";

type Update = (patch: Partial<DriveStatus>) => void;
export async function prepareDriveIdentity(
  auth: DriveDependencies["auth"],
  status: DriveStatus,
  update: Update
): Promise<void> {
  if (status.prepared || status.preparing) return;
  update({ preparing: true });
  try {
    await auth.prepare();
    update({ prepared: true });
  } catch {
    update({ phase: "error", error: "network" });
  } finally {
    update({ preparing: false });
  }
}
export function driveFailure(
  status: DriveStatus,
  error: unknown,
  update: Update,
  schedule: () => void
): void {
  if (!status.connected && status.phase === "auth-required") return;
  if (error instanceof DOMException && error.name === "AbortError") {
    update({ phase: "idle", error: "local-changed" });
    schedule();
    return;
  }
  const code = error instanceof DriveError ? error.code : "network";
  update({
    phase: code === "auth-required" ? "auth-required" : "error",
    error: code,
    pauseReason:
      code === "network" ? "network" : code === "auth-required" ? "auth-required" : undefined
  });
}
export function driveAvailable(
  authorization: DriveAuthorization | undefined,
  dependencies: DriveDependencies,
  update: Update
): boolean {
  if (!authorization) return false;
  try {
    authorization.getAccessToken();
  } catch {
    authorization.invalidate();
    update({
      phase: "auth-required",
      connected: false,
      error: "auth-required",
      pauseReason: "auth-required",
      authorizationStored: false
    });
    return false;
  }
  if (dependencies.online?.() === false) {
    update({ phase: "error", error: "network", pauseReason: "offline" });
    return false;
  }
  return true;
}
