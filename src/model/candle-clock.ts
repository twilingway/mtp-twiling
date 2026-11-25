import type { Timeframe } from "./types.js";

export interface TradingCalendarInterval {
  start: number;
  end: number;
}
export interface TradingCalendarDay {
  /** Trading date supplied by the exchange, normalized to UTC midnight. */
  date: number;
  isTradingDay: boolean;
  start: number | null;
  end: number | null;
  intervals: readonly TradingCalendarInterval[];
}
export interface CandleCalendarPeriod {
  start: number;
  end: number;
}
const minute = 60_000;
const intradayMinutes: Partial<Record<Timeframe, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60
};
export function candleDuration(timeframe: Timeframe): number | null {
  const minutes = intradayMinutes[timeframe];
  return minutes === undefined ? null : minutes * minute;
}
export function utcDate(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
export function shiftUtcDate(timestamp: number, days: number): number {
  const date = new Date(utcDate(timestamp));
  date.setUTCDate(date.getUTCDate() + days);
  return date.getTime();
}
/** Calendar periods use date arithmetic; future month/year periods can extend this boundary. */
export function candleCalendarPeriod(
  timestamp: number,
  timeframe: Timeframe
): CandleCalendarPeriod {
  let start = utcDate(timestamp);
  if (timeframe === "1w") start = shiftUtcDate(start, -((new Date(start).getUTCDay() + 6) % 7));
  return { start, end: shiftUtcDate(start, timeframe === "1w" ? 7 : 1) };
}
export function candleCloseAt(
  barTimestamp: number,
  timeframe: Timeframe,
  now: number,
  days: readonly TradingCalendarDay[]
): number | null {
  if (!Number.isFinite(barTimestamp) || !Number.isFinite(now) || barTimestamp > now) return null;
  const active = days.find(
    (day) =>
      day.isTradingDay &&
      day.intervals.some(
        (interval) =>
          Number.isFinite(interval.start) &&
          Number.isFinite(interval.end) &&
          interval.start <= now &&
          now < interval.end
      )
  );
  if (!active) return null;
  const duration = candleDuration(timeframe);
  if (duration !== null) {
    const nominalEnd = barTimestamp + duration;
    if (now >= nominalEnd) return null;
    const interval = active.intervals.find((item) => item.start <= now && now < item.end);
    if (!interval || nominalEnd <= interval.start) return null;
    // A clearing/auction pause gates visibility but does not finish an aligned candle.
    const end = Math.min(nominalEnd, active.end ?? Infinity);
    return end > now ? end : null;
  }
  const period = candleCalendarPeriod(barTimestamp, timeframe);
  if (active.date < period.start || active.date >= period.end) return null;
  const periodDays: TradingCalendarDay[] = [];
  // Past days cannot move the still-active candle's future close. The API only supplies today onward.
  for (let date = active.date; date < period.end; date = shiftUtcDate(date, 1)) {
    const day = days.find((item) => item.date === date);
    if (!day || (day.isTradingDay && (day.end === null || !Number.isFinite(day.end)))) return null;
    periodDays.push(day);
  }
  const closes = periodDays.flatMap((day) =>
    day.isTradingDay && day.end !== null ? [day.end] : []
  );
  const end = closes.length ? Math.max(...closes) : null;
  return end !== null && end > now ? end : null;
}
export function formatCountdown(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
  const days = Math.floor(seconds / 86400),
    hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60,
    rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days) return `${days}д ${pad(hours)}:${pad(minutes)}:${pad(rest)}`;
  if (hours) return `${pad(hours)}:${pad(minutes)}:${pad(rest)}`;
  return `${pad(minutes)}:${pad(rest)}`;
}
