import type { Backup } from "../../model/types.js";
import { driveBackupDigest, prepareDriveBackup } from "./backup.js";
import type { PreparedBackup } from "./backup.js";
import { summarize } from "./coordinator-types.js";
import type { DriveConflict } from "./coordinator-types.js";
import { loadDriveDeviceId } from "./device-slot-identity.js";
import type { DeviceSlotRecord } from "./device-slot-local.js";
import { planDeviceSlotWrite } from "./device-slot-model.js";
import type { DeviceRevision, DeviceSlotInspection } from "./device-slot-model.js";
import { prepareDeviceSlotVersion, restoreDeviceSlotVersion } from "./device-slot-package.js";
import type { DeviceSlotPackageVersion } from "./device-slot-package.js";
import type { DeviceSlotStore } from "./device-slot-store.js";
import type { DriveReport } from "./progress.js";
import { DriveError } from "./types.js";

export interface SlotCapture {
  readonly backup: Backup;
  readonly digest: string;
  readonly revision: number;
  readonly prepared: { payload: Blob; images: readonly PreparedBackup["images"][number][] };
}
export interface SlotSyncContext {
  readonly store: DeviceSlotStore;
  readonly signal: AbortSignal;
  readonly capture: SlotCapture;
  readonly report: DriveReport;
  noteApplyRevision(revision: number): void;
  check(): void;
  checkIdentity(): void;
  legacyAvailable(): Promise<boolean>;
  apply(
    backup: Backup,
    expectedRevision: number,
    onCommitted: (accepted: number) => void
  ): Promise<void>;
  save(record: DeviceSlotRecord, patch: Partial<DeviceSlotRecord>): Promise<DeviceSlotRecord>;
}
export interface SlotPreview {
  readonly snapshot: DeviceSlotInspection;
  readonly conflict: DriveConflict;
  readonly revision: number;
  readonly generation: number;
}
export type SlotSyncResult =
  | {
      readonly state: "idle";
      readonly record: DeviceSlotRecord;
      readonly snapshot?: DeviceSlotInspection;
    }
  | { readonly state: "choice"; readonly record: DeviceSlotRecord; readonly preview: SlotPreview }
  | { readonly state: "migration" | "pending"; readonly record: DeviceSlotRecord };
export type SlotSelection = { kind: "local" } | { kind: "remote" | "previous"; id: string };

const changed = () => new DriveError("conflict", "Версии Google Диска изменились.");
const same = (left: readonly string[], right: readonly DeviceRevision[]) =>
  [...left].sort().join(",") ===
  right
    .map((entry) => entry.revisionId)
    .sort()
    .join(",");
const scope = ({ workspaceId, legacyArchive }: DeviceSlotInspection) => ({
  workspaceId,
  legacyArchive
});

async function assertPinned(context: SlotSyncContext, snapshot: DeviceSlotInspection) {
  context.report("confirm");
  const after = await context.store.inspect(scope(snapshot), snapshot.checkpoint, context.signal);
  context.check();
  if (!after || JSON.stringify(snapshot.checkpoint) !== JSON.stringify(after.checkpoint))
    throw changed();
  return after;
}

async function accept(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  snapshot: DeviceSlotInspection,
  digest: string,
  heads = snapshot.heads.map((head) => head.revisionId)
) {
  context.checkIdentity();
  context.report("save-status");
  return context.save(record, {
    scope: scope(snapshot),
    checkpoint: snapshot.checkpoint,
    baseHeads: heads,
    digest,
    lastSyncedAt: new Date().toISOString(),
    pending: undefined
  });
}

async function resolveRecord(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  snapshot: DeviceSlotInspection
) {
  const pending = record.pending;
  if (!pending) return record;
  const state = await context.store.reconcile(pending.write, context.signal);
  context.check();
  if (state === "unknown") return undefined;
  if (state === "conflict") {
    return context.save(record, { pending: undefined });
  }
  return accept(context, record, snapshot, pending.digest, [
    pending.write.envelope.current.revisionId
  ]);
}

async function previewFor(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  snapshot: DeviceSlotInspection
): Promise<SlotPreview> {
  if (snapshot.heads.length > 8)
    throw new DriveError("limit", "Слишком много конфликтующих версий.");
  const remotes: DriveConflict["remotes"] = [];
  for (const head of snapshot.heads) {
    const version = await context.store.download(
      snapshot,
      head.revisionId,
      context.signal,
      context.report
    );
    const backup = await restoreDeviceSlotVersion(version, context.signal);
    context.check();
    remotes.push({ ...summarize(backup), nodeId: head.revisionId });
  }
  await assertPinned(context, snapshot);
  return {
    snapshot,
    conflict: { local: summarize(context.capture.backup), remotes },
    revision: context.capture.revision,
    generation: record.generation
  };
}

async function publish(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  snapshot: DeviceSlotInspection,
  version: DeviceSlotPackageVersion,
  digest: string,
  selection?: "local" | DeviceRevision
) {
  context.check();
  const deviceId = await loadDriveDeviceId(snapshot.workspaceId, record.mode);
  context.check();
  const common = {
    deviceId,
    revisionId: crypto.randomUUID(),
    payload: version.reference,
    expected: snapshot.checkpoint.observed.find((entry) => entry.deviceId === deviceId) ?? null
  };
  const plan = planDeviceSlotWrite(
    snapshot,
    selection === undefined
      ? { ...common, mode: "publish", basedOn: snapshot.heads }
      : { ...common, mode: "resolve", confirmedHeads: snapshot.heads, chosen: selection }
  );
  const after = await context.store.write(
    snapshot,
    plan,
    version,
    async (write) => {
      context.check();
      record = await context.save(record, { scope: scope(snapshot), pending: { write, digest } });
      context.check();
    },
    context.signal,
    context.report
  );
  context.check();
  return { record, snapshot: after, revisionId: common.revisionId };
}

async function applyVersion(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  snapshot: DeviceSlotInspection,
  backup: Backup,
  digest: string
) {
  if (context.capture.digest === digest) return accept(context, record, snapshot, digest);
  let committed: Promise<DeviceSlotRecord> | undefined;
  context.report("apply");
  try {
    await context.apply(backup, context.capture.revision, (revision) => {
      context.noteApplyRevision(revision);
      // The native writer committed even if the following UI recovery fails.
      committed = accept(context, record, snapshot, digest);
      void committed.catch(() => {});
    });
  } catch (error) {
    if (committed) await committed;
    throw error instanceof Error ? error : new DriveError("local-save", "Import recovery failed.");
  }
  if (!committed) throw new DriveError("local-save", "Импорт Google Диска не подтверждён.");
  return committed;
}

async function finishPublish(
  context: SlotSyncContext,
  written: Awaited<ReturnType<typeof publish>>,
  digest: string,
  remote?: Backup
): Promise<SlotSyncResult> {
  const { record, snapshot, revisionId } = written;
  if (snapshot.heads.length !== 1 || snapshot.heads[0]?.revisionId !== revisionId) {
    // The physical CAS committed only our slot. A peer may already have advanced another head.
    const confirmed = await accept(context, record, snapshot, digest, [revisionId]);
    return {
      state: "choice",
      record: confirmed,
      preview: await previewFor(context, confirmed, snapshot)
    };
  }
  return {
    state: "idle",
    snapshot,
    record: remote
      ? await applyVersion(context, record, snapshot, remote, digest)
      : await accept(context, record, snapshot, digest)
  };
}

export async function synchronizeDeviceSlots(
  context: SlotSyncContext,
  record: DeviceSlotRecord
): Promise<SlotSyncResult> {
  context.check();
  let snapshot = await context.store.inspect(
    record.scope,
    record.checkpoint,
    context.signal,
    context.report
  );
  context.check();
  if (record.pending) {
    if (!snapshot) return { state: "pending", record };
    const recovered = await resolveRecord(context, record, snapshot);
    if (!recovered) return { state: "pending", record };
    record = recovered;
    // Committed recovery can race a newer head.
    snapshot = await context.store.inspect(
      record.scope,
      record.checkpoint,
      context.signal,
      context.report
    );
    context.check();
  }
  if (!snapshot || !snapshot.heads.length) {
    if (record.scope && record.baseHeads.length) throw changed();
    if (await context.legacyAvailable()) return { state: "migration", record };
    context.check();
    snapshot = await context.store.inspect(
      record.scope ?? { workspaceId: crypto.randomUUID(), legacyArchive: null },
      record.checkpoint,
      context.signal
    );
    if (!snapshot || snapshot.heads.length) throw changed();
  }

  const sameHeads = same(record.baseHeads, snapshot.heads);
  const localSame = context.capture.digest === record.digest;
  if (
    snapshot.heads.length > 1 ||
    (snapshot.heads.length && !sameHeads && (!record.scope || !localSame))
  ) {
    return { state: "choice", record, preview: await previewFor(context, record, snapshot) };
  }
  const head = snapshot.heads[0];
  if (head && !sameHeads) {
    const version = await context.store.download(
      snapshot,
      head.revisionId,
      context.signal,
      context.report
    );
    const backup = await restoreDeviceSlotVersion(version, context.signal);
    const digest = await driveBackupDigest(backup);
    await assertPinned(context, snapshot);
    return {
      state: "idle",
      record: await applyVersion(context, record, snapshot, backup, digest),
      snapshot
    };
  }
  if (head && localSame) {
    // The selected version still has to be readable before a successful sync acknowledgement.
    await context.store.download(snapshot, head.revisionId, context.signal, context.report);
    await assertPinned(context, snapshot);
    return {
      state: "idle",
      record: await accept(context, record, snapshot, context.capture.digest),
      snapshot
    };
  }
  context.report("prepare-upload");
  const version = await prepareDeviceSlotVersion(context.capture.prepared, context.signal);
  const written = await publish(context, record, snapshot, version, context.capture.digest);
  return finishPublish(context, written, context.capture.digest);
}

export async function chooseDeviceSlotVersion(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  preview: SlotPreview,
  selection: SlotSelection
): Promise<SlotSyncResult> {
  if (
    record.pending ||
    record.generation !== preview.generation ||
    context.capture.revision !== preview.revision
  )
    throw changed();
  const snapshot = await assertPinned(context, preview.snapshot);
  if (selection.kind === "local") {
    const version = await prepareDeviceSlotVersion(context.capture.prepared, context.signal);
    const written = await publish(
      context,
      record,
      snapshot,
      version,
      context.capture.digest,
      "local"
    );
    return finishPublish(context, written, context.capture.digest);
  }
  const head = snapshot.heads.find((entry) => entry.revisionId === selection.id);
  if (selection.kind === "remote" && !head) throw changed();
  if (
    selection.kind === "previous" &&
    (!snapshot.files.some(({ envelope }) => envelope.previous?.revisionId === selection.id) ||
      snapshot.heads.length > 1)
  )
    throw changed();
  const version = await context.store.download(
    snapshot,
    selection.id,
    context.signal,
    context.report
  );
  const backup = await restoreDeviceSlotVersion(version, context.signal);
  const digest = await driveBackupDigest(backup);
  await assertPinned(context, snapshot);
  if (selection.kind === "previous" || snapshot.heads.length > 1) {
    const written = await publish(context, record, snapshot, version, digest, head);
    return finishPublish(context, written, digest, backup);
  }
  return {
    state: "idle",
    record: await applyVersion(context, record, snapshot, backup, digest),
    snapshot
  };
}

export async function restorePreviousDeviceSlotVersion(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  revisionId: string
) {
  const snapshot = await context.store.inspect(
    record.scope,
    record.checkpoint,
    context.signal,
    context.report
  );
  context.check();
  if (
    !snapshot ||
    snapshot.heads.length !== 1 ||
    !same(record.baseHeads, snapshot.heads) ||
    record.digest !== context.capture.digest
  )
    throw changed();
  return chooseDeviceSlotVersion(
    context,
    record,
    {
      snapshot,
      conflict: { local: summarize(context.capture.backup), remotes: [] },
      generation: record.generation,
      revision: context.capture.revision
    },
    { kind: "previous", id: revisionId }
  );
}

export async function publishLegacyDeviceSlot(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  archiveDigest: string,
  selected: Backup | undefined
): Promise<SlotSyncResult> {
  if (record.pending || record.scope) throw changed();
  const scoped = await context.store.inspect(
    { workspaceId: crypto.randomUUID(), legacyArchive: archiveDigest },
    undefined,
    context.signal
  );
  context.check();
  if (!scoped || scoped.heads.length) throw changed();
  context.report("prepare-upload");
  const version = await prepareDeviceSlotVersion(
    selected ? await prepareDriveBackup(selected) : context.capture.prepared,
    context.signal
  );
  const digest = selected ? await driveBackupDigest(selected) : context.capture.digest;
  const written = await publish(context, record, scoped, version, digest);
  return finishPublish(context, written, digest, selected);
}
