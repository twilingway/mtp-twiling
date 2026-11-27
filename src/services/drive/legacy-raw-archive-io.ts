import { isRecord } from "../../model/backup-format.js";
import { sha256 } from "./backup.js";
import type { DriveAuthorization } from "./types.js";
import { DriveError } from "./types.js";
import type {
  LegacyCandidate,
  LegacyCompactionRemote,
  CompactionReceipt
} from "./legacy-compaction-types.js";
import type { RawLegacyObject } from "./legacy-raw-archive-types.js";
import {
  RetentionHttp,
  endpoint,
  invalidRetention,
  MULTIPART_LIMIT,
  parseCandidate,
  parseProperties,
  propertiesKey,
  RAW_ARCHIVE_LIMIT,
  RAW_SOURCE_LIMIT,
  RETENTION_NAMESPACE,
  RETENTION_RECORD_LIMIT,
  retentionLimit,
  V3_FILES,
  validFileId,
  validHash
} from "./legacy-raw-archive-http.js";
import type { RetentionHttpOptions } from "./legacy-raw-archive-http.js";
import { createRetentionAssigned, retentionProperties } from "./legacy-raw-archive-upload.js";
import type { ImmutableMetadata } from "./legacy-raw-archive-upload.js";
import { RetentionDeletes } from "./legacy-raw-archive-delete.js";
import { RetentionReadCache } from "./legacy-raw-archive-cache.js";
import type { DeleteProof } from "./legacy-raw-archive-delete.js";
import type { DeleteProbeJournal } from "./legacy-raw-archive-probe-journal.js";
export type { DeleteProof } from "./legacy-raw-archive-delete.js";

export interface LegacyCompactionHttpOptions extends RetentionHttpOptions {
  probeJournal?: DeleteProbeJournal;
}
export interface RetentionCandidate extends CompactionReceipt {
  readonly appProperties: Readonly<Record<string, string>>;
}
/** Raw archival transport. Its delete authority is independent from binary PUT capacity. */
export class LegacyCompactionHttp implements LegacyCompactionRemote<DeleteProof> {
  private readonly http: RetentionHttp;
  private readonly deletes: RetentionDeletes;
  private readonly reads: RetentionReadCache;
  constructor(authorization: DriveAuthorization, options: LegacyCompactionHttpOptions = {}) {
    this.http = new RetentionHttp(authorization, options);
    this.deletes = new RetentionDeletes(this.http, options.probeJournal);
    this.reads = new RetentionReadCache(this.http);
  }
  get pendingProbeIds(): readonly string[] {
    return this.deletes.pendingProbeIds;
  }
  runDeleteProbe = (signal: AbortSignal) => this.deletes.runDeleteProbe(signal);
  deletePinned: LegacyCompactionRemote<DeleteProof>["deletePinned"] = (file, proof, signal) =>
    this.deletes.deletePinned(file, proof, signal);

  private async list(namespace: string, kind: string, signal: AbortSignal): Promise<unknown[]> {
    const seen = new Set<string>(),
      result: unknown[] = [];
    let pageToken = "";
    do {
      if (seen.has(pageToken) || seen.size >= 16) throw retentionLimit();
      seen.add(pageToken);
      const value = await this.http.getJson(
        endpoint(V3_FILES, {
          spaces: "appDataFolder",
          pageSize: "1000",
          pageToken,
          fields: "files(id,size,version,appProperties),nextPageToken,incompleteSearch",
          q: `trashed = false and appProperties has { key='mtpNamespace' and value='${namespace}' } and appProperties has { key='mtpKind' and value='${kind}' }`
        }),
        signal
      );
      if (
        !isRecord(value) ||
        !Array.isArray(value.files) ||
        value.incompleteSearch === true ||
        (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string")
      )
        throw invalidRetention();
      for (const file of value.files as unknown[]) result.push(file);
      if (result.length > 2048) throw retentionLimit();
      pageToken = typeof value.nextPageToken === "string" ? value.nextPageToken : "";
    } while (pageToken);
    return result;
  }
  async listLegacy(signal: AbortSignal): Promise<readonly LegacyCandidate[]> {
    const result: LegacyCandidate[] = [],
      ids = new Set<string>();
    let bytes = 0;
    for (const namespace of ["mtp-drive-v1", "mtp-drive-v2"] as const)
      for (const kind of ["snapshot", "blob"] as const) {
        const candidates = await this.list(namespace, kind, signal);
        for (const value of candidates) {
          const file = parseCandidate(value);
          if (file.namespace !== namespace || file.kind !== kind || ids.has(file.fileId))
            throw invalidRetention();
          ids.add(file.fileId);
          result.push(file);
          bytes += file.size;
          if (result.length > 2048 || bytes > RAW_ARCHIVE_LIMIT) throw retentionLimit();
        }
      }
    await this.http.check(signal);
    return Object.freeze(result);
  }
  async captureRaw(candidate: LegacyCandidate, signal: AbortSignal): Promise<RawLegacyObject> {
    const expected = parseCandidate({
      id: candidate.fileId,
      size: candidate.size,
      version: candidate.version,
      appProperties: candidate.appProperties
    });
    if (
      candidate.namespace !== expected.namespace ||
      candidate.kind !== expected.kind ||
      candidate.key !== expected.key
    )
      throw invalidRetention();
    const { metadata, body } = await this.http.readStable(
      candidate.fileId,
      RAW_SOURCE_LIMIT,
      signal
    );
    if (
      metadata.version !== expected.version ||
      metadata.size !== expected.size ||
      propertiesKey(metadata.appProperties) !== propertiesKey(expected.appProperties)
    )
      throw new DriveError("conflict", "Исходный файл изменился до архивации.");
    return {
      file: Object.freeze({ ...expected, etag: metadata.etag, sha256: metadata.sha256 }),
      body
    };
  }
  async createImmutable(
    kind: "rawarchive" | "compaction",
    body: Blob,
    metadata: ImmutableMetadata,
    onReserved: (fileId: string) => Promise<void>,
    signal: AbortSignal
  ): Promise<CompactionReceipt> {
    if ((kind !== "rawarchive" && kind !== "compaction") || !body.size) throw invalidRetention();
    if (
      body.size > MULTIPART_LIMIT ||
      (kind === "compaction" && body.size > RETENTION_RECORD_LIMIT)
    )
      throw retentionLimit();
    const hash = await sha256(body);
    retentionProperties(kind, metadata, hash);
    await this.http.check(signal);
    const fileId = metadata.reservedFileId ?? (await this.http.reserve(signal));
    if (!validFileId(fileId)) throw invalidRetention();
    await onReserved(fileId);
    await this.http.check(signal);
    await createRetentionAssigned(this.http, fileId, kind, body, metadata, hash, signal);
    await this.http.check(signal);
    return Object.freeze({ fileId, size: body.size, sha256: hash });
  }
  readVerified(receipt: CompactionReceipt, signal: AbortSignal): Promise<Blob> {
    return this.reads.read(receipt, signal);
  }

  async listRetention(
    kind: "rawarchive" | "compaction",
    signal: AbortSignal
  ): Promise<readonly RetentionCandidate[]> {
    if (kind !== "rawarchive" && kind !== "compaction") throw invalidRetention();
    const result: RetentionCandidate[] = [],
      ids = new Set<string>();
    for (const value of await this.list(RETENTION_NAMESPACE, kind, signal)) {
      if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        !validFileId(value.id) ||
        ids.has(value.id)
      )
        throw invalidRetention();
      const props = parseProperties(value.appProperties),
        size = Number(value.size);
      if (
        props.mtpNamespace !== RETENTION_NAMESPACE ||
        props.mtpKind !== kind ||
        !props.mtpHash ||
        !validHash(props.mtpHash) ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > (kind === "compaction" ? RETENTION_RECORD_LIMIT : RAW_ARCHIVE_LIMIT)
      )
        throw invalidRetention();
      ids.add(value.id);
      result.push(
        Object.freeze({ fileId: value.id, size, sha256: props.mtpHash, appProperties: props })
      );
    }
    await this.http.check(signal);
    return Object.freeze(result);
  }
}
