import { isRecord } from "../../model/backup-format.js";
import { sha256 } from "./backup.js";
import { DRIVE_CLIENT_ID } from "./types.js";
import type { DriveAuthorization } from "./types.js";

const identities = new WeakMap<DriveAuthorization, Promise<string | null>>();
/** Raw permissionId exists only while hashing this response; it is never persisted or logged. */
export function capabilityAccountKey(
  auth: DriveAuthorization,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<string | null> {
  const known = identities.get(auth);
  if (known) return known;
  const load = async () => {
    const scope = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(20_000)]);
    try {
      scope.throwIfAborted();
      const response = await fetcher(
        "https://www.googleapis.com/drive/v3/about?fields=user(permissionId)",
        {
          headers: { Authorization: `Bearer ${auth.getAccessToken()}` },
          signal: scope,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer"
        }
      );
      scope.throwIfAborted();
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {});
        return null;
      }
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      try {
        for (;;) {
          const next = await reader.read();
          scope.throwIfAborted();
          if (next.done) break;
          bytes += next.value.length;
          if (bytes > 16 * 1024) return null;
          chunks.push(new Uint8Array(next.value));
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const value: unknown = JSON.parse(await new Blob(chunks).text());
      if (
        !isRecord(value) ||
        !isRecord(value.user) ||
        typeof value.user.permissionId !== "string" ||
        !/^[\w-]{1,200}$/.test(value.user.permissionId)
      )
        return null;
      const key = await sha256(new Blob([`${DRIVE_CLIENT_ID}\n${value.user.permissionId}`]));
      scope.throwIfAborted();
      return key;
    } catch {
      signal.throwIfAborted();
      auth.signal.throwIfAborted();
      return null;
    }
  };
  const result = load();
  identities.set(auth, result);
  void result.catch(() => identities.delete(auth));
  return result;
}
