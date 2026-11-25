import { isRecord } from "../model/backup-format.js";

/** Delete only this profile's portable records, in the same transaction as replacement writes. */
export function replacePortableRecords(
  tx: IDBTransaction,
  owner: string,
  write: () => void,
  valid: () => boolean
): void {
  const stores = ["preferences", "drawings", "images"];
  let pending = stores.length;
  for (const name of stores) {
    const store = tx.objectStore(name),
      request = store.getAll();
    request.onsuccess = () => {
      if (!valid()) {
        tx.abort();
        return;
      }
      const records: unknown[] = request.result;
      for (const record of records) {
        if (!isRecord(record) || record.owner !== owner || typeof record.id !== "string") continue;
        if (
          name !== "preferences" ||
          [`layout:${owner}`, `watchlist:${owner}`, `market:${owner}`].includes(record.id) ||
          typeof record.viewKey === "string"
        )
          store.delete(record.id);
      }
      if (--pending === 0) {
        if (!valid()) {
          tx.abort();
          return;
        }
        try {
          write();
        } catch {
          tx.abort();
        }
      }
    };
  }
}
