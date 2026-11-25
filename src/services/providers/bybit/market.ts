import type { BybitHttp } from "./http.js";
import {
  BybitError,
  decimal,
  epochMs,
  instrumentRef,
  record,
  requiredText,
  seriesId
} from "./types.js";
import type { BybitCandle, BybitCategory, BybitQuote, InstrumentRef } from "./types.js";

const intervals = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W",
  "1M": "M"
} as const;
export type BybitInterval = keyof typeof intervals;
export function nativeInterval(interval: string): string {
  if (!Object.hasOwn(intervals, interval))
    throw new RangeError(`Unsupported Bybit interval: ${interval}`);
  return intervals[interval as BybitInterval];
}
export function intervalFromNative(value: string): BybitInterval {
  const match = (Object.keys(intervals) as BybitInterval[]).find((key) => intervals[key] === value);
  if (!match) throw new BybitError("protocol", "Unsupported Bybit native interval");
  return match;
}
function price(value: unknown): number | null {
  const result = decimal(value);
  return result !== null && result >= 0 ? result : null;
}
export function normaliseQuote(
  ref: InstrumentRef,
  raw: Record<string, unknown>,
  timestamp: number
): BybitQuote {
  if (raw.symbol !== ref.symbol || epochMs(timestamp) === null)
    throw new BybitError("protocol", "Bybit quote symbol/time mismatch");
  const change = decimal(raw.price24hPcnt);
  return {
    ref,
    seriesId: seriesId(ref),
    timestamp,
    lastPrice: price(raw.lastPrice),
    markPrice: price(raw.markPrice),
    indexPrice: price(raw.indexPrice),
    previousPrice24h: price(raw.prevPrice24h),
    changePercent24h: change === null ? null : change * 100,
    comparisonBasis: "rolling-24h",
    baseVolume24h: price(raw.volume24h),
    quoteTurnover24h: price(raw.turnover24h)
  };
}
export function normaliseCandle(values: unknown, confirmed: boolean | null = null): BybitCandle {
  if (!Array.isArray(values) || values.length < 7)
    throw new BybitError("protocol", "Invalid Bybit candle row");
  const timestamp = epochMs(values[0]);
  const numbers = values.slice(1, 7).map(price);
  const [open, high, low, close, baseVolume, quoteTurnover] = numbers;
  if (
    timestamp === null ||
    numbers.some((value) => value === null) ||
    open == null ||
    high == null ||
    low == null ||
    close == null ||
    baseVolume == null ||
    quoteTurnover == null ||
    high < low ||
    high < Math.max(open, close) ||
    low > Math.min(open, close)
  )
    throw new BybitError("protocol", "Invalid Bybit candle numeric values");
  return { timestamp, open, high, low, close, baseVolume, quoteTurnover, confirmed };
}
export function chronologicalCandles(values: readonly BybitCandle[]): BybitCandle[] {
  return [...new Map(values.map((value) => [value.timestamp, value])).values()].sort(
    (a, b) => a.timestamp - b.timestamp
  );
}
export async function loadQuotes(
  http: BybitHttp,
  category: BybitCategory,
  symbol?: string,
  signal?: AbortSignal
): Promise<BybitQuote[]> {
  const params: Record<string, string> = { category };
  if (symbol !== undefined) params.symbol = instrumentRef(category, symbol).symbol;
  const response = await http.get("/v5/market/tickers", params, signal);
  if (response.result.category !== category || !Array.isArray(response.result.list))
    throw new BybitError("protocol", "Bybit ticker category/list mismatch");
  return response.result.list.map((value) => {
    const raw = record(value),
      ref = instrumentRef(category, requiredText(raw.symbol));
    if (symbol !== undefined && ref.symbol !== symbol)
      throw new BybitError("protocol", "Bybit ticker response symbol mismatch");
    return normaliseQuote(ref, raw, response.time);
  });
}
export interface HistoryRequest {
  from: number;
  to: number;
  maxPages?: number;
}
export async function loadHistory(
  http: BybitHttp,
  ref: InstrumentRef,
  interval: string,
  range: HistoryRequest,
  signal?: AbortSignal
): Promise<BybitCandle[]> {
  seriesId(ref);
  const native = nativeInterval(interval),
    maxPages = range.maxPages ?? 1000;
  if (
    epochMs(range.from) === null ||
    epochMs(range.to) === null ||
    range.to < range.from ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 1000
  )
    throw new RangeError("Invalid Bybit history range/page budget");
  const result = new Map<number, BybitCandle>();
  let end = range.to;
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const response = await http.get(
      "/v5/market/kline",
      {
        category: ref.category,
        symbol: ref.symbol,
        interval: native,
        start: String(range.from),
        end: String(end),
        limit: "1000"
      },
      signal
    );
    if (
      response.result.category !== ref.category ||
      response.result.symbol !== ref.symbol ||
      !Array.isArray(response.result.list)
    )
      throw new BybitError("protocol", "Bybit history category/symbol/list mismatch");
    const rows = chronologicalCandles(response.result.list.map((value) => normaliseCandle(value)));
    if (!rows.length) return chronologicalCandles([...result.values()]);
    for (const row of rows) {
      if (row.timestamp < range.from || row.timestamp > end)
        throw new BybitError("pagination", "Bybit candle outside requested page");
      if (!result.has(row.timestamp)) result.set(row.timestamp, row);
    }
    const first = rows[0];
    if (!first) throw new BybitError("protocol", "Empty Bybit candle page");
    if (first.timestamp <= range.from) return chronologicalCandles([...result.values()]);
    end = first.timestamp - 1;
  }
  throw new BybitError("pagination", "Bybit history page budget exhausted");
}
