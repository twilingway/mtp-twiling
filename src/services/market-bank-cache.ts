import type { Cache } from "./types.js";
import {
  isBankIdentity,
  isMarketProvider,
  isReservedProviderId
} from "../model/market-provider.js";
/** Bank transport owns no mixed persistence: the facade commits the authoritative ordered list. */
export function bankCacheView(cache: Cache, workspace?: () => string): Cache {
  const ownerFor = (owner: string) => workspace?.() ?? owner;
  return {
    ...cache,
    loadWatchlist: async (owner) =>
      (await cache.loadWatchlist(ownerFor(owner)))?.filter(isBankIdentity),
    loadMarket: async (owner) => {
      const value = await cache.loadMarket(ownerFor(owner));
      return value ? { ...value, rows: value.rows.filter(isBankIdentity) } : undefined;
    },
    loadHistory: (owner, ...args) => cache.loadHistory(ownerFor(owner), ...args),
    saveHistory: (owner, ...args) => cache.saveHistory(ownerFor(owner), ...args),
    loadCoverage: (owner, ...args) => cache.loadCoverage(ownerFor(owner), ...args),
    saveWatchlist: async () => {},
    saveWatchlistSnapshot: async () => {},
    saveMarket: async () => {}
  };
}
export function assertBankRequest(body: unknown, depth = 0): void {
  if (depth > 20) throw new Error("Слишком сложный банковский запрос.");
  if (
    isReservedProviderId(body) ||
    (body &&
      typeof body === "object" &&
      "provider" in body &&
      typeof body.provider === "string" &&
      isMarketProvider(body.provider.trim().toLowerCase()))
  )
    throw new Error("Инструменты Bybit и OKX нельзя отправлять в API банка.");
  if (body && typeof body === "object")
    for (const value of Object.values(body)) assertBankRequest(value, depth + 1);
}
