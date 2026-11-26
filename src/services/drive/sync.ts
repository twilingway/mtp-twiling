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
  constructor(
    private readonly store: DriveStore,
    private readonly namespace: string = DRIVE_NAMESPACE
  ) {}

  async inspect(): Promise<DriveInspection> {
    const files = await this.store.list("snapshot");
    if (files.length > 10000 || files.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024)
      throw new DriveError("limit", "Слишком большой каталог снимков Google Диска.");
    const snapshots: RemoteSnapshot[] = [];
    for (const file of files) {
      const hash = fileHash(file, "snapshot", this.namespace);
      const body = await this.store.read(file, MAX_MANIFEST_BYTES);
      await verifyContent(body, { sha256: hash, size: file.size });
      let value: unknown;
      try {
        value = JSON.parse(await body.text());
      } catch {
        throw invalid();
      }
      assertReadableDriveManifest(value);
      const manifest = validateManifest(value);
      if (file.appProperties.mtpKey !== manifest.nodeId) throw invalid();
      snapshots.push({ manifest, file });
    }
    return inspectGraph(snapshots, this.namespace);
  }

  async download(nodeId: string, expectedInspection?: DriveInspection): Promise<Backup> {
    const inspection = await this.inspect();
    if (expectedInspection) assertDriveInspectionUnchanged(expectedInspection, inspection);
    const snapshot = inspection.snapshots.find((item) => item.manifest.nodeId === nodeId);
    if (!snapshot) throw invalid();
    const blobs = await this.blobIndex();
    const manifest = snapshot.manifest;
    const payload = await this.readPayload(manifest, blobs);
    const images: Blob[] = [];
    for (const image of manifest.images)
      images.push(await this.loadBlob(image, blobs, MAX_IMAGE_BYTES));
    const backup = await restoreDriveBackup(payload, images);
    if (backup.images.some((image, index) => image.type !== manifest.images[index]?.mimeType))
      throw invalid();
    return backup;
  }

  /** Reader capability check only: no image binary download or base64 allocation. */
  async validateHeads(inspection: DriveInspection): Promise<void> {
    const blobs = await this.blobIndex();
    for (const head of inspection.heads) {
      const snapshot = inspection.snapshots.find((item) => item.manifest.nodeId === head);
      if (!snapshot) throw invalid();
      await this.readPayload(snapshot.manifest, blobs);
      for (const image of snapshot.manifest.images)
        if (!blobs.get(image.sha256)?.some((file) => file.size === image.size)) throw invalid();
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

  publish(backup: unknown, options: PublishOptions): Promise<PublishResult> {
    if (this.namespace !== DRIVE_NAMESPACE)
      return Promise.reject(new DriveError("permission", "Legacy stream is read-only"));
    if (options.parents.length > 1) return Promise.reject(new DriveConflictError(options.parents));
    return this.write(backup, options, false);
  }

  /** The caller must show all conflicting heads and obtain an explicit user choice first. */
  resolve(backup: unknown, options: PublishOptions): Promise<PublishResult> {
    if (this.namespace !== DRIVE_NAMESPACE)
      return Promise.reject(new DriveError("permission", "Legacy stream is read-only"));
    if (options.parents.length < 2)
      return Promise.reject(
        new DriveError("conflict", "Для разрешения нужны все конфликтующие снимки.")
      );
    return this.write(backup, options, true);
  }

  private async write(
    backup: unknown,
    options: PublishOptions,
    resolving: boolean
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
    const expected = options.expectedInspection && structuredClone(options.expectedInspection);
    try {
      const prepared = await prepareDriveBackup(backup);
      const before = await this.inspect();
      if (expected) assertDriveInspectionUnchanged(expected, before);
      if (!sameSet(parents, before.heads) || (before.conflict && !resolving))
        throw new DriveConflictError(before.heads);
      await this.validateHeads(before);
      const blobs = await this.blobIndex();
      const payload = await reference(prepared.payload);
      assertDriveInspectionUnchanged(before, await this.inspect());
      await this.saveBlob(prepared.payload, payload, blobs);
      for (const image of prepared.images) await this.saveBlob(image.body, image.reference, blobs);
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
      assertDriveInspectionUnchanged(before, await this.inspect());
      await this.store.create("snapshot", manifest.nodeId, manifestHash, body);
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
  ): Promise<void> {
    if (files.has(ref.sha256)) {
      await this.loadBlob(ref, files, Math.max(MAX_PAYLOAD_BYTES, MAX_IMAGE_BYTES));
      return;
    }
    const file = await this.store.create("blob", ref.sha256, ref.sha256, body);
    files.set(ref.sha256, [file]);
  }
}
