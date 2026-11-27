import type { Backup } from "../../model/types.js";
import { driveBackupDigest } from "./backup.js";
import { summarize } from "./coordinator-types.js";
import type { DeviceSlotRecord } from "./device-slot-local.js";
import { restoreDeviceSlotVersion } from "./device-slot-package.js";
import { applyVersion, assertPinned, previewFor } from "./device-slot-sync.js";
import type { SlotPreview, SlotSyncContext, SlotSyncResult } from "./device-slot-sync.js";
import { DriveError } from "./types.js";
import { googleSlotPublication } from "./device-slot-status.js";
import type { GoogleStatus } from "./device-slot-status.js";
import type { LegacyDeviceSlotMigration } from "./device-slot-migration.js";

const stale = () => new DriveError("conflict", "Проверьте версии Google Диска повторно.");
/** Both previews share the same account and local-intent invalidation boundary. */
export class GoogleSlotPreviews {
  choice: SlotPreview | undefined;
  comparison: SlotPreview | undefined;
  clear() {
    this.choice = undefined;
    this.comparison = undefined;
  }
  update(result: { preview: SlotPreview | undefined; comparisonPreview: SlotPreview | undefined }) {
    this.choice = result.preview;
    this.comparison = result.comparisonPreview;
  }
  publish(
    result: SlotSyncResult,
    status: GoogleStatus,
    migration: LegacyDeviceSlotMigration,
    local: Backup,
    changed: boolean
  ) {
    const publication = googleSlotPublication(
      result,
      status,
      this.choice,
      migration.current,
      migration.choices,
      local,
      changed
    );
    this.update(publication);
    return publication;
  }
}
export const receiveGoogleSlotSelection =
  (
    preview: SlotPreview,
    previews: GoogleSlotPreviews,
    id: string,
    received: (backup: Backup) => void
  ) =>
  (context: SlotSyncContext, record: DeviceSlotRecord) =>
    receiveDeviceSlotVersion(context, record, preview, id, (backup) => {
      previews.clear();
      received(backup);
    });
function validatePreview(context: SlotSyncContext, record: DeviceSlotRecord, preview: SlotPreview) {
  context.check();
  if (
    record.pending ||
    record.generation !== preview.generation ||
    context.capture.revision !== preview.revision
  )
    throw stale();
}

/** Inspection reads checked packages, without acknowledging, reconciling or writing any version. */
export async function inspectDeviceSlotVersions(
  context: SlotSyncContext,
  record: DeviceSlotRecord
): Promise<SlotSyncResult> {
  context.check();
  if (record.pending)
    throw new DriveError("not-ready", "Сначала подтвердите предыдущую передачу Google Диска.");
  let snapshot = await context.store.inspect(
    record.scope,
    record.checkpoint,
    context.signal,
    context.report
  );
  context.check();
  const discoveryEmpty = !snapshot || !snapshot.heads.length;
  if (
    discoveryEmpty &&
    !record.scope &&
    (await (context.legacyPresent?.() ?? context.legacyAvailable()))
  ) {
    context.check();
    return { state: "legacy-inspection", record };
  }
  if (!snapshot) {
    snapshot = await context.store.inspect(
      { workspaceId: crypto.randomUUID(), legacyArchive: null },
      undefined,
      context.signal,
      context.report
    );
    context.check();
  }
  if (!snapshot) throw stale();
  const preview = await previewFor(context, record, snapshot);
  return {
    state: "comparison",
    record,
    preview: { ...preview, discoveryEmpty },
    checkedAt: new Date().toISOString()
  };
}

/** Receive applies one pinned cloud head locally; other heads never trigger a cloud resolution. */
export async function receiveDeviceSlotVersion(
  context: SlotSyncContext,
  record: DeviceSlotRecord,
  preview: SlotPreview,
  id: string,
  received: (backup: Backup) => void
): Promise<SlotSyncResult> {
  validatePreview(context, record, preview);
  let snapshot = await assertPinned(context, preview.snapshot);
  if (!snapshot.heads.some((head) => head.revisionId === id)) throw stale();
  const version = await context.store.download(snapshot, id, context.signal, context.report);
  const backup = await restoreDeviceSlotVersion(version, context.signal);
  const digest = await driveBackupDigest(backup);
  validatePreview(context, record, preview);
  snapshot = await assertPinned(context, snapshot);
  let revision = context.capture.revision;
  const next = await applyVersion(context, record, snapshot, backup, digest, {
    heads: [id],
    received: (accepted) => {
      revision = accepted;
      context.checkIdentity();
      received(backup);
    }
  });
  return {
    state: "received",
    record: next,
    checkedAt: new Date().toISOString(),
    preview: {
      ...preview,
      snapshot,
      generation: next.generation,
      revision,
      conflict: { local: summarize(backup), remotes: preview.conflict.remotes }
    }
  };
}
