import { restoreDeviceSlotVersion } from "./device-slot-package.js";
import type { DeviceSlotRecord } from "./device-slot-local.js";
import type { DeviceSlotStore } from "./device-slot-store.js";
import { createLegacyArchiveOverlay } from "./legacy-archive-overlay.js";
import type { LegacyArchiveInput } from "./legacy-archive-overlay.js";
import type { CompactionV3 } from "./legacy-compaction-types.js";
import { DriveSync } from "./sync.js";
import { DriveTransport } from "./transport.js";
import { DRIVE_NAMESPACE, DriveError, LEGACY_DRIVE_NAMESPACE } from "./types.js";
import type { DriveAuthorization, DriveStore } from "./types.js";

const conflict = () =>
  new DriveError("conflict", "Confirm the current Google version before cleanup.");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Check = () => Promise<void>;

/** Full chosen-v3 proof. Reading a newer peer head never acknowledges that head for this device. */
export async function verifySelectedGoogleV3(
  store: DeviceSlotStore,
  record: DeviceSlotRecord,
  signal: AbortSignal,
  check: Check,
  expected?: CompactionV3
): Promise<CompactionV3> {
  await check();
  signal.throwIfAborted();
  if (!record.scope || record.pending || record.baseHeads.length !== 1) throw conflict();
  const snapshot = await store.inspect(record.scope, record.checkpoint, signal);
  if (
    !snapshot ||
    snapshot.heads.length !== 1 ||
    snapshot.heads[0]?.revisionId !== record.baseHeads[0]
  )
    throw conflict();
  const revisionId = record.baseHeads[0];
  const file = snapshot.files.find(({ envelope }) => envelope.current.revisionId === revisionId);
  if (!file || !revisionId) throw conflict();
  const current = { fileId: file.fileId, revisionId, envelopeHash: file.envelopeHash };
  if (expected && !same(current, expected)) throw conflict();
  const version = await store.download(snapshot, revisionId, signal);
  await restoreDeviceSlotVersion(version, signal);
  await check();
  signal.throwIfAborted();
  const after = await store.inspect(record.scope, snapshot.checkpoint, signal);
  if (!after || !same(after.checkpoint, snapshot.checkpoint)) throw conflict();
  await check();
  signal.throwIfAborted();
  return Object.freeze(current);
}

const archiveOnly: DriveStore = {
  list() {
    return Promise.resolve([]);
  },
  read() {
    return Promise.reject(new DriveError("remote-invalid", "No physical archive fallback."));
  },
  create() {
    return Promise.reject(new DriveError("permission", "Archive recovery is read-only."));
  }
};

/** Proves both complete baseline recovery without physical sources and the live late-head overlay. */
export async function assertGoogleLegacyArchiveReaderReady(
  authorization: DriveAuthorization,
  fetcher: typeof fetch,
  archives: readonly LegacyArchiveInput[],
  signal: AbortSignal,
  check: Check
): Promise<void> {
  if (!archives.length) throw new DriveError("not-ready", "No verified raw archive is installed.");
  for (const namespace of [LEGACY_DRIVE_NAMESPACE, DRIVE_NAMESPACE] as const) {
    await check();
    signal.throwIfAborted();
    const archived = new DriveSync(
      await createLegacyArchiveOverlay(archiveOnly, namespace, archives),
      namespace
    );
    const baseline = await archived.inspect();
    if (baseline.snapshots.length) {
      await archived.visitArchiveSnapshots(
        baseline,
        [...new Set(baseline.snapshots.map(({ manifest }) => manifest.nodeId))],
        async () => {
          await check();
          signal.throwIfAborted();
        },
        signal
      );
    }
    const live = new DriveTransport(authorization, { fetch: fetcher, namespace });
    const overlay = await createLegacyArchiveOverlay(live, namespace, archives);
    const sync = new DriveSync(overlay, namespace);
    const inspection = await sync.inspect();
    await sync.validateHeads(inspection);
    const late = await overlay.listLateLegacySnapshots();
    if (late.length) {
      const lateIds = new Set(late.map(({ appProperties }) => appProperties.mtpKey));
      const heads = inspection.heads.filter((id) => lateIds.has(id));
      if (heads.length)
        await sync.visitArchiveSnapshots(
          inspection,
          heads,
          async () => {
            await check();
            signal.throwIfAborted();
          },
          signal
        );
    }
    await check();
    signal.throwIfAborted();
  }
}
