import { getInterval, type IntervalId } from "../intervals/registry.js";
import { assertPriceRange } from "./ta-batch-pivots.js";
import type { TechnicalBar } from "./types.js";

export interface PricePeriod extends Pick<TechnicalBar, "open" | "high" | "low" | "close"> {
  /** Caller-supplied boundaries in UTC milliseconds, end exclusive. */
  readonly startsAt: number;
  readonly endsAt: number;
  /** False when the caller knows the preceding market period is missing. */
  readonly followsPrevious?: boolean;
}

export type StandardPivotMethod =
  "traditional" | "fibonacci" | "woodie" | "classic" | "dm" | "camarilla";

type LevelId = "P" | "R1" | "S1" | "R2" | "S2" | "R3" | "S3" | "R4" | "S4" | "R5" | "S5";
type PivotLevels = Partial<Record<LevelId, number>>;
type Bounds = Pick<PricePeriod, "startsAt" | "endsAt">;

export interface StandardPivotLevels extends Bounds {
  readonly levels: Readonly<PivotLevels>;
}

export type MultiTimePeriodMode = "high-low" | "open-close" | "ohlc" | "true-range";
export interface MultiTimePeriodBox extends Bounds {
  readonly kind: Exclude<MultiTimePeriodMode, "ohlc">;
  readonly top: number;
  readonly bottom: number;
  readonly direction: "up" | "down";
}

export function autoStandardPivotInterval(chartInterval: IntervalId): "1d" | "1w" | "1M" {
  const { group } = getInterval(chartInterval);
  if (group === "days") return "1M";
  if (group === "minutes" && Number.parseInt(chartInterval, 10) <= 15) return "1d";
  return "1w";
}

export function autoMultiTimePeriodInterval(
  chartInterval: IntervalId
): "1d" | "1w" | "1M" | "3M" | "12M" {
  if (getInterval(chartInterval).group !== "days") return "1d";
  switch (chartInterval) {
    case "1d":
      return "1w";
    case "1w":
      return "1M";
    case "1M":
      return "3M";
    default:
      return "12M";
  }
}

function validatePeriods(periods: readonly PricePeriod[]): void {
  let lastEnd = -Infinity;
  for (const period of periods) {
    assertPriceRange(period);
    if (
      !Number.isSafeInteger(period.startsAt) ||
      !Number.isSafeInteger(period.endsAt) ||
      period.startsAt < lastEnd ||
      period.startsAt >= period.endsAt
    ) {
      throw new RangeError("Expected chronological, non-overlapping price periods");
    }
    if (
      (period.open !== null && !Number.isFinite(period.open)) ||
      (period.close !== null && !Number.isFinite(period.close))
    ) {
      throw new RangeError("Expected finite opening and closing prices or null");
    }
    lastEnd = period.endsAt;
  }
}

function pivotsForPeriod(
  previous: PricePeriod,
  current: PricePeriod,
  method: StandardPivotMethod
): PivotLevels {
  const { high, low, close, open } = previous;
  if (high === null || low === null) return {};
  const range = high - low;
  if (method === "woodie") {
    if (current.open === null) return {};
    const point = (high + low + 2 * current.open) / 4;
    const resistance = high + 2 * (point - low);
    const support = low - 2 * (high - point);
    return {
      P: point,
      R1: 2 * point - low,
      S1: 2 * point - high,
      R2: point + range,
      S2: point - range,
      R3: resistance,
      S3: support,
      R4: resistance + range,
      S4: support - range
    };
  }
  if (close === null) return {};
  const point = (high + low + close) / 3;
  switch (method) {
    case "traditional":
      return {
        P: point,
        R1: 2 * point - low,
        S1: 2 * point - high,
        R2: point + range,
        S2: point - range,
        R3: high + 2 * (point - low),
        S3: low + 2 * (point - high),
        R4: high + 3 * (point - low),
        S4: low + 3 * (point - high),
        R5: high + 4 * (point - low),
        S5: low + 4 * (point - high)
      };
    case "fibonacci":
      return {
        P: point,
        R1: point + 0.382 * range,
        S1: point - 0.382 * range,
        R2: point + 0.618 * range,
        S2: point - 0.618 * range,
        R3: point + range,
        S3: point - range
      };
    case "classic":
      return {
        P: point,
        R1: 2 * point - low,
        S1: 2 * point - high,
        R2: point + range,
        S2: point - range,
        R3: point + 2 * range,
        S3: point - 2 * range,
        R4: point + 3 * range,
        S4: point - 3 * range
      };
    case "dm": {
      if (open === null) return {};
      const weighted = high + low + close + (close === open ? close : close > open ? high : low);
      return { P: weighted / 4, R1: weighted / 2 - low, S1: weighted / 2 - high };
    }
    case "camarilla": {
      const adjustment = 1.1 * range;
      const outer = low === 0 ? null : (high / low) * close;
      return {
        P: point,
        R1: close + adjustment / 12,
        S1: close - adjustment / 12,
        R2: close + adjustment / 6,
        S2: close - adjustment / 6,
        R3: close + adjustment / 4,
        S3: close - adjustment / 4,
        R4: close + adjustment / 2,
        S4: close - adjustment / 2,
        ...(outer === null ? {} : { R5: outer, S5: 2 * close - outer })
      };
    }
  }
}

/** The final, open period may supply only its bounds and open. */
export function standardPivotPoints(
  periods: readonly PricePeriod[],
  method: StandardPivotMethod
): StandardPivotLevels[] {
  validatePeriods(periods);
  const result: StandardPivotLevels[] = [];
  for (let index = 1; index < periods.length; index++) {
    const current = periods[index]!;
    if (current.followsPrevious === false) continue;
    const previous = periods[index - 1]!;
    const levels = pivotsForPeriod(previous, current, method);
    for (const name of Object.keys(levels) as LevelId[]) {
      if (!Number.isFinite(levels[name])) delete levels[name];
    }
    if (Object.keys(levels).length > 0) {
      result.push({ startsAt: current.startsAt, endsAt: current.endsAt, levels });
    }
  }
  return result;
}

/** Prices can be ordinary OHLC or already-transformed higher-timeframe Heikin Ashi OHLC. */
export function multiTimePeriodBoxes(
  periods: readonly PricePeriod[],
  mode: MultiTimePeriodMode
): MultiTimePeriodBox[] {
  validatePeriods(periods);
  const result: MultiTimePeriodBox[] = [];
  for (const [index, period] of periods.entries()) {
    const { open, high, low, close, startsAt, endsAt } = period;
    if (open === null || close === null) continue;
    const direction = close < open ? "down" : "up";
    const bounds = { startsAt, endsAt, direction } as const;
    if ((mode === "high-low" || mode === "ohlc") && high !== null && low !== null) {
      result.push({ ...bounds, kind: "high-low", top: high, bottom: low });
    }
    if (mode === "open-close" || mode === "ohlc") {
      result.push({
        ...bounds,
        kind: "open-close",
        top: Math.max(open, close),
        bottom: Math.min(open, close)
      });
    }
    if (
      mode === "true-range" &&
      high !== null &&
      low !== null &&
      period.followsPrevious !== false
    ) {
      const previousClose = periods[index - 1]?.close;
      if (previousClose != null) {
        result.push({
          ...bounds,
          kind: "true-range",
          top: Math.max(high, previousClose),
          bottom: Math.min(low, previousClose)
        });
      }
    }
  }
  return result;
}
