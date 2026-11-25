import { NATIVE_TIMEFRAME_CONFIG } from "./native-timeframes.js";
import type { NativeIntervalId } from "./registry.js";

export const utcMonthStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};
export function shiftUtcMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp);
  const first = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  const target = new Date(first);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  );
}
export function monthPosition(timestamp: number): number {
  const date = new Date(timestamp),
    start = utcMonthStart(timestamp),
    end = shiftUtcMonths(start, 1);
  return date.getUTCFullYear() * 12 + date.getUTCMonth() + (timestamp - start) / (end - start);
}
export function shiftTimeframe(
  timestamp: number,
  timeframe: NativeIntervalId,
  count: number
): number {
  const ms = NATIVE_TIMEFRAME_CONFIG[timeframe].ms;
  return ms === null ? shiftUtcMonths(timestamp, count) : timestamp + count * ms;
}
/** Keep full native monthly timestamps visible even for a short history lookback. */
export function historyRequestWindow<T extends { from: number; to: number }>(
  range: T,
  timeframe: NativeIntervalId
): T {
  if (timeframe !== "1M" || range.to <= range.from) return range;
  let from = utcMonthStart(range.from);
  // GetCandles can return no data when the requested span is shorter than one interval.
  if (shiftUtcMonths(from, 1) > range.to) from = shiftUtcMonths(from, -1);
  return { ...range, from };
}
export function historyWindowStart(
  until: number,
  rangeDays: number,
  timeframe: NativeIntervalId,
  warmupBars: number
): number {
  const lookback = Math.floor((until - rangeDays * 86_400_000) / 86_400_000) * 86_400_000;
  const warm =
    warmupBars > 0
      ? shiftTimeframe(lookback, timeframe, -Math.ceil(warmupBars * 1.65)) - 14 * 86_400_000
      : lookback;
  return historyRequestWindow(
    { from: Math.floor(warm / 86_400_000) * 86_400_000, to: until },
    timeframe
  ).from;
}
export function olderHistoryStart(until: number, timeframe: NativeIntervalId): number {
  if (timeframe === "1M") return shiftUtcMonths(utcMonthStart(until), -120);
  const days: Record<Exclude<NativeIntervalId, "1M">, number> = {
    "1m": 3,
    "2m": 3,
    "3m": 3,
    "5m": 14,
    "10m": 14,
    "15m": 30,
    "30m": 60,
    "1h": 120,
    "2h": 120,
    "4h": 120,
    "1d": 730,
    "1w": 1460
  };
  return until - days[timeframe] * 86_400_000;
}
