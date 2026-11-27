import { isRecord } from "../../model/backup-format.js";
import { assertSlotHttp } from "./device-slot-http.js";
import { DriveError } from "./types.js";
import type { DriveAuthorization } from "./types.js";
import type { CapabilityStorage, ProbeJournal } from "./write-capability-storage.js";
import { ownsCapabilityProbe } from "./write-capability-storage.js";

/** Only IDs from the private journal are considered. No remote listing is performed. */
export async function cleanupCapabilityProbes(
  auth: DriveAuthorization,
  fetcher: typeof fetch,
  storage: CapabilityStorage,
  credentialId: string,
  accountKey: string | null,
  signal: AbortSignal
): Promise<number> {
  const owned = (item: ProbeJournal) => ownsCapabilityProbe(item, credentialId, accountKey);
  const entries = (await storage.read()).journal.filter(owned);
  const remove = async (entry: ProbeJournal) =>
    storage.change((data) => {
      data.journal = data.journal.filter((item) => item.id !== entry.id);
    }, signal);
  const request = async (entry: ProbeJournal, method = "GET") => {
    const scope = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(10_000)]);
    scope.throwIfAborted();
    const endpoint = `https://www.googleapis.com/drive/v3/files/${entry.id}`;
    const response = await fetcher(
      method === "GET" ? `${endpoint}?fields=id,name,appProperties,trashed` : endpoint,
      {
        method,
        headers: { Authorization: `Bearer ${auth.getAccessToken()}` },
        signal: scope,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer"
      }
    );
    scope.throwIfAborted();
    return response;
  };
  for (const entry of entries.slice(0, 4)) {
    signal.throwIfAborted();
    auth.signal.throwIfAborted();
    try {
      if (!entry.dispatched) {
        await remove(entry);
        continue;
      }
      const response = await request(entry);
      if (response.status === 404) {
        void response.body?.cancel().catch(() => {});
        continue;
      }
      assertSlotHttp(response);
      // The small metadata response is bounded before parsing.
      if (!response.body) continue;
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      try {
        for (;;) {
          const next = await reader.read();
          signal.throwIfAborted();
          auth.signal.throwIfAborted();
          if (next.done) break;
          bytes += next.value.length;
          if (bytes > 16 * 1024) throw new DriveError("limit", "Некорректные метаданные пробы.");
          chunks.push(new Uint8Array(next.value));
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const metadata: unknown = JSON.parse(await new Blob(chunks).text());
      if (
        !isRecord(metadata) ||
        metadata.id !== entry.id ||
        metadata.name !== `${entry.namespace}-${entry.key}` ||
        metadata.trashed === true ||
        !isRecord(metadata.appProperties) ||
        metadata.appProperties.mtpNamespace !== entry.namespace ||
        metadata.appProperties.mtpKind !== entry.kind ||
        metadata.appProperties.mtpKey !== entry.key
      )
        continue;
      const deleted = await request(entry, "DELETE");
      assertSlotHttp(deleted);
      void deleted.body?.cancel().catch(() => {});
      const gone = await request(entry);
      void gone.body?.cancel().catch(() => {});
      if (gone.status === 404) await remove(entry);
    } catch {
      signal.throwIfAborted();
      auth.signal.throwIfAborted();
    }
  }
  return (await storage.read()).journal.filter(owned).length;
}
