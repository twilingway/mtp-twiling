import type { Cache } from "./types.js";

export function isGuestQuotaError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) && error.name === "QuotaExceededError"
  );
}

/** Recovery must not make a full cache block quotes or the next bank login. Portable writes still fail. */
export function publicGuestRecoveryCache(cache: Cache, failed: () => boolean): Cache {
  const optionalCache = (owner: string, error: unknown) =>
    owner === "public" && failed() && isGuestQuotaError(error);
  return {
    ...cache,
    saveWatchlistSnapshot: async (owner, rows) => {
      try {
        await cache.saveWatchlistSnapshot(owner, rows);
      } catch (error) {
        if (rows.length || !optionalCache(owner, error)) throw error;
      }
    },
    saveMarket: async (owner, value) => {
      try {
        await cache.saveMarket(owner, value);
      } catch (error) {
        if (value.rows.length || !optionalCache(owner, error)) throw error;
      }
    }
  };
}
