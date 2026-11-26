import { isRecord } from "../../model/backup-format.js";
import { getTechnicalIndicatorDefinition } from "../../model/technical-indicators/definitions.js";
import { sanitizeDriveBackup } from "./backup.js";
import type { Backup } from "../../model/types.js";
import { DriveError, type DriveInspection } from "./types.js";

export const unsupportedDriveFormat = () =>
  new DriveError("unsupported-format", "Update the application; sync data is retained.");

function exact(value: unknown, keys: readonly string[]): void {
  if (isRecord(value) && Object.keys(value).some((key) => !keys.includes(key)))
    throw unsupportedDriveFormat();
}
/** Capability checks precede the legacy allowlist, so unknown data cannot disappear. */
export function assertReadableDrivePayload(value: unknown): Backup {
  if (!isRecord(value)) return sanitizeDriveBackup(value);
  if (typeof value.schemaVersion === "number" && ![1, 2].includes(value.schemaVersion))
    throw unsupportedDriveFormat();
  const indicators = isRecord(value.layout) ? value.layout.technicalIndicators : undefined;
  if (Array.isArray(indicators))
    for (const instance of indicators) {
      if (!isRecord(instance)) continue;
      if (typeof instance.schemaVersion === "number" && instance.schemaVersion !== 1)
        throw unsupportedDriveFormat();
      exact(instance, [
        "schemaVersion",
        "id",
        "definitionId",
        "params",
        "pane",
        "visible",
        "order",
        "styles"
      ]);
      const definition =
        typeof instance.definitionId === "string"
          ? getTechnicalIndicatorDefinition(instance.definitionId)
          : undefined;
      if (
        typeof instance.definitionId === "string" &&
        (!definition || definition.status !== "computed")
      )
        throw unsupportedDriveFormat();
      if (definition?.status === "computed") {
        exact(
          instance.params,
          definition.parameters.map((parameter) => parameter.key)
        );
        exact(
          instance.styles,
          definition.outputs.map((output) => output.id)
        );
      }
      exact(
        instance.pane,
        isRecord(instance.pane) && instance.pane.kind === "overlay" ? ["kind"] : ["kind", "id"]
      );
      if (isRecord(instance.styles))
        for (const style of Object.values(instance.styles))
          exact(style, ["color", "width", "visible", "opacity", "lineStyle"]);
    }
  const projected = sanitizeDriveBackup(value);
  assertNoDiscardedFields(value, projected);
  return projected;
}
function assertNoDiscardedFields(raw: unknown, projected: unknown): void {
  if (Array.isArray(raw) && Array.isArray(projected)) {
    raw.forEach((item, index) => assertNoDiscardedFields(item, projected[index]));
  } else if (isRecord(raw) && isRecord(projected)) {
    for (const [key, item] of Object.entries(raw)) {
      if (item === undefined) continue;
      if (!Object.hasOwn(projected, key)) throw unsupportedDriveFormat();
      assertNoDiscardedFields(item, projected[key]);
    }
  }
}
export function assertReadableDriveManifest(value: unknown): void {
  if (isRecord(value) && typeof value.protocol === "number" && value.protocol !== 1)
    throw unsupportedDriveFormat();
  exact(value, ["protocol", "nodeId", "deviceId", "parents", "createdAt", "payload", "images"]);
  if (isRecord(value)) {
    exact(value.payload, ["sha256", "size"]);
    if (Array.isArray(value.images))
      for (const image of value.images) exact(image, ["sha256", "size", "index", "mimeType"]);
  }
}
/** Content identity, not Drive file ID: identical duplicate files are harmless. */
export function driveInspectionIdentity(inspection: DriveInspection): string {
  return JSON.stringify([
    [...inspection.heads].sort(),
    inspection.snapshots
      .map(({ manifest, file }) => [manifest.nodeId, file.appProperties.mtpHash])
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  ]);
}
export function assertDriveInspectionUnchanged(
  before: DriveInspection,
  after: DriveInspection
): void {
  const hashes = new Map(
    before.snapshots.map(({ manifest, file }) => [manifest.nodeId, file.appProperties.mtpHash])
  );
  for (const { manifest, file } of after.snapshots)
    if (hashes.has(manifest.nodeId) && hashes.get(manifest.nodeId) !== file.appProperties.mtpHash)
      throw new DriveError("remote-invalid", "An immutable Drive snapshot changed.");
  if (driveInspectionIdentity(before) !== driveInspectionIdentity(after))
    throw new DriveError("conflict", "Drive heads changed during validation.");
}
