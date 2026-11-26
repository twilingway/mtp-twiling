import type { OpenInterestObservations } from "../../../model/technical-indicators/ta-batch-external.js";
import type { BybitHttp } from "./http.js";
import type { HistoryRequest } from "./market.js";
import { BybitError, decimal, epochMs, record, seriesId } from "./types.js";
import type { InstrumentRef } from "./types.js";

const intervalCodes = {
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d"
} as const;

export function supportsBybitOpenInterestInterval(
  interval: string
): interval is keyof typeof intervalCodes {
  return Object.hasOwn(intervalCodes, interval);
}

/** Fetch Bybit's reported one-sided open interest in base units. */
export async function loadBybitOpenInterest(
  http: BybitHttp,
  ref: InstrumentRef,
  baseCoin: string,
  interval: string,
  range: HistoryRequest,
  signal?: AbortSignal,
  onPage?: (page: OpenInterestObservations) => void
): Promise<OpenInterestObservations> {
  const instrumentKey = seriesId(ref);
  const { from, to, maxPages = 1000 } = range;
  if (
    ref.category !== "linear" ||
    !supportsBybitOpenInterestInterval(interval) ||
    !/^[A-Z0-9][A-Z0-9_-]{0,99}$/.test(baseCoin) ||
    epochMs(from) === null ||
    epochMs(to) === null ||
    to < from ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 1000
  )
    throw new RangeError("Invalid Bybit open interest instrument, interval, or range");

  const params = {
    category: ref.category,
    symbol: ref.symbol,
    intervalTime: intervalCodes[interval],
    startTime: String(from),
    endTime: String(to),
    limit: "200"
  };
  const unit = { kind: "base", currency: baseCoin } as const;
  type Row = OpenInterestObservations["rows"][number];
  const rows = new Map<number, Row>();
  const cursors = new Set<string>();
  let cursor = "";
  let previousOldest = Number.POSITIVE_INFINITY;
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const { result } = await http.get(
      "/v5/market/open-interest",
      cursor ? { ...params, cursor } : params,
      signal
    );
    signal?.throwIfAborted();
    const { list, nextPageCursor } = result;
    if (
      result.category !== ref.category ||
      result.symbol !== ref.symbol ||
      !Array.isArray(list) ||
      (nextPageCursor !== undefined && typeof nextPageCursor !== "string")
    )
      throw new BybitError("protocol", "Invalid Bybit open interest response");
    const batch: Row[] = [];
    let oldest = Number.POSITIVE_INFINITY;
    for (const item of list) {
      const raw = record(item);
      const timestamp = epochMs(raw.timestamp);
      const value = decimal(raw.singleOpenInterest);
      if (
        timestamp === null ||
        timestamp < from ||
        timestamp > to ||
        (raw.singleOpenInterest != null && (value === null || value < 0))
      )
        throw new BybitError("protocol", "Invalid Bybit open interest observation");
      oldest = Math.min(oldest, timestamp);
      if (!rows.has(timestamp)) {
        const observation = { timestamp, value };
        rows.set(timestamp, observation);
        batch.push(observation);
      }
    }
    if (batch.length) {
      batch.sort((left, right) => left.timestamp - right.timestamp);
      onPage?.({ instrumentKey, unit, rows: batch });
    }
    if (!nextPageCursor || oldest === from || !list.length) {
      return {
        instrumentKey,
        unit,
        rows: [...rows.values()].sort((left, right) => left.timestamp - right.timestamp)
      };
    }
    if (oldest >= previousOldest || cursors.has(nextPageCursor))
      throw new BybitError("pagination", "Bybit open interest pagination did not advance");
    cursors.add(nextPageCursor);
    cursor = nextPageCursor;
    previousOldest = oldest;
  }
  throw new BybitError("pagination", "Bybit open interest page budget exhausted");
}
