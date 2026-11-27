import { DriveError } from "./types.js";
import type { DriveFile, DriveKind } from "./types.js";

const hashPattern = /^[a-f0-9]{64}$/;
const invalid = () => new DriveError("remote-invalid", "Invalid legacy archive file identity.");

/** Validate addressing metadata without interpreting or projecting the preserved file contents. */
export function assertLegacyOverlayFile(file: DriveFile, namespace: string, kind: DriveKind): void {
  const properties = file.appProperties;
  if (
    typeof file.id !== "string" ||
    !file.id ||
    file.id.length > 1024 ||
    typeof file.name !== "string" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    (file.version !== undefined && typeof file.version !== "string") ||
    !properties ||
    typeof properties !== "object" ||
    Object.keys(properties).length > 128 ||
    Object.entries(properties).some(
      ([key, value]) => key.length > 256 || typeof value !== "string" || value.length > 1024
    ) ||
    properties.mtpNamespace !== namespace ||
    properties.mtpKind !== kind ||
    typeof properties.mtpKey !== "string" ||
    !properties.mtpKey ||
    typeof properties.mtpHash !== "string" ||
    !hashPattern.test(properties.mtpHash) ||
    (kind === "blob" && properties.mtpKey !== properties.mtpHash)
  )
    throw invalid();
}

export function legacySnapshotIdentity(file: DriveFile): string {
  return JSON.stringify([
    file.appProperties.mtpNamespace,
    file.appProperties.mtpKey,
    file.appProperties.mtpHash,
    file.size
  ]);
}

export function legacyPhysicalIdentity(file: DriveFile): string {
  return JSON.stringify([
    file.id,
    file.version ?? null,
    file.size,
    Object.entries(file.appProperties).sort(([left], [right]) => left.localeCompare(right))
  ]);
}

/** Keep every branch: equal node IDs with different bytes cannot be resolved by listing order. */
export function assertLegacyOverlayAgreement(files: readonly DriveFile[]): void {
  const contents = new Map<string, string>();
  for (const file of files) {
    const { mtpNamespace, mtpKind, mtpKey, mtpHash } = file.appProperties;
    const key = JSON.stringify([mtpNamespace, mtpKind, mtpKey]);
    const value = JSON.stringify([mtpHash, file.size]);
    const previous = contents.get(key);
    if (previous !== undefined && previous !== value)
      throw new DriveError(
        "conflict",
        "Live and archived legacy files contain conflicting versions."
      );
    contents.set(key, value);
  }
}
