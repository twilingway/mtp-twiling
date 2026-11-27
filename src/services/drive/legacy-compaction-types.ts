import type {
  ArchiveReceipt,
  CompactionRecord,
  DecodedRawArchive,
  RawArchiveMetadata,
  RawLegacyFile,
  RawLegacyObject
} from "./legacy-raw-archive-types.js";
import type { DRIVE_CLIENT_ID } from "./types.js";

export type LegacyCandidate = Omit<RawLegacyFile, "etag" | "sha256">;
export type CompactionV3 = CompactionRecord["v3"];
export type CompactionReceipt = Omit<ArchiveReceipt, "indexDigest">;
export type CompactionOutcome = "deleted" | "changed" | "unknown";
export interface CompactionBinding {
  readonly accountKey: string;
  readonly clientId: typeof DRIVE_CLIENT_ID;
  readonly workspaceId: string;
  readonly publicClientId: string;
}
export interface LegacyCompactionRemote<Proof> {
  /** Resolves only after both namespaces and both kinds have been listed completely. */
  listLegacy(signal: AbortSignal): Promise<readonly LegacyCandidate[]>;
  captureRaw(candidate: LegacyCandidate, signal: AbortSignal): Promise<RawLegacyObject>;
  createImmutable(
    kind: "rawarchive" | "compaction",
    body: Blob,
    metadata: RawArchiveMetadata & {
      readonly indexDigest?: string;
      readonly reservedFileId?: string;
    },
    onReserved: (fileId: string) => Promise<void>,
    signal: AbortSignal
  ): Promise<CompactionReceipt>;
  readVerified(receipt: CompactionReceipt, signal: AbortSignal): Promise<Blob>;
  runDeleteProbe(signal: AbortSignal): Promise<Proof>;
  /** Includes exact-version metadata check, conditional DELETE and unknown-response reconciliation. */
  deletePinned(file: RawLegacyFile, proof: Proof, signal: AbortSignal): Promise<CompactionOutcome>;
}
export interface LegacyCompactionGate {
  readonly binding: CompactionBinding;
  /** Fences credential, account, enabled state, client mode and generation, including dispatch. */
  checkIdentity(signal: AbortSignal): Promise<void>;
  /** Fully downloads and validates the chosen current v3 package; never creates a default version. */
  verifyCurrentV3(expected: CompactionV3 | undefined, signal: AbortSignal): Promise<CompactionV3>;
  /** Proves the installed recovery reader can consume this exact verified archive. */
  assertArchiveReaderReady(
    archive: DecodedRawArchive,
    record: CompactionRecord,
    signal: AbortSignal
  ): Promise<void>;
}
export interface LegacyCompactionPreview {
  readonly operationId: string;
  readonly fileCount: number;
  readonly bytes: number;
  readonly inventoryDigest: string;
}
export interface LegacyCompactionCaptureProgress {
  readonly checkedFiles: number;
  readonly totalFiles: number;
}
export interface LegacyCompactionJournalEntry {
  readonly metadata: RawArchiveMetadata;
  readonly binding: CompactionBinding;
  readonly files: readonly RawLegacyFile[];
  readonly inventoryDigest: string;
  archive?: ArchiveReceipt;
  record?: CompactionReceipt;
  v3?: CompactionV3;
  outcomes: Record<string, CompactionOutcome>;
}
export interface LegacyCompactionJournal {
  read(operationId: string): Promise<LegacyCompactionJournalEntry | undefined>;
  /** Must resolve after native durable commit, and abort that transaction with signal. */
  save(entry: LegacyCompactionJournalEntry, signal: AbortSignal): Promise<void>;
}
export interface LegacyCompactionProgress extends LegacyCompactionPreview {
  readonly phase: "archive" | "verify" | "record" | "delete" | "complete";
  readonly archivedFiles: number;
  readonly deletedFiles: number;
  readonly changedFiles: number;
  readonly pendingFiles: number;
}

export interface LegacyLateInspection {
  readonly namespace: "mtp-drive-v1" | "mtp-drive-v2";
  readonly snapshotIds: readonly string[];
  readonly headIds: readonly string[];
}
