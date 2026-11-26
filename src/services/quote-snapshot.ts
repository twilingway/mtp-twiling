import { quotation } from "../model/market-model.js";
import type { MarketRow } from "../model/types.js";
import { quoteDay } from "./quote-day-base.js";
import { serverTimestamp } from "./server-clock.js";
import { list, object, text } from "./types.js";

interface QuoteRequester {
  request(service: string, method: string, body: object): Promise<Record<string, unknown>>;
}

/** Price and prior close are independent; a failed close must not discard a valid price. */
export function quoteSnapshot(client: QuoteRequester, ids: readonly string[]) {
  return Promise.allSettled([
    client.request("MarketDataService", "GetLastPrices", {
      instrumentId: ids,
      lastPriceType: "LAST_PRICE_EXCHANGE"
    }),
    client.request("MarketDataService", "GetClosePrices", {
      instruments: ids.map((instrumentId) => ({ instrumentId }))
    })
  ] as const);
}

function datedQuote(row: MarketRow, now: number): number | null {
  const time = serverTimestamp(row.time);
  return row.price !== null &&
    Number.isFinite(row.price) &&
    row.price > 0 &&
    time !== null &&
    time <= now
    ? time
    : null;
}

function hasDayBase(row: MarketRow, day: string): boolean {
  return (
    row.previousCloseDay === day &&
    row.previousClose !== null &&
    Number.isFinite(row.previousClose) &&
    row.previousClose > 0
  );
}

function restoreCachedQuote(row: MarketRow, cached: MarketRow, now: number): void {
  const saved = datedQuote(cached, now),
    current = datedQuote(row, now);
  if (saved === null) return;
  if (current === null || current < saved) {
    row.price = cached.price;
    row.time = cached.time ?? null;
    row.availability = cached.availability;
  }
  const day = quoteDay(row.time, now);
  if (!day || !hasDayBase(cached, day)) return;
  if (!hasDayBase(row, day) || (!row.previousCloseSource && cached.previousCloseSource)) {
    row.previousClose = cached.previousClose;
    row.previousCloseDay = day;
    row.previousCloseSource = cached.previousCloseSource ?? null;
    row.closeTime = cached.closeTime;
  } else if (
    row.previousClose === cached.previousClose &&
    row.previousCloseSource === cached.previousCloseSource
  )
    row.closeTime ??= cached.closeTime;
}

/** Retain dated cached evidence when the snapshot omits or cannot identify a replacement. */
export function applyQuoteSnapshot(
  rows: readonly MarketRow[],
  cachedRows: readonly MarketRow[],
  prices: unknown,
  now: number
): void {
  const cachedByUid = new Map(cachedRows.map((row) => [row.uid, row]));
  for (const row of rows) {
    const saved = row.uid ? cachedByUid.get(row.uid) : undefined;
    if (saved) restoreCachedQuote(row, saved, now);
  }
  for (const price of list(prices)) applyLastPrice(rows, price, now);
}

export function applyLastPrice(
  rows: readonly MarketRow[],
  input: unknown,
  acceptedThrough: number
): MarketRow | undefined {
  const price = object(input);
  if (!price) return;
  const uid = text(price.instrumentUid),
    figi = text(price.figi),
    row = rows.find((row) => (uid && row.uid === uid) || (figi && row.figi === figi));
  if (!row) return;
  const value = quotation(price.price);
  if (value === null || value <= 0) return;
  const previousTime = datedQuote(row, acceptedThrough),
    nextTime = serverTimestamp(price.time),
    dated = nextTime !== null && nextTime <= acceptedThrough;
  if (previousTime !== null && (!dated || nextTime < previousTime)) return;
  row.price = value;
  row.time = dated ? (text(price.time) ?? new Date(nextTime).toISOString()) : null;
  row.availability = "available";
  return row;
}
