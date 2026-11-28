import type { CloudSyncStatus } from "../../model/cloud-sync.js";
import type { CloudOperationGuard } from "../../screens/terminal/controller-cloud-host.js";
import type { YandexAssociation, YandexJournal } from "./journal.js";
import { yandexAcceptedStatus } from "./coordinator-status.js";
import type { YandexStatusClear } from "./coordinator-status.js";
import { YandexError } from "./types.js";

export function yandexSnapshotAcceptor(options: {
  journal(): YandexJournal;
  clientId(): string;
  accountId(): string;
  revision(): number;
  status(): CloudSyncStatus;
  clearPreview(): void;
  accepted?(association: YandexAssociation, revision: number): void;
  update(patch: Partial<CloudSyncStatus>, clear: readonly YandexStatusClear[]): void;
}) {
  return async (
    heads: readonly string[],
    digest: string,
    guard: CloudOperationGuard,
    expectedRevision: number,
    baselineOnly = false
  ): Promise<void> => {
    const check = () => {
      guard.signal.throwIfAborted();
      if (!guard.isCurrent() || options.revision() !== expectedRevision)
        throw new YandexError("local-changed");
    };
    check();
    const syncedAt = new Date().toISOString();
    const association: YandexAssociation = {
      version: 1,
      accountId: options.accountId(),
      heads,
      digest,
      syncedAt
    };
    await options.journal().accept(options.clientId(), association, guard.signal);
    check();
    options.accepted?.(association, expectedRevision);
    options.clearPreview();
    if (baselineOnly)
      options.update({ phase: "syncing", pendingChanges: true, lastSyncedAt: syncedAt }, [
        "error",
        "pauseReason",
        "conflict",
        "choiceAction",
        "comparison"
      ]);
    else {
      const accepted = yandexAcceptedStatus(options.status(), heads, syncedAt);
      options.update(accepted.patch, accepted.clear);
    }
  };
}
