import type { YandexAssociation, YandexJournal, YandexPending } from "./journal.js";
import type { YandexRevisions } from "./revisions.js";
import { YandexError } from "./types.js";

const sameHeads = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const samePending = (a: YandexPending | undefined, b: YandexPending) =>
  !!a &&
  a.accountId === b.accountId &&
  a.credentialGeneration === b.credentialGeneration &&
  a.reference.sha256 === b.reference.sha256 &&
  a.reference.size === b.reference.size &&
  JSON.stringify(a.revision) === JSON.stringify(b.revision);

/** Adopt a proven own publication as a baseline while the captured local draft remains dirty. */
export async function recoverYandexPending(options: {
  association: YandexAssociation | undefined;
  heads: readonly string[];
  journal: YandexJournal;
  revisions: YandexRevisions;
  clientId: string;
  accountId: string;
  signal: AbortSignal;
  valid: () => boolean;
  beforeEffect(): Promise<void>;
  confirm(heads: readonly string[], digest: string): Promise<void>;
}): Promise<YandexAssociation | undefined> {
  const { association, heads, journal, revisions, clientId, accountId, signal } = options;
  const check = () => {
    signal.throwIfAborted();
    if (!options.valid()) throw new YandexError("local-changed");
  };
  if (!association || heads.length !== 1) return association;
  const pending = await journal.pending(clientId, accountId);
  check();
  if (
    !pending ||
    heads[0] !== pending.revision.revisionId ||
    (!sameHeads(association.heads, pending.revision.parents) &&
      !sameHeads(association.heads, heads))
  )
    return association;
  if (!(await revisions.verifiedPending(pending, options.valid)))
    throw new YandexError("indeterminate");
  await options.beforeEffect();
  check();
  const current = await journal.pending(clientId, accountId);
  check();
  if (!samePending(current, pending) || !(await revisions.verifiedPending(pending, options.valid)))
    throw new YandexError("local-changed");
  check();
  await options.confirm(heads, pending.revision.digest);
  check();
  if (!samePending(await journal.pending(clientId, accountId), pending))
    throw new YandexError("local-changed");
  check();
  await journal.clearPending(clientId, accountId, signal, pending);
  check();
  if (await journal.pending(clientId, accountId)) throw new YandexError("local-changed");
  check();
  const confirmed = await journal.association(clientId, accountId);
  check();
  if (
    !confirmed ||
    !sameHeads(confirmed.heads, heads) ||
    confirmed.digest !== pending.revision.digest
  )
    throw new YandexError("local-changed");
  return confirmed;
}
