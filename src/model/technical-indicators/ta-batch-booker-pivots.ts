import { assertLength } from "./primitives.js";
import type { NumericValue } from "./types.js";

export const BOOKER_INTRADAY_MINUTES = [60, 240, 480] as const;
export const BOOKER_MISSED_PERIODS = ["day", "week", "month"] as const;
export const BOOKER_ZIV_PERIODS = [240, 480, "week", "month"] as const;

export interface BookerPivotPeriod {
  readonly start: number;
  readonly end: number;
  readonly closed: boolean;
  readonly high: NumericValue;
  readonly low: NumericValue;
  readonly close: NumericValue;
}

interface BookerPriceRange {
  readonly low: number;
  readonly high: number;
}

export interface BookerObservedPeriod extends BookerPivotPeriod {
  readonly observedRanges: readonly BookerPriceRange[];
  readonly coverageComplete: boolean;
}

export interface BookerPivotLevel {
  readonly start: number;
  readonly end: number;
  readonly value: number;
}

export interface BookerMissedLevel extends BookerPivotLevel {
  readonly status: "touched" | "missed" | "unconfirmed";
}

function assertPeriods(periods: readonly BookerPivotPeriod[]): void {
  let previousEnd = 0;
  for (const { start, end, high, low, close } of periods) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end <= start)
      throw new RangeError("Pivot periods must be ordered and nonoverlapping");
    if ([high, low, close].some((value) => value !== null && !Number.isFinite(value)))
      throw new RangeError("Pivot prices must be finite or null");
    if (high !== null && low !== null && low > high) throw new RangeError("Invalid pivot range");
    if (close !== null && ((high !== null && close > high) || (low !== null && close < low)))
      throw new RangeError("Closing price outside pivot range");
    previousEnd = end;
  }
}

function classicCenter({ high, low, close }: BookerPivotPeriod): NumericValue {
  if (high === null || low === null || close === null) return null;
  const sum = high + low + close;
  if (Number.isFinite(sum)) return sum / 3;
  const scale = Math.max(Math.abs(high), Math.abs(low), Math.abs(close));
  return ((high / scale + low / scale + close / scale) / 3) * scale;
}

export function classicPreviousPeriodPivots(
  periods: readonly BookerPivotPeriod[],
  lookback: number
): BookerPivotLevel[] {
  assertLength(lookback);
  assertPeriods(periods);
  const result: BookerPivotLevel[] = [];
  for (let index = Math.max(1, periods.length - lookback); index < periods.length; index++) {
    const previous = periods[index - 1]!;
    const { start, end } = periods[index]!;
    if (!previous.closed) continue;
    const value = classicCenter(previous);
    if (value !== null) result.push({ start, end, value });
  }
  return result;
}

export function projectClassicNextPivot(
  period: BookerPivotPeriod,
  nextStart: number
): { timestamp: number; value: number } | null {
  assertPeriods([period]);
  if (!Number.isFinite(nextStart) || nextStart < period.end)
    throw new RangeError("A projected pivot starts in the next period");
  const value = classicCenter(period);
  return value === null ? null : { timestamp: nextStart, value };
}

export function classicMissedPivots(
  periods: readonly BookerObservedPeriod[],
  lookback: number
): BookerMissedLevel[] {
  const levels = classicPreviousPeriodPivots(periods, lookback);
  const indices = new Map(periods.map(({ start }, index) => [start, index]));
  for (const period of periods)
    for (const { low, high } of period.observedRanges)
      if (!Number.isFinite(low) || !Number.isFinite(high) || low > high)
        throw new RangeError("Invalid observed price range");
  return levels.map((level) => {
    const index = indices.get(level.start)!;
    let confirmed = periods[index]!.closed;
    for (let later = index; later < periods.length; later++) {
      const { coverageComplete, observedRanges } = periods[later]!;
      if (observedRanges.some(({ low, high }) => low <= level.value && level.value <= high))
        return { ...level, status: "touched" };
      confirmed &&= coverageComplete && observedRanges.length > 0;
    }
    return { ...level, status: confirmed ? "missed" : "unconfirmed" };
  });
}
