import type {
  CloudOperationGuard,
  CloudPreparedSnapshot
} from "../../screens/terminal/controller-cloud-host.js";
import type { YandexJournal } from "./journal.js";
import type { YandexRevisions } from "./revisions.js";
import { sameHeads } from "./coordinator-transfer.js";
import { YandexError } from "./types.js";
import type { CloudRetentionStatus, CloudSyncStatus } from "../../model/cloud-sync.js";
import type { YandexAssociation } from "./journal.js";
import { yandexUnchangedStatus } from "./coordinator-status.js";
import type { YandexStatusClear } from "./coordinator-status.js";

export async function publishYandexSnapshot(
  revisions: YandexRevisions,
  captured: CloudPreparedSnapshot,
  heads: readonly string[],
  guard: CloudOperationGuard,
  explicit: boolean,
  journal: YandexJournal,
  clientId: string,
  accountId: string,
  accept: (heads: readonly string[], digest: string, expected: number) => Promise<void>,
  progress: (stage: "upload" | "verify") => void,
  currentRevision: () => number,
  beforeEffect: () => Promise<void>,
  retention: (status: CloudRetentionStatus) => void
): Promise<void> {
  const valid = () => guard.isCurrent() && currentRevision() === captured.revision;
  progress("upload");
  const revision = await revisions.publish(
    captured.prepared,
    captured.digest,
    heads,
    valid,
    explicit,
    beforeEffect
  );
  progress("verify");
  const after = await revisions.inspect(valid);
  if (!sameHeads(after.heads, [revision.revisionId])) throw new YandexError("conflict");
  await accept(after.heads, revision.digest, captured.revision);
  await journal.clearPending(clientId, accountId, guard.signal);
  if (revisions.retention) retention(revisions.retention);
}
export async function unchangedYandexSnapshot(
  revisions: YandexRevisions,
  association: YandexAssociation,
  guard: CloudOperationGuard,
  expectedRevision: number,
  currentRevision: () => number,
  update: (patch: Partial<CloudSyncStatus>, clear: readonly YandexStatusClear[]) => void
): Promise<void> {
  const valid = () => guard.isCurrent() && currentRevision() === expectedRevision;
  await revisions.retryPrune(valid);
  guard.signal.throwIfAborted();
  if (!valid()) throw new YandexError("local-changed");
  update(
    {
      ...yandexUnchangedStatus(association),
      ...(revisions.retention ? { retention: revisions.retention } : {})
    },
    association.heads.length > 1 ? ["progress"] : ["conflict", "progress"]
  );
}
