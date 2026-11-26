import type { OkxHttp } from "./http.js";
import type { OkxCandle, OkxCategory, OkxProviderRef, OkxQuote } from "./types.js";
import {
  OkxError,
  isOkxSymbol,
  okxDecimal,
  okxInstrumentRef,
  okxInstrumentType,
  okxPositiveDecimal,
  okxRecord,
  okxSeriesId,
  okxTimestamp
} from "./types.js";

const intervals = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "6h": "6Hutc",
  "12h": "12Hutc",
  "1d": "1Dutc",
  "1w": "1Wutc",
  "1M": "1Mutc"
} as const;

export function okxNativeInterval(interval: string): string {
  if (!Object.hasOwn(intervals, interval))
    throw new RangeError(`Unsupported OKX interval: ${interval}`);
  return intervals[interval as keyof typeof intervals];
}

export function normaliseOkxQuote(ref: OkxProviderRef, value: unknown): OkxQuote {
  const row = okxRecord(value);
  const timestamp = okxTimestamp(row.ts);
  if (
    row.instType !== okxInstrumentType(ref.category) ||
    row.instId !== ref.symbol ||
    timestamp === null
  )
    throw new OkxError("protocol", "OKX ticker instrument or timestamp mismatch");
  const lastPrice = okxPositiveDecimal(row.last);
  const previousPrice24h = okxPositiveDecimal(row.open24h);
  const change =
    lastPrice === null || previousPrice24h === null
      ? NaN
      : ((lastPrice - previousPrice24h) / previousPrice24h) * 100;
  return {
    ref,
    seriesId: okxSeriesId(ref),
    timestamp,
    lastPrice,
    previousPrice24h,
    changePercent24h: Number.isFinite(change) ? change : null
  };
}

export function normaliseOkxCandle(value: unknown, category: OkxCategory): OkxCandle {
  if (!Array.isArray(value) || value.length !== 9)
    throw new OkxError("protocol", "Invalid OKX candle row");
  const [time, rawOpen, rawHigh, rawLow, rawClose, vol, volCcy, volQuote, confirm] =
    value as unknown[];
  const timestamp = okxTimestamp(time);
  const open = okxPositiveDecimal(rawOpen),
    high = okxPositiveDecimal(rawHigh),
    low = okxPositiveDecimal(rawLow),
    close = okxPositiveDecimal(rawClose);
  const baseVolume = okxDecimal(okxInstrumentType(category) === "SPOT" ? vol : volCcy);
  const quoteTurnover = okxDecimal(volQuote);
  if (
    timestamp === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    high < Math.max(low, open, close) ||
    low > Math.min(open, close) ||
    baseVolume === null ||
    quoteTurnover === null ||
    (confirm !== "0" && confirm !== "1")
  )
    throw new OkxError("protocol", "Invalid OKX candle values");
  return {
    timestamp,
    open,
    high,
    low,
    close,
    baseVolume,
    quoteTurnover,
    confirmed: confirm === "1"
  };
}

export async function loadOkxQuotes(
  http: Pick<OkxHttp, "get">,
  category: OkxCategory,
  signal?: AbortSignal
): Promise<OkxQuote[]> {
  const instType = okxInstrumentType(category);
  const rows = await http.get("/api/v5/market/tickers", { instType }, signal);
  signal?.throwIfAborted();
  const quotes = new Map<string, OkxQuote>();
  for (const value of rows) {
    const row = okxRecord(value);
    if (row.instType !== instType || typeof row.instId !== "string")
      throw new OkxError("protocol", "Invalid OKX ticker entry");
    if (!isOkxSymbol(category, row.instId)) continue;
    const quote = normaliseOkxQuote(okxInstrumentRef(category, row.instId), row);
    const existing = quotes.get(quote.seriesId);
    if (!existing || existing.timestamp <= quote.timestamp) quotes.set(quote.seriesId, quote);
  }
  return [...quotes.values()];
}

export async function loadOkxHistory(
  http: Pick<OkxHttp, "get">,
  ref: OkxProviderRef,
  interval: string,
  range: { from: number; to: number; maxPages?: number },
  signal?: AbortSignal
): Promise<OkxCandle[]> {
  okxSeriesId(ref);
  const bar = okxNativeInterval(interval);
  const { from, to, maxPages = 2_000 } = range;
  if (
    okxTimestamp(from) === null ||
    okxTimestamp(to) === null ||
    to < from ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 2_000
  )
    throw new RangeError("Invalid OKX history range or page budget");

  let cursor = to + 1;
  const candles = new Map<number, OkxCandle>();
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const rows = await http.get(
      "/api/v5/market/history-candles",
      { instId: ref.symbol, bar, after: String(cursor), limit: "300" },
      signal
    );
    signal?.throwIfAborted();
    if (!rows.length) return [...candles.values()].sort((a, b) => a.timestamp - b.timestamp);
    let oldest = cursor;
    for (const row of rows) {
      const candle = normaliseOkxCandle(row, ref.category);
      if (candle.timestamp >= cursor)
        throw new OkxError("pagination", "OKX candle is outside its history page");
      oldest = Math.min(oldest, candle.timestamp);
      const previous = candles.get(candle.timestamp);
      if (candle.timestamp >= from && (!previous || (!previous.confirmed && candle.confirmed)))
        candles.set(candle.timestamp, candle);
    }
    if (oldest <= from) return [...candles.values()].sort((a, b) => a.timestamp - b.timestamp);
    cursor = oldest;
  }
  throw new OkxError("pagination", "OKX history page budget exhausted");
}
