import { DeviceSlotHttp } from "./device-slot-http.js";
import { DeviceSlotStore } from "./device-slot-store.js";
import { loadDriveDeviceId } from "./device-slot-identity.js";
import {
  googleSlotFence,
  loadGoogleSlotTarget,
  matchesGoogleSlotCredential
} from "./device-slot-link.js";
import type { GoogleSlotScope } from "./device-slot-context.js";
import type { GoogleSlotDependencies } from "./device-slot-operation.js";
import { LegacyCompaction } from "./legacy-compaction.js";
import { LegacyCompactionHttp } from "./legacy-raw-archive-io.js";
import {
  legacyCompactionJournal,
  listPendingLegacyCompactions,
  hasPendingLegacyCompaction
} from "./legacy-compaction-storage.js";
import { deleteProbeJournal } from "./legacy-raw-archive-probe-journal.js";
import {
  discoverVerifiedLegacyArchives,
  discoverVerifiedLegacyCompactionRecords,
  loadVerifiedLegacyArchive
} from "./legacy-compaction-discovery.js";
import {
  assertGoogleLegacyArchiveReaderReady,
  verifySelectedGoogleV3
} from "./legacy-compaction-google-reader.js";
import { operationError } from "./device-slot-status.js";
import type { GoogleStatus } from "./device-slot-status.js";
import { capabilityAccountKey } from "./write-capability-identity.js";
import { DRIVE_CLIENT_ID, DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
import { createLegacyArchiveOverlay } from "./legacy-archive-overlay.js";
import { DriveTransport } from "./transport.js";
import { DriveSync } from "./sync.js";
import type { LegacyLateInspection } from "./legacy-compaction-types.js";

export interface GoogleLegacyJob {
  authorization: DriveAuthorization;
  scope: GoogleSlotScope;
  dependencies: GoogleSlotDependencies;
  signal: AbortSignal;
  current(this: void): boolean;
  reset(this: void, enabled?: boolean): void;
  update(this: void, patch: Partial<GoogleStatus>): void;
  status?(this: void): GoogleStatus;
  finish(this: void): void;
}

async function session(job: GoogleLegacyJob) {
  const checkCurrent = () => {
    job.signal.throwIfAborted();
    if (!job.current()) throw new DOMException("Google maintenance ended.", "AbortError");
  };
  checkCurrent();
  const target = await loadGoogleSlotTarget(job.scope, job.dependencies);
  checkCurrent();
  if (
    target.enabled === false ||
    !matchesGoogleSlotCredential(job.scope, target.record, job.authorization)
  )
    throw new DOMException("The Google maintenance account changed.", "AbortError");
  const fence = googleSlotFence(target, job.dependencies, job.signal, job.current, job.reset);
  const check = async () => {
    checkCurrent();
    await fence.check();
    checkCurrent();
  };
  await check();
  const fetcher = fence.guardFetch(job.dependencies.fetch);
  const io = new LegacyCompactionHttp(job.authorization, {
    fetch: fetcher,
    check,
    probeJournal: {
      read: () => deleteProbeJournal.read(),
      change: (edit, signal) => fence.effect(() => deleteProbeJournal.change(edit, signal))
    }
  });
  const store = new DeviceSlotStore(new DeviceSlotHttp(job.authorization, fetcher), () => 0);
  const record = target.record;
  const workspace = async () => {
    await check();
    const workspaceId =
      record.scope?.workspaceId ??
      (await store.inspect(undefined, undefined, job.signal))?.workspaceId;
    await check();
    if (!workspaceId) throw new DriveError("not-ready", "Сначала выберите версию Google Диска.");
    return workspaceId;
  };
  const discovery = {
    listCompactionRecords: (signal: AbortSignal) => io.listRetention("compaction", signal),
    readVerified: io.readVerified.bind(io)
  };
  return { io, store, record, check, fence, fetcher, workspace, discovery };
}

/** Owns a separate exclusive maintenance job; a failed cleanup never reverses a successful sync. */
export async function runGoogleLegacyAction<T>(
  take: () => GoogleLegacyJob | undefined,
  action: (job: GoogleLegacyJob) => Promise<T>
): Promise<T | undefined> {
  const job = take();
  if (!job) return;
  try {
    return await action(job);
  } catch (error) {
    if (job.current())
      job.update({
        compaction: { ...job.status?.().compaction, phase: "paused", error: operationError(error) }
      });
  } finally {
    job.finish();
  }
}

export async function compactGoogleLegacy(job: GoogleLegacyJob, allowDelta = true): Promise<void> {
  const s = await session(job);
  // Empty accounts do not allocate IDs, run upload/delete probes, or create cloud artifacts.
  const candidates = await s.io.listLegacy(job.signal);
  await s.check();
  const empty = () =>
    job.update({
      compaction: {
        phase: "complete",
        fileCount: 0,
        bytes: 0,
        archivedFiles: 0,
        deletedFiles: 0,
        changedFiles: 0,
        pendingFiles: 0
      }
    });
  if (!s.record.scope || s.record.pending) {
    if (candidates.length)
      throw new DriveError("not-ready", "Сначала подтвердите новую версию Google Диска.");
    empty();
    return;
  }
  const workspaceId = s.record.scope.workspaceId;
  if (!candidates.length && !(await hasPendingLegacyCompaction(workspaceId))) {
    empty();
    return;
  }
  const publicClientId = await s.fence.effect(() => loadDriveDeviceId(workspaceId, s.record.mode));
  const accountKey = await capabilityAccountKey(job.authorization, s.fetcher, job.signal);
  if (!accountKey)
    throw new DriveError("not-ready", "Не удалось подтвердить аккаунт архива Google.");
  await s.check();
  const binding = { accountKey, clientId: DRIVE_CLIENT_ID, workspaceId, publicClientId } as const;
  const pending = await listPendingLegacyCompactions(binding);
  await s.check();
  if (!candidates.length && !pending.length) {
    empty();
    return;
  }
  job.update({ compaction: { phase: "checking" } });
  const recoveryScope = { workspaceId, checkIdentity: s.check };
  const prior = await discoverVerifiedLegacyArchives(s.discovery, recoveryScope, job.signal);
  if (!allowDelta && !pending.length && prior.length) {
    const identity = (file: (typeof candidates)[number]) =>
      JSON.stringify([
        file.fileId,
        file.namespace,
        file.kind,
        file.key,
        file.version,
        file.size,
        Object.entries(file.appProperties).sort(([a], [b]) => a.localeCompare(b))
      ]);
    const baseline = new Set(prior.flatMap(({ archive }) => archive.index.files.map(identity)));
    const unknown = candidates.filter((file) => !baseline.has(identity(file)));
    if (unknown.length) {
      job.update({
        compaction: {
          phase: "paused",
          error: "conflict",
          fileCount: unknown.length,
          bytes: unknown.reduce((total, file) => total + file.size, 0),
          archivedFiles: 0,
          deletedFiles: 0,
          changedFiles: 0,
          pendingFiles: unknown.length
        }
      });
      await inspectGoogleLateLegacy(job);
      return;
    }
  }
  const service = new LegacyCompaction(
    s.io,
    {
      binding,
      checkIdentity: s.check,
      verifyCurrentV3: (expected, signal) =>
        verifySelectedGoogleV3(s.store, s.record, signal, s.check, expected),
      assertArchiveReaderReady: async (archive, record, signal) => {
        // Discovery validates the installed cloud reader path and immutable record, not just RAM bytes.
        const discovered = await discoverVerifiedLegacyArchives(s.discovery, recoveryScope, signal);
        if (
          !discovered.some(
            (item) =>
              item.record.archive.fileId === record.archive.fileId &&
              item.archive.sha256 === archive.sha256 &&
              item.record.inventoryDigest === record.inventoryDigest
          )
        )
          throw new DriveError("remote-invalid", "Архив не обнаружен облачным reader.");
        await assertGoogleLegacyArchiveReaderReady(
          job.authorization,
          s.fetcher,
          discovered.map((item) => item.archive),
          signal,
          s.check
        );
      }
    },
    {
      read: (id) => legacyCompactionJournal.read(id),
      save: (entry, signal) => s.fence.effect(() => legacyCompactionJournal.save(entry, signal))
    }
  );
  const report = (progress: Parameters<NonNullable<Parameters<typeof service.execute>[2]>>[0]) => {
    if (job.current())
      job.update({
        compaction: {
          ...progress,
          phase: progress.phase === "complete" && progress.pendingFiles ? "paused" : progress.phase
        }
      });
  };
  if (pending.length) {
    for (const operationId of pending) await service.resume(operationId, job.signal, report);
  } else {
    const preview = await service.preview(
      {
        operationId: crypto.randomUUID(),
        workspaceId,
        publicClientId,
        createdAt: new Date().toISOString()
      },
      job.signal
    );
    await service.execute(preview, job.signal, report);
  }
  await s.check();
  const records = await discoverVerifiedLegacyCompactionRecords(
    s.discovery,
    recoveryScope,
    job.signal
  );
  job.update({
    legacyArchives: records.map(({ record, recordReceipt }) => ({
      id: recordReceipt.fileId,
      createdAt: record.createdAt,
      bytes: record.archive.size,
      ...(prior.find((item) => item.record.archive.fileId === record.archive.fileId)
        ? {
            fileCount: prior.find((item) => item.record.archive.fileId === record.archive.fileId)!
              .archive.index.files.length
          }
        : {})
    }))
  });
  await inspectGoogleLateLegacy(job);
}

export async function inspectGoogleLegacyArchives(job: GoogleLegacyJob): Promise<void> {
  const s = await session(job);
  const records = await discoverVerifiedLegacyCompactionRecords(
    s.discovery,
    { workspaceId: await s.workspace(), checkIdentity: s.check },
    job.signal
  );
  await s.check();
  job.update({
    legacyArchives: records.map(({ record, recordReceipt }) => ({
      id: recordReceipt.fileId,
      createdAt: record.createdAt,
      bytes: record.archive.size
    }))
  });
}

export async function downloadGoogleLegacyArchive(
  job: GoogleLegacyJob,
  id: string
): Promise<Blob | undefined> {
  const s = await session(job),
    workspaceId = await s.workspace();
  const scope = { workspaceId, checkIdentity: s.check };
  const records = await discoverVerifiedLegacyCompactionRecords(s.discovery, scope, job.signal);
  const selected = records.find(({ recordReceipt }) => recordReceipt.fileId === id);
  if (!selected) throw new DriveError("conflict", "Выбранный архив недоступен.");
  const loaded = await loadVerifiedLegacyArchive(s.discovery, scope, selected, job.signal);
  await s.check();
  return loaded.archive.body;
}

export async function probeGoogleLegacyDelete(job: GoogleLegacyJob) {
  const s = await session(job);
  await s.io.runDeleteProbe(job.signal);
  await s.check();
  return { verified: true as const, pendingProbeIds: [...s.io.pendingProbeIds] };
}

export type GoogleLateLegacyInspection = LegacyLateInspection;

/** Read-only late-write review retains v3 and recovers deleted legacy dependencies through archives. */
export async function inspectGoogleLateLegacy(
  job: GoogleLegacyJob
): Promise<readonly GoogleLateLegacyInspection[]> {
  const s = await session(job),
    workspaceId = await s.workspace();
  const records = await discoverVerifiedLegacyArchives(
    s.discovery,
    { workspaceId, checkIdentity: s.check },
    job.signal
  );
  const result: GoogleLateLegacyInspection[] = [];
  for (const namespace of ["mtp-drive-v1", "mtp-drive-v2"] as const) {
    const overlay = await createLegacyArchiveOverlay(
      new DriveTransport(job.authorization, { fetch: s.fetcher, namespace }),
      namespace,
      records.map(({ archive }) => archive)
    );
    const late = await overlay.listLateLegacySnapshots();
    if (!late.length) continue;
    const sync = new DriveSync(overlay, namespace),
      inspection = await sync.inspect();
    await sync.validateHeads(inspection);
    await s.check();
    result.push(
      Object.freeze({
        namespace,
        snapshotIds: Object.freeze([
          ...new Set(late.map(({ appProperties }) => appProperties.mtpKey!))
        ]),
        headIds: Object.freeze([...inspection.heads])
      })
    );
  }
  await s.check();
  job.update({ legacyLateChanges: Object.freeze(result) });
  return Object.freeze(result);
}
