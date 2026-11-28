import type { CloudPhase, CloudSelection, CloudSyncStatus } from "../../model/cloud-sync.js";
import type {
  CloudOperationGuard,
  CloudSyncHost
} from "../../screens/terminal/controller-cloud-host.js";
import type { YandexJournal } from "./journal.js";
import type { YandexAssociation } from "./journal.js";
import type { YandexRevisions } from "./revisions.js";
import type { TransferActions } from "./coordinator-transfer.js";
import type { YandexPreview } from "./coordinator-preview.js";
import type { YandexStatusClear } from "./coordinator-status.js";
import { yandexInspectionStatus } from "./coordinator-status.js";
import { publishYandexSnapshot, unchangedYandexSnapshot } from "./coordinator-publish.js";

export interface YandexReceiptState {
  applied?: { operationId: string; targetId: string; revision: number } | undefined;
}
export function yandexTransferActions(options: {
  host: CloudSyncHost;
  revisions: YandexRevisions;
  journal: YandexJournal;
  clientId: string;
  accountId: string;
  guard: CloudOperationGuard;
  preview: YandexPreview;
  receipts: YandexReceiptState;
  previousPhase: CloudPhase;
  selection: CloudSelection | undefined;
  accept(
    heads: readonly string[],
    digest: string,
    guard: CloudOperationGuard,
    revision: number,
    baselineOnly?: boolean
  ): Promise<void>;
  update(this: void, patch: Partial<CloudSyncStatus>, clear?: readonly YandexStatusClear[]): void;
  observed(association: YandexAssociation, revision: number): void;
}): TransferActions {
  const { host, revisions, journal, clientId, accountId, guard, preview, receipts, update } =
    options;
  const revision = () => host.scope("yandex-disk").revision;
  return {
    preview: () => ({
      revision:
        options.selection?.kind === "remote" && receipts.applied?.targetId === options.selection.id
          ? receipts.applied.revision
          : preview.revision,
      heads: preview.heads,
      remoteFingerprint: preview.remoteFingerprint
    }),
    publish: (captured, heads, explicit, beforeEffect) =>
      publishYandexSnapshot(
        revisions,
        captured,
        heads,
        guard,
        explicit,
        journal,
        clientId,
        accountId,
        (accepted, digest, expected) => options.accept(accepted, digest, guard, expected),
        (stage) => update({ progress: { stage } }),
        revision,
        beforeEffect,
        (retention) => update({ retention })
      ),
    accept: (heads, digest, expected) => options.accept(heads, digest, guard, expected),
    confirmedBaseline: (heads, digest, expected) =>
      options.accept(heads, digest, guard, expected, true),
    committed: (intent, acceptedRevision) => {
      receipts.applied = {
        operationId: intent.operationId,
        targetId: intent.targetId,
        revision: acceptedRevision
      };
    },
    committedRevision: (id) =>
      receipts.applied?.operationId === id ? receipts.applied.revision : undefined,
    clearCommitted: (id) => {
      if (receipts.applied?.operationId === id) receipts.applied = undefined;
    },
    applying: () => update({ progress: { stage: "apply" } }),
    unchanged: async (association, expected) => {
      await unchangedYandexSnapshot(revisions, association, guard, expected, revision, update);
      options.observed(association, expected);
    },
    inspected: (captured, remotes, heads, review) => {
      const comparison = preview.capture(captured, remotes, heads, new Date().toISOString());
      update(yandexInspectionStatus(comparison, options.previousPhase, review), ["progress"]);
    },
    conflict: (captured, remotes, heads) => {
      const comparison = preview.capture(captured, remotes, heads, new Date().toISOString());
      update(
        {
          phase: "conflict",
          comparison,
          conflict: { local: comparison.local, remotes: comparison.remotes }
        },
        ["progress", "choiceAction"]
      );
    }
  };
}
