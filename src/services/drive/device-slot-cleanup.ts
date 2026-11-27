import { shaPattern, uuidPattern } from "./backup.js";
import {
  assertArchiveMatchesSources,
  assertArchiveStillCurrent,
  verifyLegacyArchiveFile
} from "./device-slot-archive.js";
import type { ArchiveSource, LegacyArchive } from "./device-slot-archive.js";
import { DRIVE_NAMESPACE, DriveError, LEGACY_DRIVE_NAMESPACE } from "./types.js";
import type { DriveFile } from "./types.js";

type LegacyNamespace = typeof DRIVE_NAMESPACE | typeof LEGACY_DRIVE_NAMESPACE;
type LegacyKind = "snapshot" | "blob";
interface LegacyFile {
  readonly namespace: LegacyNamespace;
  readonly kind: LegacyKind;
  readonly id: string;
  readonly key: string;
  readonly hash: string;
  readonly size: number;
  readonly version: string;
}
export interface LegacyCleanupSource extends ArchiveSource {
  readonly namespace: LegacyNamespace;
}
export interface LegacyCleanupTransport {
  list(namespace: LegacyNamespace, kind: LegacyKind): Promise<readonly DriveFile[]>;
  /** Must delete only the pinned immutable file under the externally held writer fence. */
  deletePinned(file: LegacyFile, signal: AbortSignal): Promise<void>;
}
export interface LegacyCleanupGate {
  /** Valid only while previously released writers are disabled and in-flight callbacks drained. */
  assertOldWritersFenced(signal: AbortSignal): Promise<void>;
  /** Must fully verify the committed v3 head and require this exact archive fingerprint. */
  assertMigratedHead(archiveDigest: string, signal: AbortSignal): Promise<void>;
}
interface CleanupPending {
  readonly fileCount: number;
  readonly bytes: number;
  readonly archiveDigest: string;
}
interface PinnedCleanup {
  readonly all: Map<string, LegacyFile>;
  readonly ordered: LegacyFile[];
  readonly sources: readonly LegacyCleanupSource[];
  readonly disk: Blob;
  readonly archive: LegacyArchive;
}

const invalid = () => new DriveError("remote-invalid", "The legacy Google inventory is invalid.");
const conflict = () =>
  new DriveError("conflict", "The legacy Google inventory changed. Refresh the cleanup preview.");
const uuidKey = (namespace: LegacyNamespace, nodeId: string) => `${namespace}:${nodeId}`;

export class LegacyDriveCleanup {
  private readonly previews = new WeakMap<CleanupPending, PinnedCleanup>();
  private running = false;

  constructor(
    private readonly remote: LegacyCleanupTransport,
    private readonly gate: LegacyCleanupGate
  ) {}

  private async observe(signal: AbortSignal) {
    const files = await Promise.all(
      ([DRIVE_NAMESPACE, LEGACY_DRIVE_NAMESPACE] as const).flatMap((namespace) =>
        (["snapshot", "blob"] as const).map(async (kind) => ({
          namespace,
          kind,
          files: await this.remote.list(namespace, kind)
        }))
      )
    );
    signal.throwIfAborted();
    const result = new Map<string, LegacyFile>();
    for (const { namespace, kind, files: entries } of files) {
      for (const { id, size, version, appProperties } of entries) {
        const { mtpNamespace, mtpKind, mtpKey: key, mtpHash: hash } = appProperties;
        if (
          !/^[\w-]{1,200}$/.test(id) ||
          result.has(id) ||
          !version ||
          !/^\d+$/.test(version) ||
          !key ||
          !hash ||
          !shaPattern.test(hash) ||
          mtpNamespace !== namespace ||
          mtpKind !== kind ||
          !Number.isSafeInteger(size) ||
          size < 0 ||
          (kind === "snapshot" ? !uuidPattern.test(key) : key !== hash)
        )
          throw invalid();
        result.set(id, { namespace, kind, id, key, hash, size, version });
      }
    }
    return result;
  }

  private async assertInventory(expected: ReadonlyMap<string, LegacyFile>, signal: AbortSignal) {
    const actual = await this.observe(signal);
    if (
      actual.size !== expected.size ||
      Array.from(actual).some(
        ([id, item]) => JSON.stringify(expected.get(id)) !== JSON.stringify(item)
      )
    )
      throw conflict();
  }

  async preview(
    sources: readonly LegacyCleanupSource[],
    archive: LegacyArchive,
    disk: Blob,
    signal: AbortSignal
  ): Promise<CleanupPending> {
    if (this.running) throw conflict();
    if (
      sources.length !== 2 ||
      new Set(sources.map(({ namespace }) => namespace)).size !== 2 ||
      sources.some(({ inspection }) => inspection.heads.length > 1)
    )
      throw conflict();
    assertArchiveMatchesSources(archive, sources);
    const pinnedSources = sources.map((source) => ({
      ...source,
      inspection: structuredClone(source.inspection)
    }));
    await verifyLegacyArchiveFile(disk, archive, signal);
    await this.gate.assertMigratedHead(archive.digest, signal);
    const all = await this.observe(signal);
    await assertArchiveStillCurrent(pinnedSources, signal);
    const byNode = new Map<string, { files: LegacyFile[]; children: number; parents: string[] }>();
    const refs = new Set<string>();
    const byId = new Map<string, string>();
    for (const { namespace, inspection } of pinnedSources) {
      for (const { file, manifest } of inspection.snapshots) {
        const key = uuidKey(namespace, manifest.nodeId);
        byNode.set(key, {
          files: [],
          children: 0,
          parents: manifest.parents.map((id) => uuidKey(namespace, id))
        });
        byId.set(key, file.appProperties.mtpHash ?? "");
        for (const ref of [manifest.payload, ...manifest.images])
          refs.add(`${namespace}:${ref.sha256}:${ref.size}`);
      }
    }
    if (byNode.size !== archive.count) throw conflict();
    const blobs: LegacyFile[] = [];
    for (const file of all.values()) {
      if (file.kind === "blob") {
        if (refs.has(`${file.namespace}:${file.hash}:${file.size}`)) blobs.push(file);
      } else {
        const key = uuidKey(file.namespace, file.key);
        const node = byNode.get(key);
        if (!node || file.hash !== byId.get(key)) throw conflict();
        node.files.push(file);
      }
    }
    for (const node of byNode.values()) {
      if (!node.files.length) throw conflict();
      for (const key of node.parents) {
        const parent = byNode.get(key);
        if (!parent) throw conflict();
        parent.children++;
      }
    }
    const queue = [...byNode.values()].filter(({ children }) => children === 0);
    const ordered: LegacyFile[] = [];
    let visited = 0;
    while (queue.length) {
      const node = queue.pop();
      if (!node) throw invalid();
      visited++;
      ordered.push(...node.files);
      for (const key of node.parents) {
        const parent = byNode.get(key);
        if (!parent) throw invalid();
        if (--parent.children === 0) queue.push(parent);
      }
    }
    if (visited !== byNode.size) throw invalid();
    ordered.push(...blobs);
    const preview = Object.freeze({
      fileCount: ordered.length,
      bytes: ordered.reduce((n, file) => n + file.size, 0),
      archiveDigest: archive.digest
    });
    this.previews.set(preview, { all, ordered, sources: pinnedSources, disk, archive });
    return preview;
  }

  async execute(
    preview: CleanupPending,
    signal: AbortSignal,
    onConfirmed: (fileId: string, completedFiles: number) => Promise<void>
  ): Promise<number> {
    const pinned = this.previews.get(preview);
    if (!pinned || this.running) throw conflict();
    this.previews.delete(preview);
    this.running = true;
    try {
      await this.gate.assertOldWritersFenced(signal);
      await verifyLegacyArchiveFile(pinned.disk, pinned.archive, signal);
      await assertArchiveStillCurrent(pinned.sources, signal);
      const expected = new Map(pinned.all);
      let removed = 0;
      for (const file of pinned.ordered) {
        await this.gate.assertMigratedHead(preview.archiveDigest, signal);
        await this.gate.assertOldWritersFenced(signal);
        await this.assertInventory(expected, signal);
        signal.throwIfAborted();
        await this.remote.deletePinned(file, signal);
        expected.delete(file.id);
        await this.assertInventory(expected, signal);
        await onConfirmed(file.id, ++removed);
      }
      return removed;
    } finally {
      this.running = false;
    }
  }
}
