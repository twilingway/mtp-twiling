import { strongDeviceSlotTag } from "./device-slot-cas.js";
import type { RawLegacyFile } from "./legacy-raw-archive-types.js";
import type { CompactionReceipt } from "./legacy-compaction-types.js";
import {
  invalidRetention,
  RAW_ARCHIVE_LIMIT,
  RAW_SOURCE_LIMIT,
  validFileId,
  validHash
} from "./legacy-raw-archive-http.js";

function ownData(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw invalidRetention();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))
      throw invalidRetention();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property)) throw invalidRetention();
    result[key] = property.value as unknown;
  }
  return result;
}
/** Synchronously pins both the physical target and all ownership properties before any await. */
export function pinRawLegacyFile(input: RawLegacyFile): RawLegacyFile {
  const file = ownData(input),
    props = ownData(file.appProperties);
  if (
    Object.keys(props).length > 128 ||
    Object.entries(props).some(
      ([key, value]) => key.length > 256 || typeof value !== "string" || value.length > 4096
    ) ||
    typeof file.fileId !== "string" ||
    !validFileId(file.fileId) ||
    (file.namespace !== "mtp-drive-v1" && file.namespace !== "mtp-drive-v2") ||
    (file.kind !== "snapshot" && file.kind !== "blob") ||
    typeof file.key !== "string" ||
    !file.key ||
    file.key.length > 512 ||
    typeof file.version !== "string" ||
    !/^\d{1,20}$/.test(file.version) ||
    typeof file.etag !== "string" ||
    typeof file.sha256 !== "string" ||
    !validHash(file.sha256) ||
    typeof file.size !== "number" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > RAW_SOURCE_LIMIT ||
    props.mtpNamespace !== file.namespace ||
    props.mtpKind !== file.kind ||
    props.mtpKey !== file.key
  )
    throw invalidRetention();
  return Object.freeze({
    fileId: file.fileId,
    namespace: file.namespace,
    kind: file.kind,
    key: file.key,
    version: file.version,
    etag: strongDeviceSlotTag(file.etag),
    size: file.size,
    sha256: file.sha256,
    appProperties: Object.freeze({ ...props }) as Readonly<Record<string, string>>
  });
}
export function pinCompactionReceipt(input: CompactionReceipt): CompactionReceipt {
  const value = ownData(input);
  if (
    typeof value.fileId !== "string" ||
    !validFileId(value.fileId) ||
    typeof value.sha256 !== "string" ||
    !validHash(value.sha256) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > RAW_ARCHIVE_LIMIT
  )
    throw invalidRetention();
  return Object.freeze({ fileId: value.fileId, size: value.size, sha256: value.sha256 });
}
