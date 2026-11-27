import { hashPattern, object, sha256, uuidPattern, YandexError } from "./types.js";
import type { YandexPreparedBackup, YandexReference } from "./types.js";

const MAGIC = "MTPYDX01";
export const MAX_HEADER_BYTES = 256 * 1024;
const HEADER_MAX = MAX_HEADER_BYTES;
export const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const MAX_PAYLOAD = 16 * 1024 * 1024,
  MAX_IMAGE = 21 * 1024 * 1024;
export interface YandexRevision {
  readonly protocol: 1;
  readonly revisionId: string;
  readonly deviceId: string;
  readonly parents: readonly string[];
  readonly createdAt: string;
  readonly digest: string;
  readonly summary: {
    readonly instruments: number;
    readonly drawings: number;
    readonly images: number;
  };
  readonly payload: YandexReference;
  readonly images: readonly (YandexReference & {
    readonly index: number;
    readonly mimeType: string;
  })[];
}
function ref(value: unknown, max: number): value is YandexReference {
  const v = object(value);
  return (
    !!v &&
    typeof v.sha256 === "string" &&
    hashPattern.test(v.sha256) &&
    Number.isSafeInteger(v.size) &&
    Number(v.size) >= 0 &&
    Number(v.size) <= max
  );
}
export function validateRevision(value: unknown): YandexRevision {
  const v = object(value);
  if (v?.protocol !== 1) throw new YandexError("unsupported-format");
  if (
    Object.keys(v).some(
      (key) =>
        ![
          "protocol",
          "revisionId",
          "deviceId",
          "parents",
          "createdAt",
          "digest",
          "payload",
          "summary",
          "images"
        ].includes(key)
    )
  )
    throw new YandexError("unsupported-format");
  if (
    typeof v.revisionId !== "string" ||
    !uuidPattern.test(v.revisionId) ||
    typeof v.deviceId !== "string" ||
    !uuidPattern.test(v.deviceId) ||
    !Array.isArray(v.parents) ||
    v.parents.length > 1000 ||
    !v.parents.every(
      (parent: unknown) =>
        typeof parent === "string" && uuidPattern.test(parent) && parent !== v.revisionId
    ) ||
    new Set(v.parents).size !== v.parents.length ||
    typeof v.createdAt !== "string" ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    typeof v.digest !== "string" ||
    !hashPattern.test(v.digest) ||
    !ref(v.payload, MAX_PAYLOAD) ||
    !object(v.summary) ||
    !["instruments", "drawings", "images"].every(
      (key) =>
        Number.isSafeInteger(object(v.summary)?.[key]) &&
        Number(object(v.summary)?.[key]) >= 0 &&
        Number(object(v.summary)?.[key]) <= 1000000
    ) ||
    !Array.isArray(v.images) ||
    v.images.length > 1000 ||
    !v.images.every((image: unknown, index: number) => {
      const i = object(image);
      return (
        ref(image, MAX_IMAGE) &&
        !!i &&
        i.index === index &&
        typeof i.mimeType === "string" &&
        ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(i.mimeType)
      );
    })
  )
    throw new YandexError("remote-invalid");
  const result = v as unknown as YandexRevision;
  if (
    result.payload.size + result.images.reduce((sum, image) => sum + image.size, 0) >
    MAX_BUNDLE_BYTES - HEADER_MAX - 12
  )
    throw new YandexError("limit");
  return result;
}
export function revisionName(revision: Pick<YandexRevision, "deviceId" | "revisionId">): string {
  if (!uuidPattern.test(revision.deviceId) || !uuidPattern.test(revision.revisionId))
    throw new YandexError("remote-invalid");
  return `${revision.deviceId}_${revision.revisionId}.mtp`;
}
export async function encodeBundle(
  prepared: YandexPreparedBackup,
  metadata: Pick<YandexRevision, "revisionId" | "deviceId" | "parents" | "createdAt" | "digest">
): Promise<{ body: Blob; revision: YandexRevision; reference: YandexReference }> {
  const revision = validateRevision({
    protocol: 1,
    ...metadata,
    summary: await payloadSummary(prepared.payload, prepared.images.length),
    payload: { sha256: await sha256(prepared.payload), size: prepared.payload.size },
    images: prepared.images.map(({ index, reference, mimeType }) => ({
      index,
      ...reference,
      mimeType
    }))
  });
  for (const image of prepared.images) {
    if (
      image.body.size !== image.reference.size ||
      (await sha256(image.body)) !== image.reference.sha256
    )
      throw new YandexError("remote-invalid");
  }
  const header = new TextEncoder().encode(JSON.stringify(revision));
  if (header.length > HEADER_MAX) throw new YandexError("limit");
  const prefix = new Uint8Array(12);
  prefix.set(new TextEncoder().encode(MAGIC));
  new DataView(prefix.buffer).setUint32(8, header.length, false);
  const body = new Blob(
    [prefix, header, prepared.payload, ...prepared.images.map(({ body }) => body)],
    { type: "application/octet-stream" }
  );
  if (body.size > MAX_BUNDLE_BYTES) throw new YandexError("limit");
  return { body, revision, reference: { sha256: await sha256(body), size: body.size } };
}
async function payloadSummary(payload: Blob, images: number): Promise<YandexRevision["summary"]> {
  let value: Record<string, unknown> | undefined;
  try {
    value = object(JSON.parse(await payload.text()));
  } catch {
    throw new YandexError("remote-invalid");
  }
  return {
    instruments: Array.isArray(value?.watchlist) ? value.watchlist.length : 0,
    drawings: Array.isArray(value?.drawings)
      ? value.drawings.reduce((sum: number, document: unknown) => {
          const items = object(document)?.items;
          return sum + (Array.isArray(items) ? items.length : 0);
        }, 0)
      : 0,
    images
  };
}
export async function revisionHeaderSize(body: Blob): Promise<number> {
  if (body.size < 12) throw new YandexError("remote-invalid");
  const prefix = new Uint8Array(await body.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(prefix.slice(0, 8)) !== MAGIC)
    throw new YandexError("unsupported-format");
  const size = new DataView(prefix.buffer).getUint32(8, false);
  if (!size || size > HEADER_MAX) throw new YandexError("limit");
  return size + 12;
}
export async function decodeRevisionHeader(
  prefixBody: Blob,
  fullSize: number
): Promise<{ revision: YandexRevision; offset: number }> {
  if (fullSize > MAX_BUNDLE_BYTES || prefixBody.size < 12) throw new YandexError("limit");
  const prefix = new Uint8Array(await prefixBody.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(prefix.slice(0, 8)) !== MAGIC)
    throw new YandexError("unsupported-format");
  const length = new DataView(prefix.buffer).getUint32(8, false);
  if (!length || length > HEADER_MAX || length + 12 > prefixBody.size)
    throw new YandexError("remote-invalid");
  let value: unknown;
  try {
    value = JSON.parse(await prefixBody.slice(12, 12 + length).text()) as unknown;
  } catch {
    throw new YandexError("remote-invalid");
  }
  const revision = validateRevision(value),
    offset = 12 + length;
  if (
    offset + revision.payload.size + revision.images.reduce((sum, image) => sum + image.size, 0) !==
      fullSize ||
    revision.summary.images !== revision.images.length
  )
    throw new YandexError("remote-invalid");
  return { revision, offset };
}
export async function decodeBundle(
  body: Blob
): Promise<{ revision: YandexRevision; prepared: YandexPreparedBackup }> {
  if (body.size > MAX_BUNDLE_BYTES || body.size < 12) throw new YandexError("limit");
  const parsed = await decodeRevisionHeader(body.slice(0, HEADER_MAX + 12), body.size),
    revision = parsed.revision;
  let offset = parsed.offset;
  const payload = body.slice(offset, offset + revision.payload.size, "application/json");
  offset += revision.payload.size;
  if ((await sha256(payload)) !== revision.payload.sha256) throw new YandexError("remote-invalid");
  const images: YandexPreparedBackup["images"][number][] = [];
  for (const image of revision.images) {
    const part = body.slice(offset, offset + image.size, image.mimeType);
    offset += image.size;
    if (part.size !== image.size || (await sha256(part)) !== image.sha256)
      throw new YandexError("remote-invalid");
    images.push({
      index: image.index,
      body: part,
      reference: { size: image.size, sha256: image.sha256 },
      mimeType: image.mimeType
    });
  }
  if (offset !== body.size) throw new YandexError("remote-invalid");
  if (
    JSON.stringify(await payloadSummary(payload, images.length)) !==
    JSON.stringify(revision.summary)
  )
    throw new YandexError("remote-invalid");
  return { revision, prepared: { payload, images } };
}
/** Causal selection, never wall-clock last-writer-wins. Preserves every unresolved branch. */
export function revisionHeads(revisions: readonly YandexRevision[]): string[] {
  const map = new Map(revisions.map((revision) => [revision.revisionId, revision]));
  if (map.size !== revisions.length) throw new YandexError("conflict");
  const parents = new Set<string>(),
    children = new Map<string, string[]>(),
    remaining = new Map<string, number>();
  for (const revision of revisions) {
    remaining.set(revision.revisionId, revision.parents.length);
    for (const parent of revision.parents) {
      if (!map.has(parent)) throw new YandexError("conflict");
      parents.add(parent);
      const values = children.get(parent) ?? [];
      values.push(revision.revisionId);
      children.set(parent, values);
    }
  }
  const queue = revisions
    .filter(({ revisionId }) => remaining.get(revisionId) === 0)
    .map(({ revisionId }) => revisionId);
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]!) ?? []) {
      const count = remaining.get(child)! - 1;
      remaining.set(child, count);
      if (count === 0) queue.push(child);
    }
  }
  if (queue.length !== revisions.length) throw new YandexError("remote-invalid");
  return revisions
    .map(({ revisionId }) => revisionId)
    .filter((id) => !parents.has(id))
    .sort();
}
export function visibleDeviceVersions(
  revisions: readonly YandexRevision[],
  deviceId: string
): YandexRevision[] {
  const heads = revisionHeads(revisions),
    map = new Map(revisions.map((revision) => [revision.revisionId, revision]));
  const selected = new Map<string, YandexRevision>();
  // Two generations per causal branch; unresolved heads are never discarded by date.
  for (const head of heads) {
    let frontier = [head],
      count = 0;
    const visited = new Set<string>();
    while (frontier.length && count < 2) {
      const next: string[] = [];
      let matched = false;
      for (const id of frontier) {
        if (visited.has(id)) continue;
        visited.add(id);
        const revision = map.get(id);
        if (!revision) continue;
        if (revision.deviceId === deviceId) {
          selected.set(id, revision);
          matched = true;
        }
        next.push(...revision.parents);
      }
      if (matched) count++;
      frontier = next;
    }
  }
  return [...selected.values()];
}
