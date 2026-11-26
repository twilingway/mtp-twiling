import { shiftTimeframe } from "../intervals/calendar.js";
import { isNativeIntervalId } from "../intervals/registry.js";
import type { IntervalId } from "../intervals/registry.js";
import type { HistoryRange } from "../types.js";
import { volume24Hours } from "./ta-batch-volume-flow-time.js";
import type { NumericSeries, TechnicalBar } from "./types.js";

export const TURNOVER_DAY = 86_400_000;
const MAX_LOWER_BARS = 6_000;
const lowerDuration = { "1m": 60_000, "5m": 300_000, "1h": 3_600_000 } as const;
export type TurnoverInterval = keyof typeof lowerDuration;

export interface QuoteTurnoverBar {
  readonly timestamp: number;
  readonly quoteTurnover: number;
}

export interface QuoteTurnoverHistory {
  readonly instrumentKey: string;
  readonly currency: string;
  readonly interval: TurnoverInterval;
  readonly range: HistoryRange;
  readonly bars: readonly QuoteTurnoverBar[];
}

export interface QuoteTurnoverSeries {
  readonly instrumentKey: string;
  readonly firstTimestamp: number;
  readonly observedAt: number;
  readonly interval: TurnoverInterval;
  readonly values: NumericSeries;
}

export type QuoteTurnoverHistoryRequirement = {
  readonly kind: "rolling-time-window";
  readonly lookbackBars: null;
  readonly windowMs: number;
  readonly seedPolicy: "complete-lower-candle-coverage";
  readonly convergence: "exact-after-complete-window";
};

export function turnoverInterval(timeframe: IntervalId): TurnoverInterval | undefined {
  switch (timeframe) {
    case "1d":
    case "1w":
      return "5m";
    case "1M":
      return "1h";
    case "3M":
    case "6M":
    case "12M":
    case "45m":
    case "3h":
      return undefined;
    default:
      return "1m";
  }
}

export function lowerTurnoverDuration(interval: TurnoverInterval): number {
  return lowerDuration[interval];
}

export function quoteTurnoverWindow(
  interval: TurnoverInterval,
  chartFrom: number,
  observedAt: number
): HistoryRange {
  const step = lowerDuration[interval];
  const to = Math.floor(observedAt / step) * step;
  const from = Math.max(
    0,
    Math.floor(chartFrom / step) * step - TURNOVER_DAY,
    to - (MAX_LOWER_BARS - 1) * step
  );
  return { from, to };
}

export function quoteTurnoverPageBudget(
  interval: TurnoverInterval,
  range: HistoryRange,
  pageSize: number
): number {
  const step = lowerDuration[interval];
  const count = (range.to - range.from) / step + 1;
  if (
    !Number.isSafeInteger(range.from) ||
    !Number.isSafeInteger(range.to) ||
    range.from < 0 ||
    range.from % step !== 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_LOWER_BARS
  )
    throw new RangeError("Invalid lower turnover range");
  return Math.ceil(count / pageSize) + 2;
}

export function compileQuoteTurnover(history: QuoteTurnoverHistory): QuoteTurnoverSeries {
  const { range, interval } = history;
  const step = lowerDuration[interval];
  quoteTurnoverPageBudget(interval, range, MAX_LOWER_BARS);
  const raw = new Map(
    history.bars
      .filter(({ timestamp }) => timestamp >= range.from && timestamp <= range.to)
      .map(({ timestamp, quoteTurnover }) => [timestamp, quoteTurnover])
  );
  // A missing lower candle is unknown, including a hole at the start of the range.
  const data = Array.from({ length: (range.to - range.from) / step + 1 }, (_, i) => {
    const timestamp = range.from + i * step;
    return { timestamp, volume: raw.get(timestamp) ?? null };
  });
  return {
    instrumentKey: history.instrumentKey,
    firstTimestamp: range.from,
    observedAt: range.to,
    interval,
    values: volume24Hours(data, { volumeUnit: "quote", coverageStart: range.from - step })
  };
}

export function readQuoteTurnover(
  samples: QuoteTurnoverSeries | undefined,
  bars: readonly TechnicalBar[],
  chartInterval: IntervalId | undefined
): NumericSeries {
  if (
    !samples ||
    chartInterval === undefined ||
    !isNativeIntervalId(chartInterval) ||
    turnoverInterval(chartInterval) !== samples.interval
  )
    return bars.map(() => null);
  const step = lowerDuration[samples.interval];
  return bars.map(({ timestamp }) => {
    if (timestamp > samples.observedAt) return null;
    const end = shiftTimeframe(timestamp, chartInterval, 1);
    const target = Math.min(samples.observedAt, Math.ceil(end / step) * step - step);
    const index = (target - samples.firstTimestamp) / step;
    return target < timestamp ? null : (samples.values[index] ?? null);
  });
}
