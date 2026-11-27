import { decodeBundle, revisionHeaderSize } from "./bundle.js";
import type { YandexPreparedBackup, YandexReference } from "./types.js";
import { sha256, YandexError } from "./types.js";
import { parseSlotEnvelope } from "./slot-model.js";
import type { SlotEnvelope } from "./slot-model.js";

export const SLOT_MAGIC = "MTPYDX02";
export const MAX_SLOT_HEADER = 256 * 1024;
export const MAX_SLOT_BYTES = 512 * 1024 * 1024 + MAX_SLOT_HEADER + 12;
export async function slotHeaderSize(body: Blob): Promise<number> {
  const bytes = new Uint8Array(await body.slice(0, 12).arrayBuffer());
  if (bytes.length !== 12 || new TextDecoder().decode(bytes.slice(0, 8)) !== SLOT_MAGIC)
    throw new YandexError("unsupported-format");
  const size = new DataView(bytes.buffer).getUint32(8, false);
  if (!size || size > MAX_SLOT_HEADER) throw new YandexError("limit");
  return size + 12;
}
export async function decodeSlotHeader(body: Blob, size: number): Promise<SlotEnvelope> {
  const offset = await slotHeaderSize(body);
  if (offset > body.size || size > MAX_SLOT_BYTES) throw new YandexError("limit");
  let value: unknown;
  try {
    value = JSON.parse(await body.slice(12, offset).text());
  } catch {
    throw new YandexError("remote-invalid");
  }
  const envelope = await parseSlotEnvelope(value);
  if (offset + envelope.current.bundle.size + (envelope.previous?.bundle.size ?? 0) !== size)
    throw new YandexError("remote-invalid");
  return envelope;
}
export async function encodeSlot(
  envelope: SlotEnvelope,
  current: Blob,
  previous: Blob | null
): Promise<{ body: Blob; reference: YandexReference }> {
  const checked = await parseSlotEnvelope(envelope);
  if ((checked.previous === null) !== (previous === null)) throw new YandexError("remote-invalid");
  for (const [version, bytes] of [
    [checked.current, current],
    [checked.previous, previous]
  ] as const)
    if (
      version &&
      (!bytes ||
        bytes.size !== version.bundle.size ||
        (await sha256(bytes)) !== version.bundle.sha256)
    )
      throw new YandexError("remote-invalid");
  const header = new TextEncoder().encode(JSON.stringify(checked));
  if (header.length > MAX_SLOT_HEADER) throw new YandexError("limit");
  const prefix = new Uint8Array(12);
  prefix.set(new TextEncoder().encode(SLOT_MAGIC));
  new DataView(prefix.buffer).setUint32(8, header.length, false);
  const body = new Blob([prefix, header, current, ...(previous ? [previous] : [])]);
  return { body, reference: { size: body.size, sha256: await sha256(body) } };
}
export async function decodeSlot(body: Blob): Promise<{
  envelope: SlotEnvelope;
  current: Blob;
  previous: Blob | null;
  prepared: Map<string, YandexPreparedBackup>;
}> {
  const envelope = await decodeSlotHeader(body.slice(0, MAX_SLOT_HEADER + 12), body.size),
    offset = await slotHeaderSize(body),
    current = body.slice(offset, offset + envelope.current.bundle.size),
    previous = envelope.previous ? body.slice(offset + current.size) : null,
    prepared = new Map<string, YandexPreparedBackup>();
  for (const [version, bytes] of [
    [envelope.current, current],
    [envelope.previous, previous]
  ] as const)
    if (version && bytes) {
      if ((await sha256(bytes)) !== version.bundle.sha256) throw new YandexError("remote-invalid");
      const decoded = await decodeBundle(bytes);
      if (JSON.stringify(decoded.revision) !== JSON.stringify(version.revision))
        throw new YandexError("remote-invalid");
      prepared.set(version.revision.revisionId, decoded.prepared);
    }
  return { envelope, current, previous, prepared };
}
export async function yandexHeaderSize(prefix: Blob): Promise<number> {
  return new TextDecoder().decode(await prefix.slice(0, 8).arrayBuffer()) === SLOT_MAGIC
    ? slotHeaderSize(prefix)
    : revisionHeaderSize(prefix);
}
