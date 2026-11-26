import { isBankIdentity, isReservedProviderId } from "../model/market-provider.js";
import { quotation } from "../model/market-model.js";
import type { CatalogInstrument } from "../model/types.js";
import { list, object, text } from "./types.js";

export const INSTRUMENT_SEARCH_PRICE_LIMIT = 24;

export function bankSearchQuoteUid(item: CatalogInstrument): string | undefined {
  const uid = item.uid ?? item.instrumentUid;
  return item.kind === "share" && uid && isBankIdentity({ ...item, uid }) ? uid : undefined;
}

interface Requester {
  request(
    service: string,
    method: string,
    body: object,
    signal: AbortSignal
  ): Promise<Record<string, unknown>>;
}

export async function loadInstrumentSearchPrices(
  client: Requester,
  ids: readonly string[],
  signal: AbortSignal
): Promise<Map<string, number>> {
  signal.throwIfAborted();
  const requested = new Set(
    [...new Set(ids.filter((id) => id && !isReservedProviderId(id)))].slice(
      0,
      INSTRUMENT_SEARCH_PRICE_LIMIT
    )
  );
  if (!requested.size) return new Map();
  const response = await client.request(
    "MarketDataService",
    "GetLastPrices",
    { instrumentId: [...requested], lastPriceType: "LAST_PRICE_EXCHANGE" },
    signal
  );
  signal.throwIfAborted();
  const prices = new Map<string, number>();
  for (const input of list(response.lastPrices)) {
    const data = object(input);
    const uid = text(data?.instrumentUid);
    const value = quotation(data?.price);
    if (uid && requested.has(uid) && value !== null && Number.isFinite(value) && value > 0)
      prices.set(uid, value);
  }
  return prices;
}
