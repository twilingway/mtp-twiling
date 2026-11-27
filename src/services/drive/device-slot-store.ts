import { sha256 } from "./backup.js";
import {
  DeviceSlotCasError,
  encodeDeviceSlotEnvelope,
  strongDeviceSlotTag
} from "./device-slot-cas.js";
import { assertSlotHttp, matchesSlotMediaReceipt } from "./device-slot-http.js";
import type { DeviceSlotHttp, SlotLocation, SlotMediaMetadata } from "./device-slot-http.js";
import { deviceSlotKey, inspectDeviceSlots, parseDeviceSlotEnvelope } from "./device-slot-model.js";
import type {
  DeviceSlotCheckpoint,
  DeviceSlotEnvelope,
  DeviceSlotFile,
  DeviceSlotInspection,
  DeviceSlotScope,
  DeviceSlotWritePlan
} from "./device-slot-model.js";
import {
  decodeDeviceSlotPackage,
  encodeDeviceSlotPackage,
  readDeviceSlotPackageHeader
} from "./device-slot-package.js";
import type { DeviceSlotPackage, DeviceSlotPackageVersion } from "./device-slot-package.js";
import type { DriveReport } from "./progress.js";
import { DriveError } from "./types.js";

type SlotIo = Pick<DeviceSlotHttp, "read" | "list" | "reserve" | "create" | "patch">;
type Loaded = {
  readonly package: DeviceSlotPackage;
  readonly etag: string | null;
  readonly metadata: SlotMediaMetadata | undefined;
};
export interface DeviceSlotPendingWrite {
  readonly fileId: string;
  readonly key: string;
  readonly baseEtag: string | null;
  readonly envelope: DeviceSlotEnvelope;
}

const invalid = () => new DriveError("remote-invalid", "Некорректная версия слота Google Диска.");
const conflict = () => new DriveError("conflict", "Версии слота Google Диска изменились.");
const keyFor = ({ current }: DeviceSlotEnvelope) =>
  deviceSlotKey(current.workspaceId, current.deviceId);
const envelopeDigest = (envelope: DeviceSlotEnvelope) => sha256(encodeDeviceSlotEnvelope(envelope));

function unique(locations: readonly SlotLocation[]): void {
  if (
    new Set(locations.map(({ id }) => id)).size !== locations.length ||
    new Set(locations.map(({ key }) => key)).size !== locations.length
  )
    throw conflict();
}

async function load(
  io: SlotIo,
  id: string,
  signal: AbortSignal,
  receipt?: SlotMediaMetadata
): Promise<Loaded> {
  const { body, etag, metadata } = await io.read(id, signal, false, receipt);
  return { package: await decodeDeviceSlotPackage(body, signal), etag, metadata };
}

async function confirmed(
  io: SlotIo,
  pending: DeviceSlotPendingWrite,
  signal: AbortSignal,
  receipt?: SlotMediaMetadata
) {
  const fresh = await load(io, pending.fileId, signal, receipt);
  if (
    (receipt && (!fresh.metadata || !matchesSlotMediaReceipt(fresh.metadata, receipt))) ||
    (await envelopeDigest(fresh.package.envelope)) !== (await envelopeDigest(pending.envelope)) ||
    keyFor(fresh.package.envelope) !== pending.key ||
    (pending.baseEtag !== null && strongDeviceSlotTag(fresh.etag) === pending.baseEtag)
  )
    throw new DeviceSlotCasError("unconfirmed");
  signal.throwIfAborted();
  return fresh;
}

/** Shared by the binary diagnostic and real replacements. A raw 412 is never converted to success. */
export async function replacePackedDeviceSlot(
  io: SlotIo,
  pending: DeviceSlotPendingWrite,
  body: Blob,
  signal: AbortSignal
): Promise<Loaded | 412> {
  const etag = strongDeviceSlotTag(pending.baseEtag);
  signal.throwIfAborted();
  let response: Response | undefined;
  let receipt: SlotMediaMetadata | undefined;
  try {
    ({ response, receipt } = await io.patch(pending.fileId, etag, body, signal));
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DeviceSlotCasError) throw error;
    if (error instanceof DriveError && error.code !== "network") throw error;
  }
  signal.throwIfAborted();
  void response?.body?.cancel().catch(() => {});
  if (response?.status === 412) return 412;
  if (response && response.status !== 0 && response.status !== 408 && response.status < 500)
    assertSlotHttp(response);
  try {
    return await confirmed(io, pending, signal, receipt);
  } catch {
    signal.throwIfAborted();
    throw new DeviceSlotCasError("unconfirmed");
  }
}

export class DeviceSlotStore {
  private readonly genuine = new WeakMap<DeviceSlotInspection, ReadonlyMap<string, SlotLocation>>();
  constructor(
    private readonly io: SlotIo,
    private readonly verifiedUploadBudget: () => number = () => 0
  ) {}

  /** Inspect bounded headers without loading all image bodies from every client. */
  async inspect(
    scope: DeviceSlotScope | undefined,
    checkpoint: DeviceSlotCheckpoint | undefined,
    signal: AbortSignal,
    report?: DriveReport
  ): Promise<DeviceSlotInspection | null> {
    report?.("read-versions");
    const locations = await this.io.list(signal);
    unique(locations);
    if (locations.length > 1 && new Set(locations.map(({ key }) => key.slice(0, 36))).size > 1)
      throw conflict();
    const files: DeviceSlotFile[] = [];
    let transferredBytes = 0;
    for (const location of locations) {
      signal.throwIfAborted();
      const { body } = await this.io.read(location.id, signal, true);
      const header = await readDeviceSlotPackageHeader(body, location.size, signal);
      if (keyFor(header.envelope) !== location.key) throw invalid();
      files.push({
        fileId: location.id,
        envelopeHash: header.envelopeHash,
        envelope: header.envelope
      });
      transferredBytes += body.size;
      report?.("read-versions", {
        listedVersions: locations.length,
        transfer: { completedFiles: files.length, totalFiles: locations.length, transferredBytes }
      });
    }
    if (!scope) {
      const first = files[0]?.envelope.current;
      if (!first) return null;
      scope = { workspaceId: first.workspaceId, legacyArchive: first.legacyArchive };
    }
    const snapshot = inspectDeviceSlots(files, scope, checkpoint);
    this.genuine.set(snapshot, new Map(locations.map((item) => [item.id, item])));
    return snapshot;
  }

  async download(
    snapshot: DeviceSlotInspection,
    revisionId: string,
    signal: AbortSignal,
    report?: DriveReport
  ): Promise<DeviceSlotPackageVersion> {
    const file = snapshot.files.find(
      ({ envelope }) =>
        envelope.current.revisionId === revisionId || envelope.previous?.revisionId === revisionId
    );
    if (!file) throw invalid();
    const loaded = await this.loadPinned(snapshot, file, signal, report);
    if (loaded.package.envelope.current.revisionId === revisionId) return loaded.package.current;
    if (loaded.package.previous) return loaded.package.previous;
    throw invalid();
  }

  private async loadPinned(
    snapshot: DeviceSlotInspection,
    file: DeviceSlotFile,
    signal: AbortSignal,
    report?: DriveReport
  ) {
    const location = this.genuine.get(snapshot)?.get(file.fileId);
    if (!location) throw invalid();
    report?.("download", { transfer: { completedFiles: 0, totalFiles: 1, transferredBytes: 0 } });
    const loaded = await load(this.io, file.fileId, signal);
    if (
      (await envelopeDigest(loaded.package.envelope)) !== file.envelopeHash ||
      keyFor(loaded.package.envelope) !== location.key
    )
      throw conflict();
    report?.("download", {
      transfer: { completedFiles: 1, totalFiles: 1, transferredBytes: location.size }
    });
    return loaded;
  }

  async write(
    snapshot: DeviceSlotInspection,
    plan: DeviceSlotWritePlan,
    current: DeviceSlotPackageVersion,
    onPending: (pending: DeviceSlotPendingWrite) => Promise<void>,
    signal: AbortSignal,
    report?: DriveReport
  ): Promise<DeviceSlotInspection> {
    const max = this.verifiedUploadBudget();
    if (max <= 0) throw new DeviceSlotCasError("probe");
    if (!this.genuine.has(snapshot)) throw invalid();
    const { workspaceId, legacyArchive } = snapshot;
    const envelope = parseDeviceSlotEnvelope(plan.envelope);
    if (
      envelope.current.workspaceId !== workspaceId ||
      envelope.current.legacyArchive !== legacyArchive ||
      keyFor(envelope) !== plan.key
    )
      throw invalid();
    // Recheck all heads before the operation. The subsequent CAS fences the physical target.
    const latest = await this.inspect(
      { workspaceId, legacyArchive },
      snapshot.checkpoint,
      signal,
      report
    );
    if (!latest || JSON.stringify(latest.checkpoint) !== JSON.stringify(snapshot.checkpoint))
      throw conflict();
    let previous: DeviceSlotPackageVersion | null = null;
    let baseEtag: string | null = null;
    let id: string | undefined;
    if (plan.kind === "replace") {
      const file = snapshot.files.find(({ fileId }) => fileId === plan.expected.fileId);
      if (!file || file.envelopeHash !== plan.expected.envelopeHash) throw conflict();
      const loaded = await this.loadPinned(snapshot, file, signal, report);
      if (JSON.stringify(envelope.previous) !== JSON.stringify(loaded.package.envelope.current))
        throw conflict();
      previous = loaded.package.current;
      baseEtag = strongDeviceSlotTag(loaded.etag);
      id = file.fileId;
    }
    report?.("prepare-upload");
    const bytes = encodeDeviceSlotPackage(envelope, current, previous);
    if (bytes.size > max)
      throw new DriveError("limit", "Размер версии превышает проверенный размер загрузки.");
    const pending = {
      fileId: id ?? (await this.io.reserve(signal)),
      key: plan.key,
      baseEtag,
      envelope
    };
    await onPending(pending);
    signal.throwIfAborted();
    report?.("upload", { transfer: { completedFiles: 0, totalFiles: 1, transferredBytes: 0 } });
    if (pending.baseEtag === null) {
      await this.io.create(pending.fileId, pending.key, bytes, signal);
      await confirmed(this.io, pending, signal);
    } else if ((await replacePackedDeviceSlot(this.io, pending, bytes, signal)) === 412)
      throw conflict();
    report?.("confirm", {
      transfer: { completedFiles: 1, totalFiles: 1, transferredBytes: bytes.size }
    });
    const after = await this.inspect(
      { workspaceId, legacyArchive },
      snapshot.checkpoint,
      signal,
      report
    );
    const digest = await envelopeDigest(envelope);
    if (
      !after?.files.some((file) => file.fileId === pending.fileId && file.envelopeHash === digest)
    )
      throw new DeviceSlotCasError("unconfirmed");
    return after;
  }

  async reconcile(pending: DeviceSlotPendingWrite, signal: AbortSignal) {
    const intended = parseDeviceSlotEnvelope(pending.envelope);
    if (keyFor(intended) !== pending.key) throw invalid();
    const { workspaceId, legacyArchive } = intended.current;
    const inspection = await this.inspect({ workspaceId, legacyArchive }, undefined, signal);
    const file = inspection?.files.find((candidate) => candidate.fileId === pending.fileId);
    if (!file || !inspection) return "unknown" as const;
    const loaded = await this.loadPinned(inspection, file, signal);
    if (
      pending.baseEtag !== null &&
      strongDeviceSlotTag(loaded.etag) === strongDeviceSlotTag(pending.baseEtag)
    )
      return "unknown" as const;
    const { current, previous } = loaded.package.envelope;
    const wanted = intended.current;
    if (current.seq === wanted.seq) {
      if (current.revisionId !== wanted.revisionId) return "conflict" as const;
      if ((await envelopeDigest(loaded.package.envelope)) !== (await envelopeDigest(intended)))
        throw invalid();
      return "committed" as const;
    }
    if (previous?.seq === wanted.seq) {
      if (previous.revisionId !== wanted.revisionId) return "conflict" as const;
      if (JSON.stringify(previous) !== JSON.stringify(wanted)) throw invalid();
      return "committed" as const;
    }
    return "unknown" as const;
  }
}
