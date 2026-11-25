import { INTERVALS, isNativeIntervalId } from "./registry.js";
import type { NativeIntervalId, NativeInterval } from "./registry.js";

export interface NativeTimeframeConfig {
  interval: string;
  stream: string;
  /** null requires UTC calendar-month arithmetic, never a 30-day approximation. */
  ms: number | null;
  chunkDays: number | null;
  limit: number;
}
const minutes: Record<Exclude<NativeIntervalId, "1M">, number> = {
  "1m": 1,
  "2m": 2,
  "3m": 3,
  "5m": 5,
  "10m": 10,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "1d": 1440,
  "1w": 10080
};
const chunks: Record<Exclude<NativeIntervalId, "1M">, number> = {
  "1m": 1,
  "2m": 1,
  "3m": 1,
  "5m": 7,
  "10m": 7,
  "15m": 21,
  "30m": 21,
  "1h": 60,
  "2h": 60,
  "4h": 60,
  "1d": 1825,
  "1w": 1460
};
export const NATIVE_TIMEFRAMES: readonly NativeIntervalId[] = INTERVALS.flatMap((item) =>
  item.kind === "native" ? [item.id] : []
);
export const NATIVE_PERIOD_LABELS = Object.fromEntries(
  INTERVALS.filter((item): item is NativeInterval => item.kind === "native").map((item) => [
    item.id,
    item.shortLabel
  ])
) as Record<NativeIntervalId, string>;
export const NATIVE_TIMEFRAME_CONFIG = Object.fromEntries(
  INTERVALS.filter((item): item is NativeInterval => item.kind === "native").map((item) => [
    item.id,
    {
      interval: item.history.apiInterval,
      stream: item.stream.apiInterval,
      ms: item.id === "1M" ? null : minutes[item.id] * 60_000,
      chunkDays: item.id === "1M" ? null : chunks[item.id],
      limit: item.history.maxCandles
    }
  ])
) as Record<NativeIntervalId, NativeTimeframeConfig>;

export const DERIVED_INTERVAL_UNAVAILABLE = {
  "45m": "Пока недоступно. Выберите 15 или 30 минут.",
  "3h": "Пока недоступно. Выберите 1, 2 или 4 часа.",
  "3M": "Пока доступен интервал 1 месяц.",
  "6M": "Пока доступен интервал 1 месяц.",
  "12M": "Пока доступен интервал 1 месяц."
} as const;
export function nativeTimeframe(value: unknown): NativeIntervalId {
  if (!isNativeIntervalId(value))
    throw new RangeError("Интервал пока не подключён к источнику данных.");
  return value;
}
