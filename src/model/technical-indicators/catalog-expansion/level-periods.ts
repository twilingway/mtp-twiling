import { INTERVALS, type IntervalId } from "../../intervals/registry.js";
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

export type PriceLevelInterval = "1d" | "1w" | "1M" | "3M" | "6M" | "12M";
export type PriceLevelTimeframe = "auto" | PriceLevelInterval;

/** One independently fetched feed interval, with an actual preceding trading period if available. */
export interface PriceLevelHistoryRequest {
  readonly interval: PriceLevelInterval;
  /** Chart timestamps to cover. The loader determines the actual containing source periods. */
  readonly from: number;
  readonly to: number;
  readonly precedingTradingPeriods: 1;
}

export function priceLevelHistoryRequest(
  chartInterval: IntervalId,
  timeframe: PriceLevelTimeframe,
  chartTimestamps: readonly number[],
  study: "standard-pivots" | "multi-time-period"
): PriceLevelHistoryRequest | null {
  const from = chartTimestamps[0];
  const to = chartTimestamps.at(-1);
  if (from === undefined || to === undefined) return null;

  const interval =
    timeframe !== "auto"
      ? timeframe
      : study === "standard-pivots"
        ? autoStandardPivotInterval(chartInterval)
        : autoMultiTimePeriodInterval(chartInterval);
  const chartIndex = INTERVALS.findIndex(({ id }) => id === chartInterval);
  const targetIndex = INTERVALS.findIndex(({ id }) => id === interval);
  if (targetIndex < chartIndex) return null;
  return { interval, from, to, precedingTradingPeriods: 1 };
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
function chartSpan(
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
}

const MAX_PIVOT_LINES = 500;

/** Draw separate runs so a new level never appears as a slope from the preceding period. */
export function standardPivotRegions(
  chartTimestamps: readonly number[],
  sourcePeriods: readonly PricePeriod[],
  { method, periodsBack, showLabels, showPrices }: StandardPivotDisplay
): TechnicalPriceRegion[] {
  if (!Number.isInteger(periodsBack) || periodsBack < 1 || periodsBack > MAX_PIVOT_LINES)
    throw new RangeError("Pivot periods back must be an integer in 1..500");

  const periods = standardPivotPoints(sourcePeriods, method).flatMap((period) => {
    const span = chartSpan(chartTimestamps, period);
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
              }
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
  return multiTimePeriodBoxes(sourcePeriods, mode).flatMap((box) => {
    const span = chartSpan(chartTimestamps, box);
    return span
      ? [{ ...span, styleId: `${box.kind}-${box.direction}`, low: box.bottom, high: box.top }]
      : [];
  });
}
