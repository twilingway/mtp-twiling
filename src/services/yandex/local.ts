export interface YandexLocalStore {
  key(): Promise<CryptoKey>;
  read(id: string): Promise<unknown>;
  write(id: string, value: unknown, signal: AbortSignal): Promise<void>;
  readOrCreate(id: string, create: () => string, signal: AbortSignal): Promise<unknown>;
  remove(id: string, signal?: AbortSignal, generation?: string): Promise<void>;
}
export async function yandexLocalStore(): Promise<YandexLocalStore> {
  const storage = await import("../storage-db.js"),
    { deviceKey } = await import("../storage.js");
  return {
    key: deviceKey,
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
    remove: (id, signal, generation) =>
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
