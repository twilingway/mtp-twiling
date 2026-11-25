import { list } from "./types.js";

const STORES = ["preferences", "drawings", "images", "history", "coverage", "vault"] as const;
type Store = (typeof STORES)[number];
export const db = await new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("twiling-personal-terminal", 2);
  request.onupgradeneeded = () => {
    for (const name of STORES) {
      const store = request.result.objectStoreNames.contains(name)
        ? request.transaction?.objectStore(name)
        : request.result.createObjectStore(name, { keyPath: "id" });
      if (!store) throw new Error("Нет транзакции обновления IndexedDB.");
      if (name === "images" && !store.indexNames.contains("ownerSymbol"))
        store.createIndex("ownerSymbol", ["owner", "symbol"]);
      if (name === "history" && !store.indexNames.contains("seriesDay"))
        store.createIndex("seriesDay", ["owner", "uid", "timeframe", "day"]);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error("Браузер не разрешил открыть IndexedDB."));
  request.onblocked = () => window.dispatchEvent(new CustomEvent("storage-blocked"));
});
db.onversionchange = () => db.close();
const pending = new Set<Promise<unknown>>();
export function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  void promise.then(
    () => pending.delete(promise),
    () => pending.delete(promise)
  );
  return promise;
}
export async function flush(): Promise<void> {
  await Promise.all([...pending]);
}
export function get(store: Store, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => {
      const result: unknown = request.result;
      resolve(result);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
export function all(store: Store): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => {
      const result: unknown = request.result;
      resolve(list(result));
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
export function transaction(
  stores: Store[],
  action: (transaction: IDBTransaction) => void
): Promise<void> {
  return track(
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, "readwrite");
      try {
        action(tx);
      } catch (error) {
        tx.abort();
        reject(
          error instanceof Error
            ? error
            : new Error("IndexedDB operation failed.", { cause: error })
        );
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Запись отменена."));
    })
  );
}
export function put(store: Store, value: object): Promise<void> {
  return transaction([store], (tx) => {
    tx.objectStore(store).put(value);
  });
}
