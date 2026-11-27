import { DriveError } from "./types.js";
import type {
  DecodedRawArchive,
  EncodedRawArchive,
  RawArchiveIndex,
  RawArchiveMetadata,
  RawArchiveReference,
  RawLegacyFile,
  RawLegacyObject
} from "./legacy-raw-archive-types.js";

export const MAX_RAW_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_RAW_ARCHIVE_INDEX_BYTES = 1024 * 1024;
export const MAX_RAW_ARCHIVE_FILES = 2048;
export const MAX_RAW_SOURCE_BYTES = 256 * 1024 * 1024;
const MAGIC = new TextEncoder().encode("MTPRAW");
const PREFIX_SIZE = MAGIC.length + 1 + 4 + 32;
const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9_.:@-]{1,256}$/;
const FILE_KEYS = [
  "fileId",
  "namespace",
  "kind",
  "key",
  "version",
  "etag",
  "size",
  "sha256",
  "appProperties"
] as const;
const METADATA_KEYS = ["operationId", "workspaceId", "publicClientId", "createdAt"] as const;
const invalid = () => new DriveError("remote-invalid", "The raw Google archive is invalid.");
const limit = () => new DriveError("limit", "The raw Google archive exceeds its limits.");
const unsupported = () =>
  new DriveError("unsupported-format", "Unknown raw Google archive format.");

/** Read descriptors only: untrusted accessors and inherited properties are never evaluated. */
function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object") throw invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))
      throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
      throw invalid();
    result[key] = descriptor.value as unknown;
  }
  if (
    keys &&
    (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)))
  )
    throw invalid();
  return result;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid();
  if (value.length > MAX_RAW_ARCHIVE_FILES) throw limit();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw invalid();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
      throw invalid();
    result.push(descriptor.value as unknown);
  }
  return result;
}

const hasControls = (value: string) =>
  Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  );

function text(value: unknown, max: number, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    hasControls(value) ||
    (pattern && !pattern.test(value))
  )
    throw invalid();
  return value;
}

function integer(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid();
  if (value > max) throw limit();
  return value;
}

function properties(value: unknown): Readonly<Record<string, string>> {
  const input = record(value);
  const keys = Object.keys(input).sort();
  if (keys.length > 128) throw limit();
  const entries = keys.map((key) => {
    text(key, 256);
    const item = input[key];
    if (typeof item !== "string" || item.length > 1024 || hasControls(item)) throw invalid();
    return [key, item] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

function file(value: unknown, indexed = false): RawLegacyFile & { readonly offset?: number } {
  const input = record(value, indexed ? [...FILE_KEYS, "offset"] : FILE_KEYS);
  const namespace = input.namespace;
  const kind = input.kind;
  if (
    (namespace !== "mtp-drive-v1" && namespace !== "mtp-drive-v2") ||
    (kind !== "snapshot" && kind !== "blob")
  )
    throw invalid();
  const result: RawLegacyFile = {
    fileId: text(input.fileId, 256, IDENTIFIER),
    namespace,
    kind,
    key: text(input.key, 512),
    version: text(input.version, 40, /^[1-9]\d*$/),
    etag: text(input.etag, 514, /^"[\x21\x23-\x7e\x80-\xff]{0,512}"$/),
    size: integer(input.size, MAX_RAW_SOURCE_BYTES),
    sha256: text(input.sha256, 64, HASH),
    appProperties: properties(input.appProperties)
  };
  return Object.freeze(
    indexed ? { ...result, offset: integer(input.offset, MAX_RAW_ARCHIVE_BYTES) } : result
  );
}

function metadata(value: unknown): RawArchiveMetadata {
  const input = record(value, METADATA_KEYS);
  const createdAt = text(input.createdAt, 24, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt)
    throw invalid();
  return {
    operationId: text(input.operationId, 256, IDENTIFIER),
    workspaceId: text(input.workspaceId, 256, IDENTIFIER),
    publicClientId: text(input.publicClientId, 256, IDENTIFIER),
    createdAt
  };
}

function files(value: unknown, indexed = false): readonly ReturnType<typeof file>[] {
  const result = array(value).map((item) => file(item, indexed));
  const ids = new Set<string>();
  let size = 0;
  for (const item of result) {
    if (ids.has(item.fileId)) throw invalid();
    ids.add(item.fileId);
    size += item.size;
    if (size > MAX_RAW_ARCHIVE_BYTES) throw limit();
  }
  return result.sort((a, b) => (a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0));
}

function parseIndex(value: unknown): RawArchiveIndex {
  const input = record(value, ["formatVersion", ...METADATA_KEYS, "files"]);
  if (input.formatVersion !== 1) throw unsupported();
  const entries = files(input.files, true).map((item) => {
    if (item.offset === undefined) throw invalid();
    return Object.freeze({ ...item, offset: item.offset });
  });
  return Object.freeze({
    formatVersion: 1,
    ...metadata(Object.fromEntries(METADATA_KEYS.map((key) => [key, input[key]]))),
    files: Object.freeze(entries)
  });
}

function sourceFile(entry: RawLegacyFile): RawLegacyFile {
  return Object.fromEntries(FILE_KEYS.map((key) => [key, entry[key]])) as unknown as RawLegacyFile;
}

async function digest(body: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await body.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function snapshotBlob(value: unknown): Blob {
  if (!(value instanceof Blob)) throw invalid();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw invalid();
    // Node's genuine Blob.slice result owns a constructor data property.
    if (typeof key === "string" && (key !== "constructor" || descriptor.value !== Blob))
      throw invalid();
  }
  try {
    return new Blob([Blob.prototype.slice.call(value)]);
  } catch {
    throw invalid();
  }
}

export async function computeRawInventoryDigest(input: readonly RawLegacyFile[]): Promise<string> {
  return digest(new Blob([JSON.stringify(files(input))]));
}

export async function verifyRawArchiveCoverage(
  index: RawArchiveIndex,
  input: readonly RawLegacyFile[]
): Promise<boolean> {
  const parsed = parseIndex(index);
  const candidates = files(input);
  const [actual, expected] = await Promise.all([
    computeRawInventoryDigest(parsed.files.map(sourceFile)),
    computeRawInventoryDigest(candidates)
  ]);
  return actual === expected;
}

export async function encodeRawArchive(
  objects: readonly RawLegacyObject[],
  details: RawArchiveMetadata
): Promise<EncodedRawArchive> {
  const prepared = array(objects).map((value) => {
    const input = record(value, ["file", "body"]);
    const parsed = file(input.file);
    const body = snapshotBlob(input.body);
    if (body.size !== parsed.size) throw invalid();
    return { file: parsed, body };
  });
  files(prepared.map((item) => item.file));
  const detailsCopy = metadata(details);
  prepared.sort((a, b) =>
    a.file.fileId < b.file.fileId ? -1 : a.file.fileId > b.file.fileId ? 1 : 0
  );
  let offset = 0;
  const entries = prepared.map(({ file: item }) => {
    const entry = { ...item, offset };
    offset += item.size;
    return entry;
  });
  const index = parseIndex({ formatVersion: 1, ...detailsCopy, files: entries });
  const header = new Blob([JSON.stringify(index)]);
  if (
    header.size > MAX_RAW_ARCHIVE_INDEX_BYTES ||
    PREFIX_SIZE + header.size + offset > MAX_RAW_ARCHIVE_BYTES
  )
    throw limit();
  for (const object of prepared)
    if ((await digest(object.body)) !== object.file.sha256) throw invalid();
  const indexDigest = await digest(header);
  const prefix = new Uint8Array(PREFIX_SIZE);
  prefix.set(MAGIC);
  prefix[MAGIC.length] = 1;
  new DataView(prefix.buffer).setUint32(MAGIC.length + 1, header.size);
  prefix.set(
    indexDigest.match(/../g)!.map((part) => Number.parseInt(part, 16)),
    MAGIC.length + 5
  );
  const body = new Blob([prefix, header, ...prepared.map((item) => item.body)], {
    type: "application/octet-stream"
  });
  return Object.freeze({
    body,
    index,
    indexDigest,
    inventoryDigest: await computeRawInventoryDigest(prepared.map((item) => item.file)),
    sha256: await digest(body),
    size: body.size
  });
}

/** Verify every byte and metadata field before exposing any original source object. */
export async function decodeRawArchive(
  body: Blob,
  expectedReference?: RawArchiveReference
): Promise<DecodedRawArchive> {
  const snapshot = snapshotBlob(body);
  if (snapshot.size < PREFIX_SIZE) throw invalid();
  if (snapshot.size > MAX_RAW_ARCHIVE_BYTES) throw limit();
  let expected: Record<string, unknown> | undefined;
  if (expectedReference !== undefined) {
    expected = record(expectedReference);
    const keys = Object.keys(expected);
    if (
      keys.some((key) => !["size", "sha256", "indexDigest"].includes(key)) ||
      !keys.includes("size") ||
      !keys.includes("sha256")
    )
      throw invalid();
    if (integer(expected.size, MAX_RAW_ARCHIVE_BYTES) !== snapshot.size) throw invalid();
    text(expected.sha256, 64, HASH);
    if (Object.hasOwn(expected, "indexDigest")) text(expected.indexDigest, 64, HASH);
  }
  const prefix = new Uint8Array(await snapshot.slice(0, PREFIX_SIZE).arrayBuffer());
  if (!MAGIC.every((byte, position) => prefix[position] === byte)) throw invalid();
  if (prefix[MAGIC.length] !== 1) throw unsupported();
  const headerSize = new DataView(prefix.buffer).getUint32(MAGIC.length + 1);
  if (headerSize > MAX_RAW_ARCHIVE_INDEX_BYTES) throw limit();
  const payloadStart = PREFIX_SIZE + headerSize;
  if (!headerSize || payloadStart > snapshot.size) throw invalid();
  const header = snapshot.slice(PREFIX_SIZE, payloadStart);
  const indexDigest = await digest(header);
  const prefixDigest = Array.from(prefix.slice(MAGIC.length + 5), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  if (
    indexDigest !== prefixDigest ||
    (expected?.indexDigest !== undefined && expected.indexDigest !== indexDigest)
  )
    throw invalid();
  let textValue: string;
  let index: RawArchiveIndex;
  try {
    textValue = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await header.arrayBuffer()
    );
    index = parseIndex(JSON.parse(textValue) as unknown);
  } catch (error) {
    if (error instanceof DriveError) throw error;
    throw invalid();
  }
  if (JSON.stringify(index) !== textValue) throw invalid();
  const ranges = [...index.files].sort((a, b) => a.offset - b.offset || a.size - b.size);
  let end = 0;
  let previous: (typeof ranges)[number] | undefined;
  for (const entry of ranges) {
    const duplicate =
      previous &&
      entry.offset === previous.offset &&
      entry.size === previous.size &&
      entry.sha256 === previous.sha256;
    if (!duplicate && entry.offset !== end) throw invalid();
    if (entry.offset + entry.size > snapshot.size - payloadStart) throw invalid();
    if (!duplicate) end = entry.offset + entry.size;
    previous = entry;
  }
  if (payloadStart + end !== snapshot.size) throw invalid();
  const objects: RawLegacyObject[] = [];
  for (const entry of index.files) {
    const part = snapshot.slice(
      payloadStart + entry.offset,
      payloadStart + entry.offset + entry.size
    );
    if ((await digest(part)) !== entry.sha256) throw invalid();
    objects.push(Object.freeze({ file: Object.freeze(sourceFile(entry)), body: part }));
  }
  const sha256 = await digest(snapshot);
  if (expected && sha256 !== expected.sha256) throw invalid();
  return Object.freeze({
    body: snapshot,
    index,
    objects: Object.freeze(objects),
    indexDigest,
    inventoryDigest: await computeRawInventoryDigest(objects.map((item) => item.file)),
    sha256,
    size: snapshot.size
  });
}
