import { smma, vwma, wma } from "./averages/index.js";
import { RollingAverageWindow } from "./averages/rolling-window.js";
import { assertTechnicalBars, priceSource } from "./data.js";
import { assertLength, assertSeries, ema, finiteOrNull, sma } from "./primitives.js";
import type { NumericSeries, NumericValue, PriceSource, TechnicalBar } from "./types.js";

export const KAMA_DEFAULTS = Object.freeze({ erLength: 10, fastLength: 2, slowLength: 30 });
export const MCGINLEY_DEFAULT_LENGTH = 14;
export const MA_CROSS_DEFAULTS = Object.freeze({ shortLength: 9, longLength: 21 });

export interface KamaOptions {
  readonly erLength: number;
  readonly fastLength: number;
  readonly slowLength: number;
}

export function kaufmanAdaptiveMovingAverage(
  source: NumericSeries,
  { erLength, fastLength, slowLength }: KamaOptions = KAMA_DEFAULTS
): NumericValue[] {
  assertLength(erLength);
  assertLength(fastLength);
  assertLength(slowLength);
  if (fastLength > slowLength) throw new RangeError("KAMA fast length exceeds slow length");
  assertSeries(source);

  const fast = 2 / (fastLength + 1),
    slow = 2 / (slowLength + 1);
  const changes = new RollingAverageWindow(erLength, false);
  let consecutiveChanges = 0;
  let previous: NumericValue = null;
  return source.map((value, index) => {
    const priorPrice = source[index - 1];
    if (value === null || priorPrice == null) {
      consecutiveChanges = 0;
      previous = null;
      return null;
    }
    // Halve both parts of the ER to avoid overflowing differences across signs.
    const averageChange = changes.push(Math.abs(value / 2 - priorPrice / 2));
    consecutiveChanges++;
    const initialPrice = source[index - erLength];
    if (consecutiveChanges < erLength || averageChange === null || initialPrice == null)
      return null;

    const netChangePerBar = Math.abs(value / 2 - initialPrice / 2) / erLength;
    const efficiency = averageChange === 0 ? 0 : Math.min(1, netChangePerBar / averageChange);
    const smoothing = (slow + efficiency * (fast - slow)) ** 2;
    previous = finiteOrNull(smoothing * value + (1 - smoothing) * (previous ?? priorPrice));
    return previous;
  });
}

export function mcginleyDynamic(
  source: NumericSeries,
  length = MCGINLEY_DEFAULT_LENGTH
): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  let previous: NumericValue = null;
  return source.map((value) => {
    if (value === null) return null;
    if (value === 0) previous = null;
    else if (previous === null) previous = value;
    else {
      const divisor = length * (value / previous) ** 4;
      previous =
        divisor > 0 && Number.isFinite(divisor)
          ? finiteOrNull(previous + (value - previous) / divisor)
          : null;
    }
    return previous;
  });
}

function observedAverage(source: NumericSeries, values: NumericValue[]): NumericValue[] {
  return values.map((value, index) => (source[index] === null ? null : value));
}

export interface MovingAverageCrossOptions {
  readonly shortLength: number;
  readonly longLength: number;
}

export function movingAverageCross(
  source: NumericSeries,
  { shortLength, longLength }: MovingAverageCrossOptions = MA_CROSS_DEFAULTS
) {
  const short = observedAverage(source, sma(source, shortLength));
  const long = observedAverage(source, sma(source, longLength));
  const cross = short.map((value, index) => {
    const other = long[index],
      previous = short[index - 1],
      previousOther = long[index - 1];
    if (value === null || other == null || previous == null || previousOther == null) return null;
    const up = value > other && previous <= previousOther;
    const down = value < other && previous >= previousOther;
    return up || down ? value : null;
  });
  return { short, long, cross };
}

export type RibbonAverage = "sma" | "ema" | "smma" | "wma" | "vwma";
export type RibbonLineId = "ma1" | "ma2" | "ma3" | "ma4";
export interface RibbonLineOptions {
  readonly average: RibbonAverage;
  readonly source: PriceSource;
  readonly length: number;
}
export type MovingAverageRibbonOptions = Readonly<Record<RibbonLineId, RibbonLineOptions>>;

export const MA_RIBBON_DEFAULTS: MovingAverageRibbonOptions = Object.freeze({
  ma1: Object.freeze({ average: "sma", source: "close", length: 20 }),
  ma2: Object.freeze({ average: "sma", source: "close", length: 50 }),
  ma3: Object.freeze({ average: "sma", source: "close", length: 100 }),
  ma4: Object.freeze({ average: "sma", source: "close", length: 200 })
});

export function movingAverageRibbon(
  bars: readonly TechnicalBar[],
  options: MovingAverageRibbonOptions = MA_RIBBON_DEFAULTS
): Record<RibbonLineId, NumericValue[]> {
  assertTechnicalBars(bars);
  const calculate = ({ average, source, length }: RibbonLineOptions) => {
    const prices = priceSource(bars, source);
    switch (average) {
      case "sma":
        return observedAverage(prices, sma(prices, length));
      case "ema":
        return observedAverage(prices, ema(prices, length));
      case "smma":
        return smma(prices, length);
      case "wma":
        return wma(prices, length);
      case "vwma":
        return vwma(prices, priceSource(bars, "volume"), length);
    }
  };
  return {
    ma1: calculate(options.ma1),
    ma2: calculate(options.ma2),
    ma3: calculate(options.ma3),
    ma4: calculate(options.ma4)
  };
}
