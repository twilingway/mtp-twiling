import type { DeviceWorkspaceBinding } from "../workspace-identity.js";
import type { DriveBridge, DriveStatus } from "./coordinator-types.js";

export function matchesDriveWorkspace(
  profile: ReturnType<DriveBridge["profile"]>,
  owner: string,
  cloudOwner: string,
  session: unknown
): boolean {
  return (
    profile.owner === owner &&
    (profile.cloudOwner ?? profile.owner) === cloudOwner &&
    profile.session === session
  );
}

export function suspendedDriveStatus(): Partial<DriveStatus> {
  return {
    phase: "disconnected",
    connected: false,
    connectedThisSession: undefined,
    automaticBlockedByFormat: undefined,
    conflict: undefined,
    choiceAction: undefined,
    error: undefined,
    authorizationStored: false,
    credentialSaveError: false,
    pauseReason: undefined,
    legacyAvailable: false,
    lastOperation: undefined
  };
}

/** Association and encrypted credentials keep their original authenticated namespace. */
export function driveWorkspaceBinding(binding: DeviceWorkspaceBinding | undefined) {
  return {
    cloudOwner: binding?.cloudOwner,
    associationConflict:
      binding?.conflicts.some(
        (conflict) =>
          conflict.kind === "cloud-association" && conflict.key === "ambiguous-associations"
      ) ?? false
  };
}

/** The explicit namespace uses separators excluded by the legacy owner grammar. */
export function googleSlotStorageOwner(scope: {
  cloudOwner: string;
  associationConflict: boolean;
}) {
  return scope.associationConflict ? "device:drive-slot:explicit" : scope.cloudOwner;
}
