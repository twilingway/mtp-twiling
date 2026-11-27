import {
  computeRawInventoryDigest,
  decodeRawArchive,
  encodeRawArchive,
  verifyRawArchiveCoverage
} from "./legacy-raw-archive-codec.js";
import type {
  CompactionRecord,
  DecodedRawArchive,
  EncodedRawArchive,
  RawArchiveMetadata,
  RawLegacyFile,
  RawLegacyObject
} from "./legacy-raw-archive-types.js";
import type {
  LegacyCompactionGate,
  LegacyCompactionJournal,
  LegacyCompactionJournalEntry,
  LegacyCompactionPreview,
  LegacyCompactionProgress,
  LegacyCompactionRemote
} from "./legacy-compaction-types.js";
import { DRIVE_CLIENT_ID, DriveError } from "./types.js";
export type * from "./legacy-compaction-types.js";

const invalid = () => new DriveError("remote-invalid", "The legacy compaction proof is invalid.");
const conflict = () => new DriveError("conflict", "Refresh the legacy compaction preview.");
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const digest = async (body: Blob) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await body.arrayBuffer())))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const withoutProof = (file: RawLegacyFile) => ({
  fileId: file.fileId,
  namespace: file.namespace,
  kind: file.kind,
  key: file.key,
  version: file.version,
  size: file.size,
  appProperties: file.appProperties
});
const previewOf = (entry: LegacyCompactionJournalEntry): LegacyCompactionPreview => ({
  operationId: entry.metadata.operationId,
  fileCount: entry.files.length,
  bytes: entry.files.reduce((n, file) => n + file.size, 0),
  inventoryDigest: entry.inventoryDigest
});

/** Raw baseline compaction is independent of the obsolete total-old-writer-fence cleanup. */
export class LegacyCompaction<Proof> {
  private readonly previews = new WeakMap<
    LegacyCompactionPreview,
    {
      entry: LegacyCompactionJournalEntry;
      archive: EncodedRawArchive;
    }
  >();
  private running = false;

  constructor(
    private readonly remote: LegacyCompactionRemote<Proof>,
    private readonly gate: LegacyCompactionGate,
    private readonly journal: LegacyCompactionJournal
  ) {}

  private async check(signal: AbortSignal) {
    signal.throwIfAborted();
    await this.gate.checkIdentity(signal);
    signal.throwIfAborted();
  }

  private async save(entry: LegacyCompactionJournalEntry, signal: AbortSignal) {
    await this.check(signal);
    await this.journal.save(structuredClone(entry), signal);
    await this.check(signal);
  }

  async preview(
    metadata: RawArchiveMetadata,
    signal: AbortSignal
  ): Promise<LegacyCompactionPreview> {
    if (this.running) throw conflict();
    await this.check(signal);
    const { binding } = this.gate;
    if (
      binding.clientId !== DRIVE_CLIENT_ID ||
      !binding.accountKey ||
      metadata.workspaceId !== binding.workspaceId ||
      metadata.publicClientId !== binding.publicClientId
    )
      throw invalid();
    // A confirmed selected v3 version is required even for preparing user cleanup.
    const v3 = await this.gate.verifyCurrentV3(undefined, signal);
    await this.check(signal);
    const candidates = await this.remote.listLegacy(signal);
    if (!candidates.length || candidates.length > 2048) throw invalid();
    const objects: RawLegacyObject[] = [];
    for (const candidate of candidates) {
      await this.check(signal);
      const object = await this.remote.captureRaw(candidate, signal);
      if (!equal(withoutProof(object.file), candidate)) throw conflict();
      objects.push(object);
    }
    const archive = await encodeRawArchive(objects, metadata);
    await this.check(signal);
    const entry: LegacyCompactionJournalEntry = {
      metadata: structuredClone(metadata),
      binding: structuredClone(binding),
      files: archive.index.files.map((file) => ({
        ...withoutProof(file),
        etag: file.etag,
        sha256: file.sha256
      })),
      inventoryDigest: archive.inventoryDigest,
      v3: structuredClone(v3),
      outcomes: {}
    };
    const preview = Object.freeze(previewOf(entry));
    this.previews.set(preview, { entry, archive });
    return preview;
  }

  async execute(
    preview: LegacyCompactionPreview,
    signal: AbortSignal,
    report?: (progress: LegacyCompactionProgress) => void
  ): Promise<LegacyCompactionProgress> {
    const pinned = this.previews.get(preview);
    if (!pinned || this.running) throw conflict();
    this.previews.delete(preview);
    return this.run(pinned.entry, pinned.archive, signal, report);
  }

  async resume(
    operationId: string,
    signal: AbortSignal,
    report?: (progress: LegacyCompactionProgress) => void
  ): Promise<LegacyCompactionProgress> {
    if (this.running) throw conflict();
    await this.check(signal);
    const entry = await this.journal.read(operationId);
    if (!entry || entry.metadata.operationId !== operationId) throw invalid();
    return this.run(entry, undefined, signal, report);
  }

  private progress(entry: LegacyCompactionJournalEntry, phase: LegacyCompactionProgress["phase"]) {
    const values = Object.values(entry.outcomes);
    const deletedFiles = values.filter((value) => value === "deleted").length;
    const changedFiles = values.filter((value) => value === "changed").length;
    return Object.freeze({
      ...previewOf(entry),
      phase,
      archivedFiles: phase === "archive" ? 0 : entry.files.length,
      deletedFiles,
      changedFiles,
      pendingFiles: entry.files.length - deletedFiles - changedFiles
    });
  }

  private async run(
    entry: LegacyCompactionJournalEntry,
    prepared: EncodedRawArchive | undefined,
    signal: AbortSignal,
    report?: (progress: LegacyCompactionProgress) => void
  ) {
    this.running = true;
    const publish = async (phase: LegacyCompactionProgress["phase"]) => {
      await this.check(signal);
      const progress = this.progress(entry, phase);
      report?.(progress);
      return progress;
    };
    try {
      await this.check(signal);
      if (
        !equal(entry.binding, this.gate.binding) ||
        entry.metadata.workspaceId !== entry.binding.workspaceId ||
        entry.metadata.publicClientId !== entry.binding.publicClientId ||
        entry.inventoryDigest !== (await computeRawInventoryDigest(entry.files)) ||
        Object.entries(entry.outcomes).some(
          ([id, value]) =>
            !entry.files.some((file) => file.fileId === id) ||
            !["deleted", "changed", "unknown"].includes(value)
        )
      )
        throw invalid();
      await this.save(entry, signal);
      await publish("archive");
      const archive = await this.archive(entry, prepared, signal);
      await publish("verify");
      // Every invocation, including resume, re-reads the archive rather than trusting a phase.
      const record = await this.record(entry, archive, signal);
      await publish("record");
      await this.gate.assertArchiveReaderReady(archive, record, signal);
      await this.check(signal);
      const proof = await this.remote.runDeleteProbe(signal);
      for (const file of [...entry.files].sort(
        (a, b) => Number(a.kind === "blob") - Number(b.kind === "blob")
      )) {
        if (entry.outcomes[file.fileId] === "deleted" || entry.outcomes[file.fileId] === "changed")
          continue;
        await this.check(signal);
        const v3 = await this.gate.verifyCurrentV3(record.v3, signal);
        if (!equal(v3, record.v3)) throw conflict();
        // Re-check immutable proof availability before each destructive operation.
        await this.remote.readVerified(entry.archive!, signal);
        await this.remote.readVerified(entry.record!, signal);
        await this.check(signal);
        const outcome = await this.remote.deletePinned(file, proof, signal);
        await this.check(signal);
        entry.outcomes[file.fileId] = outcome;
        await this.save(entry, signal);
        await publish("delete");
      }
      return await publish("complete");
    } finally {
      this.running = false;
    }
  }

  private async archive(
    entry: LegacyCompactionJournalEntry,
    prepared: EncodedRawArchive | undefined,
    signal: AbortSignal
  ): Promise<DecodedRawArchive> {
    if (entry.archive) {
      try {
        return await this.verifyArchive(entry, signal);
      } catch (error) {
        // Only a confirmed missing reserved ID allows recreating the same immutable object.
        if (!(error instanceof DriveError) || error.status !== 404) throw error;
      }
    }
    if (!prepared) {
      const objects: RawLegacyObject[] = [];
      for (const file of entry.files) {
        await this.check(signal);
        const object = await this.remote.captureRaw(withoutProof(file), signal);
        if (!equal(object.file, file)) throw conflict();
        objects.push(object);
      }
      prepared = await encodeRawArchive(objects, entry.metadata);
    }
    if (prepared.inventoryDigest !== entry.inventoryDigest) throw invalid();
    await this.check(signal);
    const receipt = await this.remote.createImmutable(
      "rawarchive",
      prepared.body,
      {
        ...entry.metadata,
        indexDigest: prepared.indexDigest,
        ...(entry.archive ? { reservedFileId: entry.archive.fileId } : {})
      },
      async (fileId) => {
        if (entry.archive && entry.archive.fileId !== fileId) throw invalid();
        entry.archive = {
          fileId,
          size: prepared.size,
          sha256: prepared.sha256,
          indexDigest: prepared.indexDigest
        };
        await this.save(entry, signal);
      },
      signal
    );
    if (
      !entry.archive ||
      !equal(receipt, {
        fileId: entry.archive.fileId,
        size: entry.archive.size,
        sha256: entry.archive.sha256
      })
    )
      throw invalid();
    return this.verifyArchive(entry, signal);
  }

  private async verifyArchive(entry: LegacyCompactionJournalEntry, signal: AbortSignal) {
    if (!entry.archive) throw invalid();
    await this.check(signal);
    const body = await this.remote.readVerified(entry.archive, signal);
    const { size, sha256, indexDigest } = entry.archive;
    const archive = await decodeRawArchive(body, { size, sha256, indexDigest });
    if (!(await verifyRawArchiveCoverage(archive.index, entry.files))) throw invalid();
    if (
      archive.inventoryDigest !== entry.inventoryDigest ||
      !equal(
        {
          operationId: archive.index.operationId,
          workspaceId: archive.index.workspaceId,
          publicClientId: archive.index.publicClientId,
          createdAt: archive.index.createdAt
        },
        entry.metadata
      )
    )
      throw invalid();
    return archive;
  }

  private async record(
    entry: LegacyCompactionJournalEntry,
    archive: DecodedRawArchive,
    signal: AbortSignal
  ): Promise<CompactionRecord> {
    if (!entry.archive) throw invalid();
    await this.check(signal);
    const v3 = await this.gate.verifyCurrentV3(entry.v3, signal);
    if (entry.v3 && !equal(v3, entry.v3)) throw conflict();
    entry.v3 = v3;
    const record: CompactionRecord = {
      formatVersion: 1,
      ...entry.metadata,
      archive: entry.archive,
      inventoryDigest: archive.inventoryDigest,
      v3
    };
    const body = new Blob([JSON.stringify(record)], { type: "application/json" });
    const expected = { size: body.size, sha256: await digest(body) };
    if (
      entry.record &&
      (entry.record.size !== expected.size || entry.record.sha256 !== expected.sha256)
    )
      throw invalid();
    let loaded: Blob | undefined;
    if (entry.record) {
      try {
        loaded = await this.remote.readVerified(entry.record, signal);
      } catch (error) {
        if (!(error instanceof DriveError) || error.status !== 404) throw error;
      }
    }
    if (!loaded) {
      await this.check(signal);
      const receipt = await this.remote.createImmutable(
        "compaction",
        body,
        {
          ...entry.metadata,
          ...(entry.record ? { reservedFileId: entry.record.fileId } : {})
        },
        async (fileId) => {
          if (entry.record && entry.record.fileId !== fileId) throw invalid();
          entry.record = { fileId, ...expected };
          await this.save(entry, signal);
        },
        signal
      );
      if (!entry.record || !equal(receipt, entry.record)) throw invalid();
      loaded = await this.remote.readVerified(entry.record, signal);
    }
    if (
      loaded.size !== expected.size ||
      (await digest(loaded)) !== expected.sha256 ||
      (await loaded.text()) !== (await body.text())
    )
      throw invalid();
    await this.check(signal);
    return record;
  }
}
