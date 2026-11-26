import { shiftUtcMonths, utcMonthStart } from "../../intervals/calendar.js";
import { NATIVE_TIMEFRAME_CONFIG } from "../../intervals/native-timeframes.js";
import { getInterval, type IntervalId } from "../../intervals/registry.js";
import { DAY_MS, MINUTE_MS } from "../ta-batch-sessions-calendar.js";
import type { BookerObservedPeriod } from "../ta-batch-booker-pivots.js";
import type { NumericValue, TechnicalBar, TechnicalCalculationContext } from "../types.js";

const WEEK = 7 * DAY_MS;
const MONDAY = 4 * DAY_MS;
const duration = {
  "1h": 60 * MINUTE_MS,
  "4h": 240 * MINUTE_MS,
  "8h": 480 * MINUTE_MS,
  "1d": DAY_MS,
  "1w": WEEK
} as const;
export type BookerPeriodId = keyof typeof duration | "1M";

export interface BookerPeriodObservations {
  readonly periods: readonly BookerObservedPeriod[];
  /** Calendar opening supplied by the provider for the projected period. */
  readonly nextStart?: number;
}

export type BookerPeriodData = Readonly<Partial<Record<BookerPeriodId, BookerPeriodObservations>>>;

type ChartStep = number | "calendar-month";

function chartStep(intervalId: IntervalId): ChartStep | null {
  const interval = getInterval(intervalId);
  if (interval.kind === "native")
    return NATIVE_TIMEFRAME_CONFIG[interval.id].ms ?? "calendar-month";
  return interval.minutes === undefined ? null : interval.minutes * MINUTE_MS;
}

function continuousStep(
  period: BookerPeriodId,
  context?: TechnicalCalculationContext
): ChartStep | null {
  if (!context?.continuousSession || context.exchangeTimeZone !== "UTC" || !context.chartInterval)
    return null;
  const step = chartStep(context.chartInterval);
  if (step === null) return null;
  if (period === "1M") return step === "calendar-month" || DAY_MS % step === 0 ? step : null;
  return step !== "calendar-month" && duration[period] % step === 0 ? step : null;
}

export function canReadBookerPeriods(
  period: BookerPeriodId,
  context?: TechnicalCalculationContext
): boolean {
  return (
    context?.bookerPivotPeriods?.[period] !== undefined || continuousStep(period, context) !== null
  );
}

function periodBounds(timestamp: number, period: BookerPeriodId) {
  if (period === "1M") {
    const start = utcMonthStart(timestamp);
    return { start, end: shiftUtcMonths(start, 1) };
  }
  const size = duration[period];
  const epoch = period === "1w" ? MONDAY : 0;
  const start = Math.floor((timestamp - epoch) / size) * size + epoch;
  return { start, end: start + size };
}

function firstBarAtOrAfter(bars: readonly TechnicalBar[], timestamp: number): number {
  let first = 0,
    last = bars.length;
  while (first < last) {
    const mid = Math.floor((first + last) / 2);
    if (bars[mid]!.timestamp < timestamp) first = mid + 1;
    else last = mid;
  }
  return first;
}

interface Bucket {
  start: number;
  end: number;
  followsPrevious: boolean;
  nextBar: number;
  contiguous: boolean;
  high: NumericValue;
  low: NumericValue;
  close: NumericValue;
  ranges: { low: number; high: number }[];
}

function completed(bucket: Bucket, closes: boolean): BookerObservedPeriod {
  const coverageComplete = bucket.contiguous && (!closes || bucket.nextBar === bucket.end);
  return {
    start: bucket.start,
    end: bucket.end,
    followsPrevious: bucket.followsPrevious,
    closed: closes && coverageComplete,
    high: bucket.high,
    low: bucket.low,
    close: bucket.close,
    observedRanges: bucket.ranges,
    coverageComplete
  };
}

/** Use an explicit trading calendar when provided. Derive only aligned UTC periods from 24/7 feeds. */
export function bookerPeriodObservations(
  bars: readonly TechnicalBar[],
  period: BookerPeriodId,
  count: number,
  captureTouches: boolean,
  context?: TechnicalCalculationContext
): BookerPeriodObservations | null {
  const supplied = context?.bookerPivotPeriods?.[period];
  if (supplied) return { ...supplied, periods: supplied.periods.slice(-count) };
  const step = continuousStep(period, context);
  if (step === null) return null;
  const last = bars.at(-1);
  if (!last) return { periods: [] };
  const tailStart = periodBounds(last.timestamp, period).start;
  const earliest =
    period === "1M"
      ? shiftUtcMonths(tailStart, 1 - count)
      : tailStart - (count - 1) * duration[period];
  const periods: BookerObservedPeriod[] = [];
  let bucket: Bucket | undefined;
  for (let index = firstBarAtOrAfter(bars, earliest); index < bars.length; index++) {
    const { timestamp, high, low, close } = bars[index]!;
    const bounds = periodBounds(timestamp, period);
    if (bounds.start < 0) continue;
    const barEnd = step === "calendar-month" ? shiftUtcMonths(timestamp, 1) : timestamp + step;
    if (!bucket || bucket.start !== bounds.start) {
      const followsPrevious = bucket === undefined || bucket.end === bounds.start;
      if (bucket) periods.push(completed(bucket, true));
      bucket = {
        ...bounds,
        followsPrevious,
        nextBar: bounds.start,
        contiguous: true,
        high: null,
        low: null,
        close: null,
        ranges: []
      };
    }
    bucket.contiguous &&= timestamp === bucket.nextBar && barEnd <= bucket.end;
    bucket.nextBar = barEnd;
    if (high === null || low === null || close === null) {
      bucket.contiguous = false;
      bucket.close = null;
      continue;
    }
    bucket.close = close;
    bucket.high = Math.max(bucket.high ?? high, high);
    bucket.low = Math.min(bucket.low ?? low, low);
    if (captureTouches) bucket.ranges.push({ high, low });
  }
  if (!bucket) return { periods };
  const closedTail = context?.lastBarClosed === true && bucket.nextBar === bucket.end;
  periods.push(completed(bucket, closedTail));
  return { periods, nextStart: bucket.end };
}
