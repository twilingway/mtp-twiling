import { civilClock, DAY_MS, timestampIsValid } from "./ta-batch-sessions-calendar.js";
import { finiteOrNull } from "./primitives.js";
import type { NumericValue, TechnicalBar } from "./types.js";

type DailyClose = Pick<TechnicalBar, "timestamp" | "close">;

export interface PerformanceSymbol {
  readonly symbol: string;
  readonly timeZone: string;
  readonly dailyBars: readonly DailyClose[];
}

export interface PerformanceCell {
  readonly timeframe: string;
  readonly percent: NumericValue;
  readonly anchorTimestamp: number | null;
  readonly anchorClose: NumericValue;
}

export interface PerformanceRow {
  readonly symbol: string;
  readonly cells: readonly PerformanceCell[];
}

type PerformancePeriod = { unit: "D" | "W" | "M" | "Y" | "YTD"; count: number };

function parsePeriod(timeframe: string): PerformancePeriod {
  if (timeframe === "YTD") return { unit: "YTD", count: 1 };
  const match = /^([1-9]\d{0,3})?([DWMY])$/.exec(timeframe);
  if (!match) throw new RangeError("Invalid performance timeframe");
  return { unit: match[2]! as PerformancePeriod["unit"], count: Number(match[1] ?? 1) };
}

function anchorKey(latest: number, { unit, count }: PerformancePeriod): number {
  if (unit === "D" || unit === "W") return latest - count * DAY_MS * (unit === "W" ? 7 : 1);
  const date = new Date(latest);
  if (unit === "YTD") {
    date.setUTCMonth(0, 1);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() - count * (unit === "Y" ? 12 : 1), 1);
  const endOfMonth = new Date(date);
  endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, endOfMonth.getUTCDate()));
  return date.getTime();
}

function lastAtOrBefore(keys: readonly number[], target: number): number {
  if (!Number.isFinite(target)) return -1;
  let start = 0;
  let end = keys.length;
  while (start < end) {
    const mid = Math.floor((start + end) / 2);
    if (keys[mid]! <= target) start = mid + 1;
    else end = mid;
  }
  return start - 1;
}

export function performanceTable(
  symbols: readonly PerformanceSymbol[],
  timeframes: readonly string[]
): PerformanceRow[] {
  const columns = timeframes.map((timeframe) => {
    const label = timeframe.trim().toUpperCase();
    return { label, period: parsePeriod(label) };
  });
  return symbols.map(({ symbol, timeZone, dailyBars }) => {
    const clock = civilClock(timeZone);
    const utcKeys: number[] = [];
    const civilKeys: number[] = [];
    for (const { timestamp, close } of dailyBars) {
      if (
        !timestampIsValid(timestamp) ||
        timestamp <= (utcKeys.at(-1) ?? -Infinity) ||
        (close !== null && !Number.isFinite(close))
      )
        throw new RangeError("Daily bars must be ordered with finite or missing closes");
      const local = clock(timestamp);
      if (!timestampIsValid(local) || local <= (civilKeys.at(-1) ?? -Infinity))
        throw new RangeError("Daily bar calendar opening times must be ordered");
      utcKeys.push(timestamp);
      civilKeys.push(local);
    }
    const latest = dailyBars.at(-1);
    const cells = columns.map(({ label, period }) => {
      const keys = period.unit === "D" || period.unit === "W" ? utcKeys : civilKeys;
      const past = latest
        ? dailyBars[lastAtOrBefore(keys, anchorKey(keys.at(-1)!, period))]
        : undefined;
      const anchorClose = past?.close ?? null;
      const close = latest?.close ?? null;
      const percent =
        close === null || anchorClose === null || anchorClose === 0
          ? null
          : finiteOrNull(((close - anchorClose) / anchorClose) * 100);
      return { timeframe: label, percent, anchorTimestamp: past?.timestamp ?? null, anchorClose };
    });
    return { symbol, cells };
  });
}
