import { candleCalendarPeriod } from "../../candle-clock.js";
import type { CandleCalendarPeriod } from "../../candle-clock.js";
import { mergeCandles, subtractRanges } from "../../history-codec.js";
import { aggregateCalendarMonths } from "../../intervals/aggregate.js";
import { shiftUtcMonths } from "../../intervals/calendar.js";
import { INTERVALS, type IntervalId } from "../../intervals/registry.js";
import type { Candle, HistoryRange } from "../../types.js";
import {
  autoMultiTimePeriodInterval,
  autoStandardPivotInterval,
  multiTimePeriodBoxes,
  standardPivotPoints
} from "../ta-batch-pivots-periods.js";
import type {
  MultiTimePeriodMode,
  PricePeriod,
  StandardPivotMethod
} from "../ta-batch-pivots-periods.js";
import type { TechnicalPriceRegion } from "./calendar-geometry.js";
import type { TechnicalBar } from "../types.js";

export type PriceLevelInterval = "1d" | "1w" | "1M" | "3M" | "6M" | "12M";
export type PriceLevelTimeframe = "auto" | PriceLevelInterval;
export type NativePriceLevelInterval = "1d" | "1w" | "1M";
export type PriceLevelVenue = "bybit" | "okx" | "tbank";
export type PriceLevelPeriodData = Partial<Record<PriceLevelInterval, readonly PricePeriod[]>>;

const dayMs = 86_400_000;

function groupedMonths(interval: PriceLevelInterval): 3 | 6 | 12 | null {
  if (interval === "3M") return 3;
  if (interval === "6M") return 6;
  if (interval === "12M") return 12;
  return null;
}

export function nativePriceLevelInterval(interval: PriceLevelInterval): NativePriceLevelInterval {
  return interval === "1d" || interval === "1w" ? interval : "1M";
}

export function priceLevelCalendarPeriod(
  timestamp: number,
  interval: PriceLevelInterval
): CandleCalendarPeriod {
  const months = groupedMonths(interval);
  if (months === null) return candleCalendarPeriod(timestamp, nativePriceLevelInterval(interval));
  const date = new Date(timestamp);
  const start = Date.UTC(
    date.getUTCFullYear(),
    Math.floor(date.getUTCMonth() / months) * months,
    1
  );
  return { start, end: shiftUtcMonths(start, months) };
}

export function shiftPriceLevelCalendarStart(
  start: number,
  interval: PriceLevelInterval,
  count: number
): number {
  if (interval === "1d" || interval === "1w") {
    return start + count * dayMs * (interval === "1w" ? 7 : 1);
  }
  return shiftUtcMonths(start, count * (groupedMonths(interval) ?? 1));
}

interface PriceLevelNormalization {
  readonly venue: PriceLevelVenue;
  readonly asOf: number;
  readonly coveredRanges?: readonly HistoryRange[];
  /** When the venue supplies a more precise trading-session boundary, use it for chart projection. */
  readonly sessionBounds?: ReadonlyMap<number, CandleCalendarPeriod>;
}

function isNativePriceCandle(candle: Candle): boolean {
  return (
    Number.isSafeInteger(candle.timestamp) &&
    candle.timestamp >= 0 &&
    [candle.open, candle.close, candle.high, candle.low, candle.volume].every(Number.isFinite) &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.volume >= 0
  );
}

function canonicalCandles(
  candles: readonly Candle[],
  interval: NativePriceLevelInterval,
  { venue, asOf }: PriceLevelNormalization
): Candle[] {
  const canonical: Candle[] = [];
  for (const bar of candles) {
    if (!isNativePriceCandle(bar)) throw new RangeError("Invalid native period candle");
    if (bar.timestamp > asOf) continue;
    const { start } = priceLevelCalendarPeriod(bar.timestamp, interval);
    if (venue !== "tbank" && bar.timestamp !== start)
      throw new RangeError("Expected a candle from the UTC provider series");
    canonical.push({ ...bar, timestamp: start });
  }
  return mergeCandles(canonical);
}

function requestedThrough(from: number, to: number, coverage: readonly HistoryRange[]): boolean {
  return from >= to || subtractRanges(from, to, coverage).length === 0;
}

function completeMonthGroups(
  monthly: readonly Candle[],
  months: 3 | 6 | 12,
  asOf: number
): Candle[] {
  const known = new Set(monthly.map(({ timestamp }) => timestamp));
  return aggregateCalendarMonths(monthly, months, { asOf }).filter((group) => {
    if (group.endTimestamp <= asOf) return group.isComplete;
    // The developing quarter/year may omit its still-open month but cannot start mid-period.
    if (!known.has(group.timestamp)) return false;
    for (let index = 1; index < months; index++) {
      const month = shiftUtcMonths(group.timestamp, index);
      if (shiftUtcMonths(month, 1) > asOf) break;
      if (!known.has(month)) return false;
    }
    return true;
  });
}

/** Retain actual provider prices, and only link periods across a proved venue schedule gap. */
export function normalizePriceLevelPeriods(
  candles: readonly Candle[],
  interval: PriceLevelInterval,
  options: PriceLevelNormalization
): PricePeriod[] {
  const { asOf, venue, coveredRanges = [], sessionBounds } = options;
  if (!Number.isSafeInteger(asOf) || asOf < 0) throw new RangeError("Invalid period read time");
  const native = canonicalCandles(candles, nativePriceLevelInterval(interval), options);
  const months = groupedMonths(interval);
  const source = months === null ? native : completeMonthGroups(native, months, asOf);
  let previousNominal: CandleCalendarPeriod | undefined;
  let previousEnd = -Infinity;
  return source.map(({ timestamp, open, high, low, close }) => {
    const nominal = priceLevelCalendarPeriod(timestamp, interval);
    const { start, end } = sessionBounds?.get(timestamp) ?? nominal;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < previousEnd ||
      end <= start
    )
      throw new RangeError("Invalid venue period boundaries");
    const followsPrevious =
      previousNominal !== undefined &&
      (previousNominal.end === nominal.start ||
        (months === null &&
          venue === "tbank" &&
          requestedThrough(previousNominal.end, nominal.start, coveredRanges)));
    previousNominal = nominal;
    previousEnd = end;
    return { startsAt: start, endsAt: end, open, high, low, close, followsPrevious };
  });
}

/** One independently fetched feed interval, with an actual preceding trading period if available. */
export interface PriceLevelHistoryRequest {
  readonly interval: PriceLevelInterval;
  /** Chart timestamps to cover. The loader determines the actual containing source periods. */
  readonly from: number;
  readonly to: number;
  readonly precedingTradingPeriods: number;
}

export type PriceLevelStudyKind = "standard-pivots" | "multi-time-period";

export function resolvePriceLevelInterval(
  chartInterval: IntervalId,
  timeframe: PriceLevelTimeframe,
  study: PriceLevelStudyKind
): PriceLevelInterval | null {
  const automatic =
    study === "standard-pivots"
      ? autoStandardPivotInterval(chartInterval)
      : autoMultiTimePeriodInterval(chartInterval);
  const interval = timeframe === "auto" ? automatic : timeframe;
  const chartIndex = INTERVALS.findIndex(({ id }) => id === chartInterval);
  const targetIndex = INTERVALS.findIndex(({ id }) => id === interval);
  return targetIndex < chartIndex ? null : interval;
}

export function priceLevelHistoryRequest(
  chartInterval: IntervalId,
  timeframe: PriceLevelTimeframe,
  chartTimestamps: readonly number[],
  study: PriceLevelStudyKind
): PriceLevelHistoryRequest | null {
  const from = chartTimestamps[0];
  const to = chartTimestamps.at(-1);
  if (from === undefined || to === undefined) return null;

  const interval = resolvePriceLevelInterval(chartInterval, timeframe, study);
  return interval ? { interval, from, to, precedingTradingPeriods: 1 } : null;
}

function firstAtOrAfter(timestamps: readonly number[], boundary: number): number {
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestamps[middle]! < boundary) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Clip a source period to whole chart slots contained in its half-open time window. */
export function priceLevelChartSpan(
  timestamps: readonly number[],
  { startsAt, endsAt }: Pick<PricePeriod, "startsAt" | "endsAt">
) {
  const first = firstAtOrAfter(timestamps, startsAt);
  const end = firstAtOrAfter(timestamps, endsAt);
  if (first === end) return null;
  return {
    startTimestamp: timestamps[first]!,
    endTimestamp: timestamps[end - 1]!,
    startEdge: "left" as const,
    endEdge: "right" as const
  };
}

export interface StandardPivotDisplay {
  readonly method: StandardPivotMethod;
  readonly periodsBack: number;
  readonly showLabels: boolean;
  readonly showPrices: boolean;
  readonly labelSide?: "left" | "right";
}

const MAX_PIVOT_LINES = 500;

/** Draw separate runs so a new level never appears as a slope from the preceding period. */
export function standardPivotRegions(
  chartTimestamps: readonly number[],
  sourcePeriods: readonly PricePeriod[],
  { method, periodsBack, showLabels, showPrices, labelSide }: StandardPivotDisplay
): TechnicalPriceRegion[] {
  if (!Number.isInteger(periodsBack) || periodsBack < 1 || periodsBack > MAX_PIVOT_LINES)
    throw new RangeError("Pivot periods back must be an integer in 1..500");

  const periods = standardPivotPoints(sourcePeriods, method).flatMap((period) => {
    const span = priceLevelChartSpan(chartTimestamps, period);
    return span ? [{ ...span, levels: period.levels }] : [];
  });

  const visiblePeriods: TechnicalPriceRegion[][] = [];
  let remainingLines = MAX_PIVOT_LINES;
  for (const { levels, ...span } of periods.slice(-periodsBack).reverse()) {
    const entries = Object.entries(levels);
    if (entries.length > remainingLines) break;
    remainingLines -= entries.length;
    visiblePeriods.push(
      entries.map(([styleId, price]) => ({
        ...span,
        styleId,
        low: price,
        high: price,
        ...(showLabels || showPrices
          ? {
              label: {
                ...(showLabels ? { name: styleId } : {}),
                ...(showPrices ? { price } : {})
              },
              ...(labelSide ? { labelEdge: labelSide } : {})
            }
          : {})
      }))
    );
  }
  return visiblePeriods.reverse().flat();
}

export function multiTimePeriodRegions(
  chartTimestamps: readonly number[],
  sourcePeriods: readonly PricePeriod[],
  mode: MultiTimePeriodMode
): TechnicalPriceRegion[] {
  const boxesPerPeriod = mode === "ohlc" ? 2 : 1;
  return multiTimePeriodBoxes(sourcePeriods, mode)
    .flatMap((box) => {
      const span = priceLevelChartSpan(chartTimestamps, box);
      return span
        ? [{ ...span, styleId: `${box.kind}-${box.direction}`, low: box.bottom, high: box.top }]
        : [];
    })
    .slice(-Math.floor(500 / boxesPerPeriod) * boxesPerPeriod);
}

/** Derive HTF prices only from observed chart bars once their containing period start is covered. */
export function chartPriceLevelPeriods(
  bars: readonly TechnicalBar[],
  periodBounds: readonly PricePeriod[]
): PricePeriod[] {
  const firstTimestamp = bars[0]?.timestamp;
  if (firstTimestamp === undefined) return [];
  const timestamps = bars.map(({ timestamp }) => timestamp);
  const result: PricePeriod[] = [];
  let previousRendered = false;
  for (const { startsAt, endsAt, followsPrevious } of periodBounds) {
    const connected = previousRendered && followsPrevious !== false;
    previousRendered = false;
    if (startsAt < firstTimestamp) continue;
    const first = firstAtOrAfter(timestamps, startsAt);
    const end = firstAtOrAfter(timestamps, endsAt);
    if (first === end) continue;
    const open = bars[first]!.open;
    const close = bars[end - 1]!.close;
    if (open === null || close === null) continue;
    let high = -Infinity;
    let low = Infinity;
    for (let index = first; index < end; index++) {
      const bar = bars[index]!;
      if (bar.high === null || bar.low === null) {
        high = Infinity;
        break;
      }
      high = Math.max(high, bar.high);
      low = Math.min(low, bar.low);
    }
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    result.push({
      startsAt,
      endsAt,
      open,
      high,
      low,
      close,
      followsPrevious: connected
    });
    previousRendered = true;
  }
  return result;
}

export function heikinAshiPriceLevelPeriods(source: readonly PricePeriod[]): PricePeriod[] {
  const result: PricePeriod[] = [];
  let previous: { open: number; close: number } | null = null;
  for (const period of source) {
    const { open, high, low, close } = period;
    if (open === null || high === null || low === null || close === null) {
      previous = null;
      continue;
    }
    const preceding: { open: number; close: number } | null =
      period.followsPrevious === false ? null : previous;
    const haOpen: number = preceding
      ? preceding.open / 2 + preceding.close / 2
      : open / 2 + close / 2;
    const haClose = open / 4 + high / 4 + low / 4 + close / 4;
    previous = { open: haOpen, close: haClose };
    result.push({
      ...period,
      open: haOpen,
      close: haClose,
      high: Math.max(high, haOpen, haClose),
      low: Math.min(low, haOpen, haClose),
      followsPrevious: preceding !== null
    });
  }
  return result;
}
