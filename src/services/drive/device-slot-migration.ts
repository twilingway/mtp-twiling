import type { CloudSelection } from "../../model/cloud-sync.js";
import {
  assertArchiveStillCurrent,
  createLegacyArchive,
  verifyLegacyArchiveFile
} from "./device-slot-archive.js";
import type { ArchiveSource, LegacyArchive } from "./device-slot-archive.js";
import type { DeviceSlotRecord } from "./device-slot-local.js";
import { publishLegacyDeviceSlot } from "./device-slot-sync.js";
import type { SlotSyncContext } from "./device-slot-sync.js";
import { DriveSync } from "./sync.js";
import { DriveTransport } from "./transport.js";
import { DRIVE_NAMESPACE, DriveError, LEGACY_DRIVE_NAMESPACE } from "./types.js";
import type { DriveAuthorization } from "./types.js";

export async function inspectLegacyDeviceSlotSources(
  authorization: DriveAuthorization,
  fetcher: typeof fetch
): Promise<ArchiveSource[]> {
  return Promise.all(
    ([DRIVE_NAMESPACE, LEGACY_DRIVE_NAMESPACE] as const).map(async (namespace) => {
      const sync = new DriveSync(
        new DriveTransport(authorization, { fetch: fetcher, namespace }),
        namespace
      );
      return { namespace, sync, inspection: await sync.inspect() };
    })
  );
}

export interface GoogleArchiveStatus {
  readonly digest: string;
  readonly count: number;
  readonly bytes: number;
  readonly verified: boolean;
}

export class LegacyDeviceSlotMigration {
  private archive: { issued: LegacyArchive; sources: ArchiveSource[]; verified?: Blob } | undefined;

  clear() {
    this.archive = undefined;
  }

  get current(): GoogleArchiveStatus | undefined {
    const archive = this.archive;
    return (
      archive && {
        digest: archive.issued.digest,
        count: archive.issued.count,
        bytes: archive.issued.body.size,
        verified: !!archive.verified
      }
    );
  }

  get choices(): LegacyArchive["choices"] | undefined {
    return this.archive?.verified ? this.archive.issued.choices : undefined;
  }

  async prepare(
    context: SlotSyncContext,
    record: DeviceSlotRecord,
    auth: DriveAuthorization,
    fetcher: typeof fetch
  ): Promise<Blob> {
    if (record.scope || record.pending)
      throw new DriveError("conflict", "Google migration already started.");
    context.report("read-versions");
    const sources = await inspectLegacyDeviceSlotSources(auth, fetcher);
    context.check();
    const issued = await createLegacyArchive(
      sources,
      context.signal,
      (completedFiles, totalFiles, transferredBytes) =>
        context.report("download", {
          transfer: { completedFiles, totalFiles, transferredBytes },
          listedVersions: totalFiles
        })
    );
    context.check();
    this.archive = { issued, sources };
    return issued.body;
  }

  async verify(context: SlotSyncContext, file: Blob): Promise<void> {
    const archive = this.archive;
    if (!archive) throw new DriveError("not-ready", "Export the Google backup archive first.");
    context.report("confirm");
    await verifyLegacyArchiveFile(file, archive.issued, context.signal);
    await assertArchiveStillCurrent(archive.sources, context.signal);
    context.check();
    archive.verified = file;
  }

  async migrate(context: SlotSyncContext, record: DeviceSlotRecord, selection: CloudSelection) {
    const archive = this.archive;
    if (!archive?.verified)
      throw new DriveError("not-ready", "Verify the downloaded Google backup archive first.");
    context.report("confirm");
    const selected = await verifyLegacyArchiveFile(
      archive.verified,
      archive.issued,
      context.signal,
      selection.kind === "remote" ? selection.id : undefined
    );
    await assertArchiveStillCurrent(archive.sources, context.signal);
    context.check();
    return publishLegacyDeviceSlot(context, record, archive.issued.digest, selected);
  }
}
