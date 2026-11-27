import { isRecord } from "../../model/backup-format.js";
import type { Backup } from "../../model/types.js";
import {
  MAX_IMAGE_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_TOTAL_BYTES,
  reference,
  restoreDriveBackup,
  sha256,
  shaPattern,
  verifyContent
} from "./backup.js";
import type { PreparedBackup } from "./backup.js";
import { MAX_DEVICE_SLOT_ENVELOPE_BYTES } from "./device-slot-cas.js";
import { parseDeviceSlotEnvelope } from "./device-slot-model.js";
import type { DeviceSlotEnvelope } from "./device-slot-model.js";
import { assertReadableDrivePayload } from "./reader-guard.js";
import { DriveError } from "./types.js";
import type { ContentReference } from "./types.js";

const MAGIC = new TextEncoder().encode("MTPSLOT");
const FORMAT_VERSION = 1;
const LENGTH_BYTES = 4;
const PACK_PREFIX_BYTES = MAGIC.length + 1 + LENGTH_BYTES;
const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const MAX_IMAGES = 1000;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_DEVICE_SLOT_PACKAGE_BYTES =
  PACK_PREFIX_BYTES + MAX_DEVICE_SLOT_ENVELOPE_BYTES + 2 * MAX_TOTAL_BYTES;
export const MAX_DEVICE_SLOT_PACKAGE_HEADER_BYTES =
  PACK_PREFIX_BYTES + MAX_DEVICE_SLOT_ENVELOPE_BYTES;

export interface DeviceSlotPackageVersion {
  readonly body: Blob;
  /** The exact bytes of the version frame, including its part descriptor. */
  readonly reference: Readonly<ContentReference>;
}

export interface DeviceSlotPackage {
  readonly envelope: DeviceSlotEnvelope;
  readonly current: DeviceSlotPackageVersion;
  readonly previous: DeviceSlotPackageVersion | null;
}

interface VersionDescriptor {
  version: typeof FORMAT_VERSION;
  payload: ContentReference;
  images: (ContentReference & { mimeType: string })[];
}

interface Parts {
  payload: Blob;
  images: Blob[];
}
type PreparedSlotInput = Pick<PreparedBackup, "payload"> & {
  readonly images: readonly PreparedBackup["images"][number][];
};

const verified = new WeakMap<DeviceSlotPackageVersion, Parts>();
const invalid = () => new DriveError("remote-invalid", "Некорректный файл версий Google Диска.");
const limit = () => new DriveError("limit", "Превышен размер файла версий Google Диска.");
const unsupported = () =>
  new DriveError("unsupported-format", "Неизвестный формат файла версий Google Диска.");

function lengthField(size: number): ArrayBuffer {
  const bytes = new ArrayBuffer(LENGTH_BYTES);
  new DataView(bytes).setUint32(0, size);
  return bytes;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, part: unknown) =>
    isRecord(part)
      ? Object.fromEntries(
          Object.keys(part)
            .sort()
            .map((key) => [key, part[key]])
        )
      : part
  );
}

async function readJson(blob: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await blob.arrayBuffer()
    );
    value = JSON.parse(text) as unknown;
  } catch {
    signal?.throwIfAborted();
    throw invalid();
  }
  signal?.throwIfAborted();
  return { text, value };
}

function contentRef(value: unknown, max: number, min = 0): ContentReference {
  if (
    !isRecord(value) ||
    typeof value.sha256 !== "string" ||
    !shaPattern.test(value.sha256) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < min
  )
    throw invalid();
  if (value.size > max) throw limit();
  return { sha256: value.sha256, size: value.size };
}

function descriptorFrom(value: unknown): VersionDescriptor {
  if (!isRecord(value)) throw invalid();
  if (value.version !== FORMAT_VERSION) throw unsupported();
  if (!Array.isArray(value.images)) throw invalid();
  if (value.images.length > MAX_IMAGES) throw limit();
  const payload = contentRef(value.payload, MAX_PAYLOAD_BYTES, 1);
  const images = value.images.map((image: unknown) => {
    if (!isRecord(image) || typeof image.mimeType !== "string" || !MIME_TYPES.has(image.mimeType))
      throw invalid();
    return { ...contentRef(image, MAX_IMAGE_BYTES), mimeType: image.mimeType };
  });
  return { version: FORMAT_VERSION, payload, images };
}

async function portablePayload(
  blob: Blob,
  mimeTypes: readonly string[],
  signal?: AbortSignal
): Promise<{ text: string; canonical: string }> {
  if (!(blob instanceof Blob) || !blob.size) throw invalid();
  if (blob.size > MAX_PAYLOAD_BYTES) throw limit();
  const { text, value } = await readJson(blob, signal);
  const backup = assertReadableDrivePayload(value);
  if (
    !backup.layout ||
    !backup.watchlist ||
    !backup.views ||
    backup.history !== undefined ||
    backup.images.length !== mimeTypes.length ||
    backup.images.some((image, index) => image.data !== "" || image.type !== mimeTypes[index])
  )
    throw invalid();
  if (backup.schemaVersion === 2) delete backup.exportedAt;
  return { text, canonical: canonicalJson(backup) };
}

function sumParts(descriptor: VersionDescriptor): number {
  return descriptor.payload.size + descriptor.images.reduce((sum, image) => sum + image.size, 0);
}

function remember(body: Blob, ref: ContentReference, parts: Parts): DeviceSlotPackageVersion {
  const version = Object.freeze({ body, reference: Object.freeze({ ...ref }) });
  verified.set(version, parts);
  return version;
}

/** Pack a complete portable version without base64-encoding its binary parts. */
export async function prepareDeviceSlotVersion(
  prepared: PreparedSlotInput,
  signal?: AbortSignal
): Promise<DeviceSlotPackageVersion> {
  signal?.throwIfAborted();
  const { payload, images } = prepared;
  if (!Array.isArray(images) || !(payload instanceof Blob)) throw invalid();
  if (images.length > MAX_IMAGES || payload.size > MAX_PAYLOAD_BYTES) throw limit();
  const parts = (images as PreparedSlotInput["images"]).map(
    ({ index, body, reference: ref, mimeType }, expectedIndex) => {
      if (
        index !== expectedIndex ||
        !(body instanceof Blob) ||
        body.type !== mimeType ||
        !MIME_TYPES.has(mimeType)
      )
        throw invalid();
      const descriptor = { ...contentRef(ref, MAX_IMAGE_BYTES), mimeType };
      if (body.size !== descriptor.size) throw invalid();
      return { body, descriptor };
    }
  );
  if (
    LENGTH_BYTES + payload.size + parts.reduce((sum, part) => sum + part.body.size, 0) >
    MAX_TOTAL_BYTES
  )
    throw limit();
  const { text, canonical } = await portablePayload(
    payload,
    parts.map(({ descriptor }) => descriptor.mimeType),
    signal
  );
  const normalized =
    text === canonical ? payload : new Blob([canonical], { type: "application/json" });
  if (normalized.size > MAX_PAYLOAD_BYTES) throw limit();
  const descriptor: VersionDescriptor = {
    version: FORMAT_VERSION,
    payload: await reference(normalized),
    images: parts.map(({ descriptor }) => descriptor)
  };
  signal?.throwIfAborted();
  const header = new Blob([canonicalJson(descriptor)]);
  if (
    header.size > MAX_DESCRIPTOR_BYTES ||
    LENGTH_BYTES + header.size + sumParts(descriptor) > MAX_TOTAL_BYTES
  )
    throw limit();
  for (const part of parts) {
    await verifyContent(part.body, part.descriptor);
    signal?.throwIfAborted();
  }
  const imageBodies = parts.map(({ body }) => body);
  const body = new Blob([lengthField(header.size), header, normalized, ...imageBodies]);
  const ref = await reference(body);
  signal?.throwIfAborted();
  return remember(body, ref, { payload: normalized, images: imageBodies });
}

function matchVersion(
  version: DeviceSlotPackageVersion,
  expected: Readonly<ContentReference>
): void {
  if (
    !verified.has(version) ||
    version.reference.size !== expected.size ||
    version.reference.sha256 !== expected.sha256
  )
    throw invalid();
}

/** Persist exactly one physical file with one or two independently restorable versions. */
export function encodeDeviceSlotPackage(
  envelope: DeviceSlotEnvelope,
  current: DeviceSlotPackageVersion,
  previous: DeviceSlotPackageVersion | null
): Blob {
  const checked = parseDeviceSlotEnvelope(envelope);
  matchVersion(current, checked.current.payload);
  if (previous && checked.previous) matchVersion(previous, checked.previous.payload);
  else if (previous || checked.previous) throw invalid();
  const header = new Blob([JSON.stringify(checked)]);
  if (header.size > MAX_DEVICE_SLOT_ENVELOPE_BYTES) throw limit();
  const sections = [
    MAGIC,
    new Uint8Array([FORMAT_VERSION]),
    lengthField(header.size),
    header,
    current.body
  ];
  if (previous) sections.push(previous.body);
  return new Blob(sections, { type: "application/octet-stream" });
}

export async function verifyDeviceSlotVersion(
  body: Blob,
  ref: Readonly<ContentReference>,
  signal?: AbortSignal
): Promise<DeviceSlotPackageVersion> {
  signal?.throwIfAborted();
  const expected = contentRef(ref, MAX_TOTAL_BYTES);
  if (body.size <= LENGTH_BYTES || body.size !== expected.size) throw invalid();
  const prefix = new DataView(await body.slice(0, LENGTH_BYTES).arrayBuffer());
  const descriptorBytes = prefix.getUint32(0);
  if (descriptorBytes > MAX_DESCRIPTOR_BYTES) throw limit();
  let offset = LENGTH_BYTES + descriptorBytes;
  if (!descriptorBytes || offset >= body.size) throw invalid();
  const header = await readJson(body.slice(LENGTH_BYTES, offset), signal);
  const descriptor = descriptorFrom(header.value);
  if (header.text !== canonicalJson(descriptor) || offset + sumParts(descriptor) !== body.size)
    throw invalid();
  await verifyContent(body, expected);
  signal?.throwIfAborted();
  const payload = body.slice(offset, offset + descriptor.payload.size, "application/json");
  offset += descriptor.payload.size;
  await verifyContent(payload, descriptor.payload);
  const { text, canonical } = await portablePayload(
    payload,
    descriptor.images.map(({ mimeType }) => mimeType),
    signal
  );
  if (text !== canonical) throw invalid();
  const images: Blob[] = [];
  for (const part of descriptor.images) {
    const image = body.slice(offset, offset + part.size, part.mimeType);
    await verifyContent(image, part);
    signal?.throwIfAborted();
    images.push(image);
    offset += part.size;
  }
  return remember(body, expected, { payload, images });
}

/** Inspect only the header. Full verification of candidate bytes is a separate operation. */
export async function readDeviceSlotPackageHeader(
  body: Blob,
  totalBytes: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  if (
    !(body instanceof Blob) ||
    !Number.isSafeInteger(totalBytes) ||
    body.size > totalBytes ||
    body.size <= PACK_PREFIX_BYTES
  )
    throw invalid();
  if (totalBytes > MAX_DEVICE_SLOT_PACKAGE_BYTES) throw limit();
  const prefix = await body.slice(0, PACK_PREFIX_BYTES).arrayBuffer();
  const bytes = new Uint8Array(prefix);
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) throw invalid();
  if (bytes[MAGIC.length] !== FORMAT_VERSION) throw unsupported();
  const headerBytes = new DataView(prefix).getUint32(MAGIC.length + 1);
  if (headerBytes > MAX_DEVICE_SLOT_ENVELOPE_BYTES) throw limit();
  const first = PACK_PREFIX_BYTES + headerBytes;
  if (!headerBytes || first > body.size) throw invalid();
  const headerBody = body.slice(PACK_PREFIX_BYTES, first);
  const header = await readJson(headerBody, signal);
  const envelope = parseDeviceSlotEnvelope(header.value);
  const end = first + envelope.current.payload.size;
  if (
    end + (envelope.previous?.payload.size ?? 0) !== totalBytes ||
    header.text !== JSON.stringify(envelope)
  )
    throw invalid();
  const envelopeHash = await sha256(headerBody);
  signal?.throwIfAborted();
  return { envelope, envelopeHash, first, end };
}

/** Header and both whole versions must be verified before either can be restored. */
export async function decodeDeviceSlotPackage(
  body: Blob,
  signal?: AbortSignal
): Promise<DeviceSlotPackage> {
  if (!(body instanceof Blob)) throw invalid();
  const { envelope, first, end } = await readDeviceSlotPackageHeader(body, body.size, signal);
  const current = await verifyDeviceSlotVersion(
    body.slice(first, end),
    envelope.current.payload,
    signal
  );
  const previous = envelope.previous
    ? await verifyDeviceSlotVersion(body.slice(end), envelope.previous.payload, signal)
    : null;
  signal?.throwIfAborted();
  return Object.freeze({ envelope, current, previous });
}

/** Materialize only the explicitly selected version for the existing backup importer. */
export async function restoreDeviceSlotVersion(
  version: DeviceSlotPackageVersion,
  signal?: AbortSignal
): Promise<Backup> {
  signal?.throwIfAborted();
  const parts = verified.get(version);
  if (!parts) throw invalid();
  const backup = await restoreDriveBackup(parts.payload, parts.images);
  signal?.throwIfAborted();
  return backup;
}
