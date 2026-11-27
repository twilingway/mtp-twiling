import type { Backup } from "../../model/types.js";
import type {
  CloudOperationGuard,
  CloudPreparedSnapshot,
  CloudSyncHost
} from "../../screens/terminal/controller-cloud-host.js";
import { driveBackupDigest } from "../drive/backup.js";
import type { YandexApplyIntent, YandexJournal } from "./journal.js";
import type { YandexRemote } from "./revisions.js";
import { YandexError } from "./types.js";

export interface YandexApplyActions {
  committed(intent: YandexApplyIntent, acceptedRevision: number): void;
  committedRevision(operationId: string): number | undefined;
  clearCommitted(operationId: string): void;
  accept(heads: readonly string[], digest: string, expectedRevision: number): Promise<void>;
  applying(): void;
}
export interface YandexApplyContext {
  host: CloudSyncHost;
  journal: YandexJournal;
  clientId: string;
  accountId: string;
  generation: string;
  guard: CloudOperationGuard;
  captured: CloudPreparedSnapshot;
  heads: readonly string[];
  remotes: readonly YandexRemote[];
  decode(remote: YandexRemote): Promise<Backup>;
  actions: YandexApplyActions;
}
async function checkedBackup(context: YandexApplyContext, remote: YandexRemote): Promise<Backup> {
  const backup = await context.decode(remote);
  if (backup.schemaVersion !== 2) throw new YandexError("unsupported-format");
  if ((await driveBackupDigest(backup)) !== remote.revision.digest)
    throw new YandexError("remote-invalid");
  return backup;
}
/** A durable intent plus an exact commit receipt prevents retry from importing twice. */
export async function reconcileYandexApply(
  context: YandexApplyContext,
  chooseLocal: boolean,
  retryRemoteId?: string
): Promise<boolean> {
  const { journal, clientId, accountId, guard, captured, actions } = context;
  const intent = await journal.applyIntent(clientId, accountId);
  if (!intent) return false;
  if (chooseLocal) {
    await journal.archiveApplyIntent(clientId, intent, guard.signal);
    await journal.clearApplyIntent(clientId, accountId, guard.signal);
    actions.clearCommitted(intent.operationId);
    return false;
  }
  if (intent.credentialGeneration !== context.generation) throw new YandexError("indeterminate");
  const retireForReviewedRetry = async (): Promise<false> => {
    guard.signal.throwIfAborted();
    if (!guard.isCurrent() || context.host.scope("yandex-disk").revision !== captured.revision)
      throw new YandexError("local-changed");
    // Explicit direction supersedes the old outcome; it does not classify that outcome as no-commit.
    await journal.archiveApplyIntent(clientId, intent, guard.signal);
    await journal.clearApplyIntent(clientId, accountId, guard.signal);
    actions.clearCommitted(intent.operationId);
    return false;
  };
  if (retryRemoteId !== undefined && retryRemoteId !== intent.targetId)
    return retireForReviewedRetry();
  const remote = context.remotes.find(({ revision }) => revision.revisionId === intent.targetId);
  if (
    !remote ||
    remote.revision.digest !== intent.digest ||
    !intent.heads.every((id) => context.remotes.some(({ revision }) => revision.revisionId === id))
  )
    throw new YandexError("conflict");
  await checkedBackup(context, remote);
  const accepted = actions.committedRevision(intent.operationId);
  if (
    (accepted !== undefined && accepted === captured.revision) ||
    captured.digest === intent.digest
  ) {
    await actions.accept(intent.heads, captured.digest, captured.revision);
    await journal.clearApplyIntent(clientId, accountId, guard.signal);
    actions.clearCommitted(intent.operationId);
    return true;
  }
  if (retryRemoteId === intent.targetId) {
    return retireForReviewedRetry();
  }
  throw new YandexError("indeterminate");
}
export async function applyYandexRemote(
  context: YandexApplyContext,
  remote: YandexRemote
): Promise<void> {
  const { journal, clientId, accountId, guard, captured, actions } = context;
  const backup = await checkedBackup(context, remote);
  if (captured.digest === remote.revision.digest) {
    await actions.accept(context.heads, captured.digest, captured.revision);
    return;
  }
  const pending = await journal.pending(clientId, accountId);
  if (pending) {
    await journal.archivePending(clientId, pending, guard.signal);
    await journal.clearPending(clientId, accountId, guard.signal);
  }
  const intent: YandexApplyIntent = {
    version: 1,
    operationId: crypto.randomUUID(),
    accountId,
    credentialGeneration: context.generation,
    targetId: remote.revision.revisionId,
    heads: context.heads,
    digest: remote.revision.digest
  };
  await journal.saveApplyIntent(clientId, intent, guard.signal);
  actions.applying();
  let committed: number | undefined;
  try {
    await context.host.apply("yandex-disk", backup, captured.revision, guard, (revision) => {
      committed = revision;
      actions.committed(intent, revision);
    });
    if (committed === undefined) throw new YandexError("local-changed");
  } catch (error) {
    // The host guarantees an immediate callback after native commit. No callback on a completed
    // live attempt proves no commit; a crash/aborted identity never enters this cleanup path.
    if (committed === undefined && !guard.signal.aborted && guard.isCurrent()) {
      try {
        await journal.clearApplyIntent(clientId, accountId, guard.signal);
      } catch {
        throw new YandexError("local-save");
      }
    }
    throw error;
  }
  if (
    committed === undefined ||
    guard.signal.aborted ||
    !guard.isCurrent() ||
    context.host.scope("yandex-disk").revision !== committed
  )
    throw new YandexError("local-changed");
  await actions.accept(context.heads, remote.revision.digest, committed);
  await journal.clearApplyIntent(clientId, accountId, guard.signal);
  actions.clearCommitted(intent.operationId);
}
