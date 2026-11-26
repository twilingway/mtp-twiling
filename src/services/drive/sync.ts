import type { Backup } from "../../model/types.js";
import {
  MAX_IMAGE_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_PAYLOAD_BYTES,
  prepareDriveBackup,
  reference,
  restoreDriveBackup,
  sha256,
  shaPattern,
  uuidPattern,
  validateManifest,
  verifyContent
} from "./backup.js";
import { DRIVE_NAMESPACE, DriveError } from "./types.js";
import type { DriveReport } from "./progress.js";
import {
  assertDriveInspectionUnchanged,
  assertReadableDriveManifest,
  assertReadableDrivePayload
} from "./reader-guard.js";
import type {
  ContentReference,
  DriveFile,
  DriveInspection,
  DriveStore,
  RemoteSnapshot,
  SnapshotManifest
} from "./types.js";

export class DriveConflictError extends DriveError {
  constructor(public readonly heads: string[]) {
    super("conflict", "На Google Диске есть другие изменения. Выберите сохраняемый вариант.");
  }
}
const invalid = () =>
  new DriveError("remote-invalid", "Повреждена структура снимков Google Диска.");
const MANIFEST_READ_BATCH = 4;
const driveVersionPattern = /^\d{1,19}$/;
interface VerifiedManifest {
  version: string;
  hash: string;
  size: number;
  key: string;
  text: string;
}
function sameSet(left: string[], right: string[]): boolean {
  const sortedRight = [...right].sort();
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === sortedRight[index])
  );
}
function fileHash(file: DriveFile, kind: "snapshot" | "blob", namespace: string): string {
  const hash = file.appProperties.mtpHash;
  if (
    file.appProperties.mtpNamespace !== namespace ||
    file.appProperties.mtpKind !== kind ||
    !hash ||
    !shaPattern.test(hash)
  )
    throw invalid();
  return hash;
}
function inspectGraph(snapshots: RemoteSnapshot[], namespace: string): DriveInspection {
  const nodes = new Map<string, RemoteSnapshot>();
  for (const snapshot of snapshots) {
    const previous = nodes.get(snapshot.manifest.nodeId);
    if (
      previous &&
      fileHash(previous.file, "snapshot", namespace) !==
        fileHash(snapshot.file, "snapshot", namespace)
    )
      throw invalid();
    nodes.set(snapshot.manifest.nodeId, snapshot);
  }
  const childCounts = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (const snapshot of nodes.values())
    for (const parent of snapshot.manifest.parents) {
      if (!nodes.has(parent)) throw invalid();
      childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    }
  const heads = [...childCounts]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const pending = [...heads];
  let visited = 0;
  while (pending.length) {
    const nodeId = pending.pop();
    const node = nodeId ? nodes.get(nodeId) : undefined;
    if (!node) throw invalid();
    visited++;
    for (const parent of node.manifest.parents) {
      const count = (childCounts.get(parent) ?? 0) - 1;
      childCounts.set(parent, count);
      if (count === 0) pending.push(parent);
    }
  }
  if (visited !== nodes.size) throw invalid();
  return { snapshots: [...nodes.values()], heads, conflict: heads.length > 1 };
}

export interface PublishOptions {
  deviceId: string;
  /** Last observed/applied remote parent; [] only for a genuinely empty Drive. */
  parents: string[];
  checkBeforeWrite?: () => void;
  /** Optional pinned observation from a coordinator; never persisted. */
  expectedInspection?: DriveInspection;
}
export interface PublishResult {
  nodeId: string;
  inspection: DriveInspection;
}

/** No storage/controller coupling: caller owns local association and import confirmation. */
export class DriveSync {
  private writing = false;
  private manifestCache = new Map<string, VerifiedManifest>();
  constructor(
    private readonly store: DriveStore,
    private readonly namespace: string = DRIVE_NAMESPACE
  ) {}

  async inspect(): Promise<DriveInspection> {
    const files = await this.store.list("snapshot");
    if (files.length > 10000 || files.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024)
      throw new DriveError("limit", "Слишком большой каталог снимков Google Диска.");
    const listed = new Set(files.map(({ id }) => id));
    for (const id of this.manifestCache.keys()) if (!listed.has(id)) this.manifestCache.delete(id);
    const previous = this.manifestCache;
    const next = new Map<string, VerifiedManifest>();
    const snapshots: RemoteSnapshot[] = [];
    const inspectFile = async (file: DriveFile): Promise<RemoteSnapshot> => {
      const hash = fileHash(file, "snapshot", this.namespace);
      const { id, size, version } = file;
      const key = file.appProperties.mtpKey;
      const cacheable = typeof version === "string" && driveVersionPattern.test(version);
      const cached = cacheable ? previous.get(id) : undefined;
      const verified =
        cached &&
        cached.version === version &&
        cached.hash === hash &&
        cached.size === size &&
        cached.key === key
          ? cached.text
          : await this.readManifestText(file, hash);
      let value: unknown;
      try {
        value = JSON.parse(verified);
      } catch {
        throw invalid();
      }
      assertReadableDriveManifest(value);
      const manifest = validateManifest(value);
      if (key !== manifest.nodeId) throw invalid();
      if (cacheable) next.set(id, { version, hash, size, key, text: verified });
      return { manifest, file };
    };
    for (let offset = 0; offset < files.length; offset += MANIFEST_READ_BATCH) {
      const results = await Promise.allSettled(
        files.slice(offset, offset + MANIFEST_READ_BATCH).map(inspectFile)
      );
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        snapshots.push(result.value);
      }
    }
    const inspection = inspectGraph(snapshots, this.namespace);
    this.manifestCache = next;
    return inspection;
  }

  private async readManifestText(file: DriveFile, hash: string): Promise<string> {
    const body = await this.store.read(file, MAX_MANIFEST_BYTES);
    await verifyContent(body, { sha256: hash, size: file.size });
    try {
      return await body.text();
    } catch {
      throw invalid();
    }
  }

  async download(
    nodeId: string,
    expectedInspection?: DriveInspection,
    report?: DriveReport
  ): Promise<Backup> {
    report?.("read-versions");
    const inspection = await this.inspect();
    if (expectedInspection) assertDriveInspectionUnchanged(expectedInspection, inspection);
    const snapshot = inspection.snapshots.find((item) => item.manifest.nodeId === nodeId);
    if (!snapshot) throw invalid();
    const blobs = await this.blobIndex();
    const manifest = snapshot.manifest;
    let transferredBytes = 0;
    const totalFiles = manifest.images.length + 1;
    const progress = (completedFiles: number) =>
      report?.("download", { transfer: { completedFiles, totalFiles, transferredBytes } });
    progress(0);
    const payload = await this.readPayload(manifest, blobs);
    transferredBytes += payload.size;
    progress(1);
    const images: Blob[] = [];
    for (const image of manifest.images) {
      const body = await this.loadBlob(image, blobs, MAX_IMAGE_BYTES);
      images.push(body);
      transferredBytes += body.size;
      progress(images.length + 1);
    }
    const backup = await restoreDriveBackup(payload, images);
    if (backup.images.some((image, index) => image.type !== manifest.images[index]?.mimeType))
      throw invalid();
    return backup;
  }

  /** Reader capability check only: no image binary download or base64 allocation. */
  async validateHeads(inspection: DriveInspection): Promise<void> {
    if (inspection.heads.length) {
      const blobs = await this.blobIndex();
      for (const head of inspection.heads) {
        const snapshot = inspection.snapshots.find((item) => item.manifest.nodeId === head);
        if (!snapshot) throw invalid();
        await this.readPayload(snapshot.manifest, blobs);
        for (const image of snapshot.manifest.images)
          if (!blobs.get(image.sha256)?.some((file) => file.size === image.size)) throw invalid();
      }
    }
    assertDriveInspectionUnchanged(inspection, await this.inspect());
  }

  private async readPayload(
    manifest: SnapshotManifest,
    blobs: Map<string, DriveFile[]>
  ): Promise<Blob> {
    const payload = await this.loadBlob(manifest.payload, blobs, MAX_PAYLOAD_BYTES);
    let decoded: unknown;
    try {
      decoded = JSON.parse(await payload.text());
    } catch {
      throw invalid();
    }
    const backup = assertReadableDrivePayload(decoded);
    if (
      backup.images.length !== manifest.images.length ||
      backup.images.some(
        (image, index) => image.data !== "" || image.type !== manifest.images[index]?.mimeType
      )
    )
      throw invalid();
    return payload;
  }

  publish(backup: unknown, options: PublishOptions, report?: DriveReport): Promise<PublishResult> {
    if (this.namespace !== DRIVE_NAMESPACE)
      return Promise.reject(new DriveError("permission", "Legacy stream is read-only"));
    if (options.parents.length > 1) return Promise.reject(new DriveConflictError(options.parents));
    return this.write(backup, options, false, report);
  }

  /** The caller must show all conflicting heads and obtain an explicit user choice first. */
  resolve(backup: unknown, options: PublishOptions, report?: DriveReport): Promise<PublishResult> {
    if (this.namespace !== DRIVE_NAMESPACE)
      return Promise.reject(new DriveError("permission", "Legacy stream is read-only"));
    if (options.parents.length < 2)
      return Promise.reject(
        new DriveError("conflict", "Для разрешения нужны все конфликтующие снимки.")
      );
    return this.write(backup, options, true, report);
  }

  private async write(
    backup: unknown,
    options: PublishOptions,
    resolving: boolean,
    report?: DriveReport
  ): Promise<PublishResult> {
    if (this.writing) throw new DriveError("busy", "Синхронизация Google Диска уже выполняется.");
    if (
      !uuidPattern.test(options.deviceId) ||
      !options.parents.every((parent) => uuidPattern.test(parent)) ||
      new Set(options.parents).size !== options.parents.length
    )
      throw invalid();
    this.writing = true;
    // Clone parent identities before yielding, so caller mutation cannot reparent a snapshot.
    const parents = [...options.parents];
    const deviceId = options.deviceId;
    const checkBeforeWrite = options.checkBeforeWrite;
    const expected = options.expectedInspection && structuredClone(options.expectedInspection);
    try {
      report?.("prepare-upload");
      const prepared = await prepareDriveBackup(backup);
      report?.("check-versions");
      const before = await this.inspect();
      if (expected) assertDriveInspectionUnchanged(expected, before);
      if (!sameSet(parents, before.heads) || (before.conflict && !resolving))
        throw new DriveConflictError(before.heads);
      await this.validateHeads(before);
      const blobs = await this.blobIndex();
      const payload = await reference(prepared.payload);
      assertDriveInspectionUnchanged(before, await this.inspect());
      checkBeforeWrite?.();
      let completedFiles = 0,
        transferredBytes = 0;
      const totalFiles = prepared.images.length + 2;
      const progress = () =>
        report?.("upload", { transfer: { completedFiles, totalFiles, transferredBytes } });
      const save = async (body: Blob, ref: ContentReference) => {
        if (await this.saveBlob(body, ref, blobs)) transferredBytes += body.size;
        completedFiles++;
        progress();
      };
      progress();
      await save(prepared.payload, payload);
      for (const image of prepared.images) await save(image.body, image.reference);
      const manifest: SnapshotManifest = {
        protocol: 1,
        nodeId: crypto.randomUUID(),
        deviceId,
        parents,
        createdAt: new Date().toISOString(),
        payload,
        images: prepared.images.map((image) => ({
          ...image.reference,
          index: image.index,
          mimeType: image.mimeType
        }))
      };
      validateManifest(manifest);
      const body = new Blob([JSON.stringify(manifest)], { type: "application/json" });
      if (body.size > MAX_MANIFEST_BYTES)
        throw new DriveError("limit", "Манифест снимка слишком большой.");
      const manifestHash = await sha256(body);
      report?.("confirm");
      assertDriveInspectionUnchanged(before, await this.inspect());
      progress();
      await this.store.create("snapshot", manifest.nodeId, manifestHash, body);
      transferredBytes += body.size;
      completedFiles++;
      progress();
      report?.("confirm");
      return { nodeId: manifest.nodeId, inspection: await this.inspect() };
    } finally {
      this.writing = false;
    }
  }

  private async blobIndex(): Promise<Map<string, DriveFile[]>> {
    const files = await this.store.list("blob");
    const result = new Map<string, DriveFile[]>();
    for (const file of files) {
      const hash = fileHash(file, "blob", this.namespace);
      if (file.appProperties.mtpKey !== hash) throw invalid();
      const group = result.get(hash) ?? [];
      group.push(file);
      result.set(hash, group);
    }
    return result;
  }
  private async loadBlob(
    ref: ContentReference,
    files: Map<string, DriveFile[]>,
    maxBytes: number
  ): Promise<Blob> {
    const file = files.get(ref.sha256)?.find((candidate) => candidate.size === ref.size);
    if (!file) throw invalid();
    const body = await this.store.read(file, maxBytes);
    await verifyContent(body, ref);
    return body;
  }
  private async saveBlob(
    body: Blob,
    ref: ContentReference,
    files: Map<string, DriveFile[]>
  ): Promise<boolean> {
    if (files.has(ref.sha256)) {
      await this.loadBlob(ref, files, Math.max(MAX_PAYLOAD_BYTES, MAX_IMAGE_BYTES));
      return false;
    }
    const file = await this.store.create("blob", ref.sha256, ref.sha256, body);
    files.set(ref.sha256, [file]);
    return true;
  }
}
