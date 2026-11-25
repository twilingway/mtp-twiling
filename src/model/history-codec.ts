import type { Candle, HistoryRange, Timeframe } from "./types.js";
export const HISTORY_FORMAT = "ohlcv-f64-v1";
export const STRIDE = 6;
export function encodeCandles(candles: readonly Candle[]): ArrayBuffer {
  const values = new Float64Array(candles.length * STRIDE);
  candles.forEach((bar, index) => {
    const offset = index * STRIDE;
    values.set([bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0], offset);
  });
  return values.buffer;
}
export function decodeCandles(buffer: unknown): Candle[] {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength % (STRIDE * 8))
    throw new Error("Повреждённый блок истории.");
  const values = new Float64Array(buffer);
  const result: Candle[] = [];
  for (let i = 0; i < values.length; i += STRIDE) {
    const timestamp = values[i],
      open = values[i + 1],
      high = values[i + 2],
      low = values[i + 3],
      close = values[i + 4],
      volume = values[i + 5];
    if (
      timestamp === undefined ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined
    )
      throw new Error("Некорректные свечи в истории.");
    if (
      ![timestamp, open, high, low, close, volume].every(Number.isFinite) ||
      timestamp < 0 ||
      low > high
    )
      throw new Error("Некорректные свечи в истории.");
    result.push({ timestamp, open, high, low, close, volume });
  }
  return result;
}
export function mergeCandles(...parts: readonly (readonly Candle[])[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const part of parts) for (const candle of part) byTime.set(candle.timestamp, candle);
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
}
export function subtractRanges(
  from: number,
  to: number,
  coverage: readonly HistoryRange[]
): HistoryRange[] {
  const intervals = coverage
    .filter((r) => r.to > from && r.from < to)
    .map((r) => ({ from: Math.max(from, r.from), to: Math.min(to, r.to) }))
    .sort((a, b) => a.from - b.from);
  const gaps: HistoryRange[] = [];
  let cursor = from;
  for (const range of intervals) {
    if (range.from > cursor) gaps.push({ from: cursor, to: range.from });
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < to) gaps.push({ from: cursor, to });
  return gaps;
}
export const TIMEFRAMES: Record<
  Timeframe,
  {
    interval: string;
    stream: string;
    ms: number;
    chunkDays: number;
    limit: number;
  }
> = {
  "1m": {
    interval: "CANDLE_INTERVAL_1_MIN",
    stream: "SUBSCRIPTION_INTERVAL_ONE_MINUTE",
    ms: 60000,
    chunkDays: 1,
    limit: 2400
  },
  "5m": {
    interval: "CANDLE_INTERVAL_5_MIN",
    stream: "SUBSCRIPTION_INTERVAL_FIVE_MINUTES",
    ms: 300000,
    chunkDays: 7,
    limit: 2400
  },
  "15m": {
    interval: "CANDLE_INTERVAL_15_MIN",
    stream: "SUBSCRIPTION_INTERVAL_FIFTEEN_MINUTES",
    ms: 900000,
    chunkDays: 21,
    limit: 2400
  },
  "30m": {
    interval: "CANDLE_INTERVAL_30_MIN",
    stream: "SUBSCRIPTION_INTERVAL_30_MIN",
    ms: 1800000,
    chunkDays: 21,
    limit: 1200
  },
  "1h": {
    interval: "CANDLE_INTERVAL_HOUR",
    stream: "SUBSCRIPTION_INTERVAL_ONE_HOUR",
    ms: 3600000,
    chunkDays: 60,
    limit: 2400
  },
  "1d": {
    interval: "CANDLE_INTERVAL_DAY",
    stream: "SUBSCRIPTION_INTERVAL_ONE_DAY",
    ms: 86400000,
    chunkDays: 1825,
    limit: 2400
  },
  "1w": {
    interval: "CANDLE_INTERVAL_WEEK",
    stream: "SUBSCRIPTION_INTERVAL_WEEK",
    ms: 604800000,
    chunkDays: 1460,
    limit: 300
  }
};
export function splitRanges(ranges: readonly HistoryRange[], timeframe: Timeframe): HistoryRange[] {
  const config = TIMEFRAMES[timeframe];
  if (!config) throw new Error("Неизвестный таймфрейм.");
  const pieces: HistoryRange[] = [];
  for (const range of ranges) {
    for (let from = range.from; from < range.to;) {
      const to = Math.min(range.to, from + config.chunkDays * 86400000);
      pieces.push({ from, to });
      from = to;
    }
  }
  return pieces;
}
export function updateCandleList(list: Candle[], bar: Candle): Candle[] {
  const last = list.at(-1);
  if (!last || bar.timestamp > last.timestamp) {
    list.push(bar);
    return list;
  }
  if (bar.timestamp === last.timestamp) {
    list[list.length - 1] = bar;
    return list;
  }
  return mergeCandles(list, [bar]);
}
