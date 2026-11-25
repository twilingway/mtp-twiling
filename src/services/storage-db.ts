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
  action: (transaction: IDBTransaction) => void,
  signal?: AbortSignal
): Promise<void> {
  return track(
    new Promise<void>((resolve, reject) => {
      const cancelled = () => new DOMException("Запись отменена.", "AbortError");
      if (signal?.aborted) {
        reject(cancelled());
        return;
      }
      const tx = db.transaction(stores, "readwrite");
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => {
        try {
          tx.abort();
        } catch (error) {
          cleanup();
          // Native commit is the point of no return, before the JS complete event.
          if (!(error instanceof DOMException && error.name === "InvalidStateError"))
            reject(
              error instanceof Error
                ? error
                : new Error("IndexedDB cancellation failed.", { cause: error })
            );
        }
      };
      tx.oncomplete = () => {
        cleanup();
        resolve();
      };
      tx.onerror = () => {
        cleanup();
        reject(
          signal?.aborted ? cancelled() : (tx.error ?? new Error("IndexedDB transaction failed."))
        );
      };
      tx.onabort = () => {
        cleanup();
        reject(signal?.aborted ? cancelled() : (tx.error ?? new Error("Запись отменена.")));
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        action(tx);
      } catch (error) {
        cleanup();
        try {
          tx.abort();
        } catch {
          // Preserve the writer error if native transaction state already changed.
        }
        reject(
          error instanceof Error
            ? error
            : new Error("IndexedDB operation failed.", { cause: error })
        );
        return;
      }
    })
  );
}
export function put(store: Store, value: object): Promise<void> {
  return transaction([store], (tx) => {
    tx.objectStore(store).put(value);
  });
}
