import { isRecord } from "../../model/backup-format.js";
import { get, transaction } from "../storage-db.js";
import { DriveError } from "./types.js";
import { invalidRetention, validFileId } from "./legacy-raw-archive-http.js";

export interface OwnedDeleteProbe {
  readonly fileId: string;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly publicClientId: string;
  readonly credentialId: string;
  observed: boolean;
}
export interface DeleteProbeJournal {
  read(): Promise<readonly OwnedDeleteProbe[]>;
  change(edit: (entries: OwnedDeleteProbe[]) => void, signal: AbortSignal): Promise<void>;
}
const ID = "private:google-delete-probes:v1";
function parse(row: unknown): OwnedDeleteProbe[] {
  if (row === undefined) return [];
  if (
    !isRecord(row) ||
    !isRecord(row.value) ||
    row.value.schemaVersion !== 1 ||
    !Array.isArray(row.value.entries) ||
    row.value.entries.length > 16
  )
    throw invalidRetention();
  const ids = new Set<string>();
  return row.value.entries.map((value: unknown) => {
    if (
      !isRecord(value) ||
      ![
        value.fileId,
        value.operationId,
        value.workspaceId,
        value.publicClientId,
        value.credentialId
      ].every((item) => typeof item === "string" && validFileId(item)) ||
      typeof value.observed !== "boolean" ||
      ids.has(String(value.fileId))
    )
      throw invalidRetention();
    ids.add(String(value.fileId));
    return {
      fileId: String(value.fileId),
      operationId: String(value.operationId),
      workspaceId: String(value.workspaceId),
      publicClientId: String(value.publicClientId),
      credentialId: String(value.credentialId),
      observed: value.observed
    };
  });
}
export const deleteProbeJournal: DeleteProbeJournal = {
  async read() {
    return parse(await get("preferences", ID));
  },
  async change(edit, signal) {
    let failure: unknown;
    await transaction(
      ["preferences"],
      (tx) => {
        const store = tx.objectStore("preferences"),
          request = store.get(ID);
        request.onsuccess = () => {
          try {
            signal.throwIfAborted();
            const entries = parse(request.result);
            edit(entries);
            if (entries.length > 16)
              throw new DriveError("quota", "Завершите очистку технических файлов Google Диска.");
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
