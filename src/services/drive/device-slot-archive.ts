import { isRecord } from "../../model/backup-format.js";
import { MAX_TOTAL_BYTES, prepareDriveBackup, sha256, shaPattern, uuidPattern } from "./backup.js";
import { summarize } from "./coordinator-types.js";
import {
  prepareDeviceSlotVersion,
  restoreDeviceSlotVersion,
  verifyDeviceSlotVersion
} from "./device-slot-package.js";
import type { DeviceSlotPackageVersion } from "./device-slot-package.js";
import { driveInspectionIdentity } from "./reader-guard.js";
import { DRIVE_NAMESPACE, DriveError, LEGACY_DRIVE_NAMESPACE } from "./types.js";
import type { Backup } from "../../model/types.js";
import type { DriveInspection } from "./types.js";
import type { DriveSync } from "./sync.js";

export interface ArchiveSource {
  readonly namespace: string;
  readonly sync: DriveSync;
  readonly inspection: DriveInspection;
}

interface ArchiveEntry {
  namespace: string;
  nodeId: string;
  createdAt: string;
  parents: string[];
  fileHash: string;
  version: DeviceSlotPackageVersion["reference"];
}

export interface LegacyArchive {
  readonly body: Blob;
  readonly digest: string;
  readonly choices: ReadonlyArray<ReturnType<typeof summarize> & { id: string }>;
  readonly count: number;
}

const magic = new Uint8Array([77, 84, 80, 45, 71, 68, 65, 1]);
const headerLimit = 1024 * 1024;
const countLimit = 2048;
const byteLimit = 512 * 1024 * 1024;
const issuedSources = new WeakMap<LegacyArchive, string>();

const invalid = () => new DriveError("remote-invalid", "The Google backup archive is invalid.");
const limit = () =>
  new DriveError("limit", "The Google backup archive exceeds its size or count limit.");
const selectionId = ({ namespace, nodeId }: ArchiveEntry) => `${namespace}:${nodeId}`;
const sourceIdentity = (sources: readonly ArchiveSource[]) =>
  JSON.stringify(
    sources
      .map(({ namespace, inspection }) => [namespace, driveInspectionIdentity(inspection)])
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
  );

export function assertArchiveMatchesSources(
  archive: LegacyArchive,
  sources: readonly ArchiveSource[]
) {
  if (issuedSources.get(archive) !== sourceIdentity(sources)) throw invalid();
}

function prefix(bytes: number) {
  const result = new Uint8Array(magic.length + 4);
  result.set(magic);
  new DataView(result.buffer).setUint32(magic.length, bytes);
  return result;
}

export async function createLegacyArchive(
  sources: readonly ArchiveSource[],
  signal: AbortSignal,
  progress?: (completedFiles: number, totalFiles: number, transferredBytes: number) => void
): Promise<LegacyArchive> {
  const pinned = sources.map((source) => ({
    ...source,
    inspection: structuredClone(source.inspection)
  }));
  const active = pinned.filter(({ inspection }) => inspection.snapshots.length);
  const total = active.reduce((sum, item) => sum + item.inspection.snapshots.length, 0);
  if (!total || total > countLimit) throw limit();
  const migrationSource =
    active.find(({ namespace }) => namespace === DRIVE_NAMESPACE) ?? active[0];
  const entries: ArchiveEntry[] = [],
    bodies: Blob[] = [],
    choices: LegacyArchive["choices"][number][] = [];
  let bytes = 0;
  for (const { namespace, sync, inspection } of active) {
    const ordered = inspection.snapshots.map(({ manifest }) => manifest.nodeId).sort();
    await sync.visitArchiveSnapshots(
      inspection,
      ordered,
      async ({ manifest, file }, backup) => {
        const version = await prepareDeviceSlotVersion(await prepareDriveBackup(backup), signal);
        bytes += version.body.size;
        if (bytes > byteLimit) throw limit();
        const entry = {
          namespace,
          nodeId: manifest.nodeId,
          createdAt: manifest.createdAt,
          parents: [...manifest.parents].sort(),
          fileHash: file.appProperties.mtpHash ?? "",
          version: version.reference
        };
        entries.push(entry);
        bodies.push(version.body);
        if (namespace === migrationSource?.namespace && inspection.heads.includes(entry.nodeId))
          choices.push({ ...summarize(backup), date: manifest.createdAt, id: selectionId(entry) });
        progress?.(entries.length, total, bytes);
      },
      signal
    );
  }
  await assertArchiveStillCurrent(pinned, signal);
  const header = new Blob([JSON.stringify(entries)]);
  if (header.size > headerLimit || bytes + header.size + magic.length + 4 > byteLimit)
    throw limit();
  const digest = await sha256(header);
  signal.throwIfAborted();
  const archive = Object.freeze({
    body: new Blob([prefix(header.size), header, ...bodies], { type: "application/octet-stream" }),
    digest,
    choices: Object.freeze(choices.map((choice) => Object.freeze(choice))),
    count: entries.length
  });
  issuedSources.set(archive, sourceIdentity(pinned));
  return archive;
}

export async function assertArchiveStillCurrent(
  sources: readonly ArchiveSource[],
  signal: AbortSignal
) {
  for (const { sync, inspection } of sources) {
    signal.throwIfAborted();
    if (driveInspectionIdentity(await sync.inspect()) !== driveInspectionIdentity(inspection))
      throw new DriveError(
        "conflict",
        "The legacy versions changed while preparing the migration."
      );
  }
  signal.throwIfAborted();
}

/** Accept only the recreated file matching the issued archive; verify each frame separately. */
export async function verifyLegacyArchiveFile(
  file: Blob,
  issued: LegacyArchive,
  signal: AbortSignal,
  selected?: string
): Promise<Backup | undefined> {
  if (
    file.size !== issued.body.size ||
    (selected && !issued.choices.some(({ id }) => id === selected))
  )
    throw invalid();
  return readArchive(file, issued.digest, signal, issued.count, selected);
}

/** Recover an archived historical version using its saved fingerprint, even after a reload. */
export async function restoreArchivedLegacyVersion(
  file: Blob,
  archiveDigest: string,
  selection: string,
  signal: AbortSignal
): Promise<Backup> {
  const restored = await readArchive(file, archiveDigest, signal, undefined, selection);
  if (!restored) throw invalid();
  return restored;
}

async function readArchive(
  file: Blob,
  expectedDigest: string,
  signal: AbortSignal,
  count?: number,
  selected?: string
): Promise<Backup | undefined> {
  const prefixSize = magic.length + 4;
  if (!(file instanceof Blob) || file.size > byteLimit || !shaPattern.test(expectedDigest))
    throw invalid();
  signal.throwIfAborted();
  const frame = await file.slice(0, prefixSize).arrayBuffer();
  const bytes = new Uint8Array(frame);
  if (frame.byteLength !== prefixSize || !magic.every((byte, index) => bytes[index] === byte))
    throw invalid();
  const headerSize = new DataView(frame).getUint32(magic.length);
  if (!headerSize || headerSize > headerLimit || prefixSize + headerSize >= file.size)
    throw invalid();
  let offset = prefixSize + headerSize;
  const header = file.slice(prefixSize, offset);
  if ((await sha256(header)) !== expectedDigest) throw invalid();
  let entries: unknown;
  try {
    entries = JSON.parse(await header.text()) as unknown;
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    entries.length > countLimit ||
    (count !== undefined && entries.length !== count)
  )
    throw invalid();
  let backup: Backup | undefined;
  const seen = new Set<string>();
  for (const entry of entries) {
    signal.throwIfAborted();
    if (
      !isRecord(entry) ||
      (entry.namespace !== DRIVE_NAMESPACE && entry.namespace !== LEGACY_DRIVE_NAMESPACE) ||
      typeof entry.nodeId !== "string" ||
      !uuidPattern.test(entry.nodeId) ||
      !isRecord(entry.version) ||
      !Number.isSafeInteger(entry.version.size) ||
      typeof entry.version.size !== "number" ||
      typeof entry.version.sha256 !== "string"
    )
      throw invalid();
    const id = `${entry.namespace}:${entry.nodeId}`;
    if (seen.has(id)) throw invalid();
    seen.add(id);
    const ref = { size: entry.version.size, sha256: entry.version.sha256 };
    if (ref.size < 1 || ref.size > MAX_TOTAL_BYTES || offset + ref.size > file.size)
      throw invalid();
    const version = await verifyDeviceSlotVersion(
      file.slice(offset, offset + ref.size),
      ref,
      signal
    );
    if (selected === id) backup = await restoreDeviceSlotVersion(version, signal);
    offset += ref.size;
  }
  if (offset !== file.size || (selected && !backup)) throw invalid();
  return backup;
}
