import type { CloudSelection } from "../../model/cloud-sync.js";
import { receiveGoogleSlotSelection } from "./device-slot-inspection.js";
import type { GoogleSlotPreviews } from "./device-slot-inspection.js";
import type { LegacyDeviceSlotMigration } from "./device-slot-migration.js";
import type { GoogleSlotOperation, GoogleSlotCompletion } from "./device-slot-operation.js";
import { googleSlotReceiveReceipt } from "./device-slot-status.js";
import type { GoogleStatus, GoogleTransientStatusKey } from "./device-slot-status.js";
import { chooseDeviceSlotVersion, restorePreviousDeviceSlotVersion } from "./device-slot-sync.js";
import type { DriveAuthorization } from "./types.js";

interface Options {
  previews: GoogleSlotPreviews;
  migration: LegacyDeviceSlotMigration;
  fetcher: typeof fetch;
  state(): GoogleStatus;
  authorization(): DriveAuthorization | undefined;
  run(
    operation: GoogleSlotOperation,
    selection?: CloudSelection
  ): Promise<GoogleSlotCompletion | undefined>;
  inspect(): Promise<void>;
  compact(completion: GoogleSlotCompletion): Promise<void>;
  update(patch: Partial<GoogleStatus>): void;
  omit(...keys: GoogleTransientStatusKey[]): void;
}

/** User actions share previews and explicit migration state; only local send/migrate trigger cleanup. */
export function createGoogleSlotProviderActions(options: Options) {
  const migrateLegacy = async (selection: CloudSelection): Promise<void> => {
    if (!options.migration.current?.verified || !options.state().migrationRequired) return;
    const migrated = await options.run(
      (context, record) => options.migration.migrate(context, record, selection),
      selection
    );
    if (migrated) await options.compact(migrated);
  };
  return {
    localIntent(): void {
      if (!options.state().enabled) return;
      options.previews.clear();
      options.omit("comparison");
      options.update({ pendingChanges: true });
    },
    async restorePrevious(revisionId: string): Promise<void> {
      if (!options.state().previousVersions?.some(({ id }) => id === revisionId)) return;
      await options.run((context, record) =>
        restorePreviousDeviceSlotVersion(context, record, revisionId)
      );
    },
    async receive(id: string): Promise<void> {
      const preview = options.previews.comparison ?? options.previews.choice;
      if (!preview) {
        await options.inspect();
        return;
      }
      await options.run(
        receiveGoogleSlotSelection(preview, options.previews, id, (backup) => {
          options.omit("comparison");
          options.update(googleSlotReceiveReceipt(options.state(), backup, id));
        }),
        { kind: "remote", id }
      );
    },
    async choose(selection: CloudSelection): Promise<void> {
      if (options.state().migrationRequired) return migrateLegacy(selection);
      const preview =
        selection.kind === "local"
          ? (options.previews.comparison ?? options.previews.choice)
          : options.previews.choice;
      if (!preview) {
        await options.inspect();
        options.update({ choiceAction: { selection, state: "review" } });
        return;
      }
      const sent = await options.run(
        (context, record) => chooseDeviceSlotVersion(context, record, preview, selection),
        selection
      );
      if (sent && selection.kind === "local") await options.compact(sent);
    },
    async prepareLegacyArchive(): Promise<Blob | undefined> {
      const authorization = options.authorization();
      if (!authorization || !options.state().migrationRequired) return;
      let body: Blob | undefined;
      await options.run(async (context, record) => {
        body = await options.migration.prepare(context, record, authorization, options.fetcher);
        return { state: "migration", record };
      });
      return body;
    },
    async verifyLegacyArchive(file: Blob): Promise<void> {
      if (!options.migration.current || !options.state().migrationRequired) return;
      await options.run(async (context, record) => {
        await options.migration.verify(context, file);
        return { state: "migration", record };
      });
    },
    migrateLegacy
  };
}
