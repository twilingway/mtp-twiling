import { get, transaction } from "../storage-db.js";
import { DRIVE_CLIENT_ID, DriveError } from "./types.js";
import type {
  LegacyCompactionJournal,
  LegacyCompactionJournalEntry
} from "./legacy-compaction-types.js";

const ID = "private:google-legacy-compaction:v1";
const MAX_OPERATIONS = 8;
const MAX_BYTES = 12 * 1024 * 1024;
const invalid = () => new DriveError("local-save", "The local compaction journal is invalid.");
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Raw bodies never enter the private preferences journal. The codec revalidates each baseline. */
function parse(input: unknown): LegacyCompactionJournalEntry[] {
  if (input === undefined) return [];
  if (
    !object(input) ||
    !object(input.value) ||
    input.value.schemaVersion !== 1 ||
    !Array.isArray(input.value.entries) ||
    input.value.entries.length > MAX_OPERATIONS ||
    JSON.stringify(input).length > MAX_BYTES
  )
    throw invalid();
  const entries: unknown[] = input.value.entries;
  const operations = new Set<string>();
  for (const entry of entries) {
    if (
      !object(entry) ||
      !object(entry.metadata) ||
      !object(entry.binding) ||
      typeof entry.metadata.operationId !== "string" ||
      !entry.metadata.operationId ||
      operations.has(entry.metadata.operationId) ||
      entry.binding.clientId !== DRIVE_CLIENT_ID ||
      typeof entry.binding.accountKey !== "string" ||
      !/^[a-f\d]{64}$/.test(entry.binding.accountKey) ||
      entry.metadata.workspaceId !== entry.binding.workspaceId ||
      entry.metadata.publicClientId !== entry.binding.publicClientId ||
      typeof entry.inventoryDigest !== "string" ||
      !/^[a-f\d]{64}$/.test(entry.inventoryDigest) ||
      !Array.isArray(entry.files) ||
      entry.files.length < 1 ||
      entry.files.length > 2048 ||
      !object(entry.outcomes) ||
      Object.keys(entry.outcomes).length > entry.files.length
    )
      throw invalid();
    operations.add(entry.metadata.operationId);
  }
  return structuredClone(entries) as LegacyCompactionJournalEntry[];
}

export const legacyCompactionJournal: LegacyCompactionJournal = {
  async read(operationId) {
    return parse(await get("preferences", ID)).find(
      (entry) => entry.metadata.operationId === operationId
    );
  },
  async save(entry, signal) {
    let failure: unknown;
    await transaction(
      ["preferences"],
      (tx) => {
        const store = tx.objectStore("preferences");
        const request = store.get(ID);
        request.onsuccess = () => {
          try {
            signal.throwIfAborted();
            const entries = parse(request.result);
            const position = entries.findIndex(
              (item) => item.metadata.operationId === entry.metadata.operationId
            );
            if (position >= 0) {
              const prior = entries[position];
              // Another account cannot adopt an old operation ID, even on a delayed callback.
              if (JSON.stringify(prior?.binding) !== JSON.stringify(entry.binding)) throw invalid();
              if (
                !prior ||
                JSON.stringify(prior.metadata) !== JSON.stringify(entry.metadata) ||
                JSON.stringify(prior.files) !== JSON.stringify(entry.files) ||
                prior.inventoryDigest !== entry.inventoryDigest ||
                (prior.archive &&
                  JSON.stringify(prior.archive) !== JSON.stringify(entry.archive)) ||
                (prior.record && JSON.stringify(prior.record) !== JSON.stringify(entry.record)) ||
                (prior.v3 && JSON.stringify(prior.v3) !== JSON.stringify(entry.v3)) ||
                Object.entries(prior.outcomes).some(
                  ([id, outcome]) => outcome !== "unknown" && entry.outcomes[id] !== outcome
                )
              )
                throw invalid();
              entries[position] = structuredClone(entry);
            } else {
              if (entries.length >= MAX_OPERATIONS)
                throw new DriveError("quota", "The legacy compaction journal is full.");
              entries.push(structuredClone(entry));
            }
            const value = { schemaVersion: 1, entries };
            parse({ value });
            store.put({ id: ID, value });
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      },
      signal
    ).catch((error: unknown) => {
      throw failure instanceof Error ? failure : error;
    });
  }
};

export async function listPendingLegacyCompactions(
  binding: LegacyCompactionJournalEntry["binding"]
): Promise<readonly string[]> {
  const entries = parse(await get("preferences", ID));
  return entries
    .filter(
      (entry) =>
        JSON.stringify(entry.binding) === JSON.stringify(binding) &&
        entry.files.some(
          ({ fileId }) =>
            entry.outcomes[fileId] !== "deleted" && entry.outcomes[fileId] !== "changed"
        )
    )
    .map(({ metadata }) => metadata.operationId);
}

export async function hasPendingLegacyCompaction(workspaceId: string): Promise<boolean> {
  return parse(await get("preferences", ID)).some(
    (entry) =>
      entry.binding.workspaceId === workspaceId &&
      entry.files.some(
        ({ fileId }) => entry.outcomes[fileId] !== "deleted" && entry.outcomes[fileId] !== "changed"
      )
  );
}
