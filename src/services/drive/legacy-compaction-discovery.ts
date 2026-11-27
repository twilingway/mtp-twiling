import { decodeRawArchive } from "./legacy-raw-archive-codec.js";
import type { CompactionRecord, DecodedRawArchive } from "./legacy-raw-archive-types.js";
import type { CompactionReceipt } from "./legacy-compaction-types.js";
import { DriveError } from "./types.js";

const HASH = /^[a-f\d]{64}$/;
const ID = /^[A-Za-z0-9_.:@-]{1,256}$/;
const MAX_RECORD_BYTES = 1024 * 1024;
const invalid = () => new DriveError("remote-invalid", "The legacy compaction record is invalid.");
const object = (input: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    throw invalid();
  return input as Record<string, unknown>;
};
const text = (value: unknown, pattern: RegExp): string => {
  if (typeof value !== "string" || !pattern.test(value)) throw invalid();
  return value;
};

/** JSON parsing happens here before any caller can use record references for cloud recovery. */
export async function parseLegacyCompactionRecord(body: Blob): Promise<CompactionRecord> {
  if (body.size > MAX_RECORD_BYTES)
    throw new DriveError("limit", "The compaction record is too large.");
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await body.arrayBuffer()));
  } catch {
    throw invalid();
  }
  const record = object(input, [
    "formatVersion",
    "operationId",
    "workspaceId",
    "publicClientId",
    "createdAt",
    "archive",
    "inventoryDigest",
    "v3"
  ]);
  if (record.formatVersion !== 1)
    throw new DriveError("unsupported-format", "Unknown legacy compaction record format.");
  const archive = object(record.archive, ["fileId", "size", "sha256", "indexDigest"]);
  const v3 = object(record.v3, ["fileId", "revisionId", "envelopeHash"]);
  if (
    typeof archive.size !== "number" ||
    !Number.isSafeInteger(archive.size) ||
    archive.size < 1 ||
    archive.size > 512 * 1024 * 1024
  )
    throw invalid();
  const createdAt = text(record.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt)
    throw invalid();
  return Object.freeze({
    formatVersion: 1,
    operationId: text(record.operationId, ID),
    workspaceId: text(record.workspaceId, ID),
    publicClientId: text(record.publicClientId, ID),
    createdAt,
    inventoryDigest: text(record.inventoryDigest, HASH),
    archive: Object.freeze({
      fileId: text(archive.fileId, ID),
      size: archive.size,
      sha256: text(archive.sha256, HASH),
      indexDigest: text(archive.indexDigest, HASH)
    }),
    v3: Object.freeze({
      fileId: text(v3.fileId, ID),
      revisionId: text(v3.revisionId, ID),
      envelopeHash: text(v3.envelopeHash, HASH)
    })
  });
}

export interface LegacyCompactionDiscoveryRemote {
  /** Enumerates only immutable retention compaction records, completely, with raw hash metadata. */
  listCompactionRecords(signal: AbortSignal): Promise<readonly CompactionReceipt[]>;
  readVerified(receipt: CompactionReceipt, signal: AbortSignal): Promise<Blob>;
}
export interface LegacyCompactionDiscoveryScope {
  readonly workspaceId: string;
  /** Pinned to the active account/credential/enabled state, including transport dispatch. */
  checkIdentity(signal: AbortSignal): Promise<void>;
}
export interface VerifiedLegacyCompactionRecord {
  readonly record: CompactionRecord;
  readonly recordReceipt: CompactionReceipt;
}
export interface VerifiedLegacyArchive extends VerifiedLegacyCompactionRecord {
  readonly archive: DecodedRawArchive;
}

/** Cheap discovery reads records only; historical raw archives remain lazy until recovery/review. */
export async function discoverVerifiedLegacyCompactionRecords(
  remote: LegacyCompactionDiscoveryRemote,
  scope: LegacyCompactionDiscoveryScope,
  signal: AbortSignal
): Promise<readonly VerifiedLegacyCompactionRecord[]> {
  signal.throwIfAborted();
  await scope.checkIdentity(signal);
  const receipts = await remote.listCompactionRecords(signal);
  if (receipts.length > 2048) throw new DriveError("limit", "Too many compaction records.");
  const result: VerifiedLegacyCompactionRecord[] = [];
  const ids = new Set<string>();
  const operations = new Map<string, string>();
  for (const receipt of receipts) {
    signal.throwIfAborted();
    await scope.checkIdentity(signal);
    if (ids.has(receipt.fileId) || receipt.size > MAX_RECORD_BYTES) throw invalid();
    ids.add(receipt.fileId);
    const record = await parseLegacyCompactionRecord(await remote.readVerified(receipt, signal));
    // publicClientId is the producer, and must remain readable by newly linked client identities.
    if (record.workspaceId !== scope.workspaceId) continue;
    const fingerprint = JSON.stringify(record);
    if (operations.has(record.operationId) && operations.get(record.operationId) !== fingerprint)
      throw new DriveError("conflict", "Conflicting legacy compaction records require review.");
    operations.set(record.operationId, fingerprint);
    result.push(Object.freeze({ record, recordReceipt: Object.freeze({ ...receipt }) }));
  }
  signal.throwIfAborted();
  await scope.checkIdentity(signal);
  return Object.freeze(result);
}

/** Fully verifies archive sections and the immutable sidecar binding before exposing overlay bytes. */
export async function loadVerifiedLegacyArchive(
  remote: Pick<LegacyCompactionDiscoveryRemote, "readVerified">,
  scope: LegacyCompactionDiscoveryScope,
  verified: VerifiedLegacyCompactionRecord,
  signal: AbortSignal
): Promise<VerifiedLegacyArchive> {
  signal.throwIfAborted();
  await scope.checkIdentity(signal);
  const { record } = verified;
  if (record.workspaceId !== scope.workspaceId) throw invalid();
  const { fileId, size, sha256, indexDigest } = record.archive;
  const body = await remote.readVerified({ fileId, size, sha256 }, signal);
  const archive = await decodeRawArchive(body, { size, sha256, indexDigest });
  if (
    archive.index.operationId !== record.operationId ||
    archive.index.workspaceId !== record.workspaceId ||
    archive.index.publicClientId !== record.publicClientId ||
    archive.index.createdAt !== record.createdAt ||
    archive.inventoryDigest !== record.inventoryDigest
  )
    throw invalid();
  signal.throwIfAborted();
  await scope.checkIdentity(signal);
  return Object.freeze({ ...verified, archive });
}

export async function discoverVerifiedLegacyArchives(
  remote: LegacyCompactionDiscoveryRemote,
  scope: LegacyCompactionDiscoveryScope,
  signal: AbortSignal
): Promise<readonly VerifiedLegacyArchive[]> {
  const records = await discoverVerifiedLegacyCompactionRecords(remote, scope, signal);
  const result: VerifiedLegacyArchive[] = [];
  for (const record of records)
    result.push(await loadVerifiedLegacyArchive(remote, scope, record, signal));
  return Object.freeze(result);
}
