export interface YandexPendingMatch {
  revisionId: string;
  accountId: string;
  credentialGeneration: string;
  sha256: string;
  size: number;
}
export interface YandexLocalStore {
  key(): Promise<CryptoKey>;
  read(id: string): Promise<unknown>;
  readAssociations?(clientId: string): Promise<readonly { accountId: string; value: unknown }[]>;
  write(id: string, value: unknown, signal: AbortSignal): Promise<void>;
  readOrCreate(id: string, create: () => string, signal: AbortSignal): Promise<unknown>;
  remove(
    id: string,
    signal?: AbortSignal,
    generation?: string,
    pending?: YandexPendingMatch
  ): Promise<void>;
}
export async function yandexLocalStore(): Promise<YandexLocalStore> {
  const storage = await import("../storage-db.js"),
    { deviceKey } = await import("../storage.js");
  return {
    key: deviceKey,
    readAssociations: (clientId) =>
      new Promise((resolve, reject) => {
        const prefix = `mtp:yandex:device:${clientId}:`,
          result: { accountId: string; value: unknown }[] = [],
          tx = storage.db.transaction("vault", "readonly"),
          store = tx.objectStore("vault"),
          keys = store.openKeyCursor();
        keys.onsuccess = () => {
          const cursor = keys.result;
          if (!cursor) return;
          const key = cursor.key;
          if (typeof key === "string" && key.startsWith(prefix) && key.endsWith(":association")) {
            const accountId = key.slice(prefix.length, -":association".length);
            if (/^\d{1,30}$/.test(accountId)) {
              const selected = store.get(key);
              selected.onsuccess = () => {
                const record: unknown = selected.result;
                if (record && typeof record === "object" && "value" in record)
                  result.push({ accountId, value: record.value });
              };
            }
          }
          cursor.continue();
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () =>
          reject(new Error("Yandex association metadata unavailable"));
      }),
    read: async (id) => {
      const value = await storage.get("vault", id);
      return value !== null && typeof value === "object" && "value" in value
        ? value.value
        : undefined;
    },
    write: (id, value, signal) =>
      storage.transaction(["vault"], (tx) => tx.objectStore("vault").put({ id, value }), signal),
    readOrCreate: async (id, create, signal) => {
      let value: unknown;
      await storage.transaction(
        ["vault"],
        (tx) => {
          const store = tx.objectStore("vault"),
            request = store.get(id);
          request.onsuccess = () => {
            const saved: unknown = request.result;
            if (saved === undefined) {
              value = create();
              store.put({ id, value });
            } else if (saved !== null && typeof saved === "object" && "value" in saved) {
              value = saved.value;
            } else tx.abort();
          };
        },
        signal
      );
      return value;
    },
    remove: (id, signal, generation, pending) =>
      storage.transaction(
        ["vault"],
        (tx) => {
          const store = tx.objectStore("vault"),
            request = store.get(id);
          request.onsuccess = () => {
            const saved: unknown = request.result;
            const value =
              saved !== null && typeof saved === "object" && "value" in saved
                ? saved.value
                : undefined;
            if (
              pending &&
              (value === null ||
                typeof value !== "object" ||
                !("revision" in value) ||
                !("accountId" in value) ||
                value.accountId !== pending.accountId ||
                !("credentialGeneration" in value) ||
                value.credentialGeneration !== pending.credentialGeneration ||
                !("reference" in value) ||
                value.reference === null ||
                typeof value.reference !== "object" ||
                !("sha256" in value.reference) ||
                value.reference.sha256 !== pending.sha256 ||
                !("size" in value.reference) ||
                value.reference.size !== pending.size ||
                value.revision === null ||
                typeof value.revision !== "object" ||
                !("revisionId" in value.revision) ||
                value.revision.revisionId !== pending.revisionId)
            )
              return;
            if (
              !generation ||
              (value !== null &&
                typeof value === "object" &&
                "generation" in value &&
                value.generation === generation)
            )
              store.delete(id);
          };
        },
        signal
      )
  };
}
