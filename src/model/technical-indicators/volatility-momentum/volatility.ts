import { assertLength, assertSeries, finiteOrNull } from "../primitives.js";
import type { NumericSeries, NumericValue } from "../types.js";
import { assertMultiplier, logReturn } from "./validation.js";
import { ExtremeWindow, RollingMoments } from "./windows.js";

export function bollingerPercentB(
  source: NumericSeries,
  length = 20,
  multiplier = 2
): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  assertMultiplier(multiplier);
  const window = new RollingMoments(length);
  return source.map((value) => {
    if (value === null) return null;
    const moments = window.push(value);
    return moments === null || moments.normalizedDeviation === 0
      ? null
      : finiteOrNull(
          0.5 + moments.currentDeviation / moments.normalizedDeviation / (2 * multiplier)
        );
  });
}

/** Includes both public built-in extrema plots; extrema count bars, not valid observations. */
export function bollingerBandwidth(
  source: NumericSeries,
  length = 20,
  multiplier = 2,
  expansionLength = 125,
  contractionLength = 125
) {
  assertLength(length);
  assertLength(expansionLength);
  assertLength(contractionLength);
  assertSeries(source);
  assertMultiplier(multiplier);
  const window = new RollingMoments(length),
    maximum = new ExtremeWindow(true),
    minimum = new ExtremeWindow(false);
  const value = source.map((current) => {
    if (current === null) return null;
    const moments = window.push(current);
    return moments === null || moments.normalizedMean === 0
      ? null
      : finiteOrNull(200 * multiplier * (moments.normalizedDeviation / moments.normalizedMean));
  });
  const highestExpansion = value.map((current, index) => {
    const highest = maximum.push(index, current, expansionLength);
    return source[index] === null ? null : highest;
  });
  const lowestContraction = value.map((current, index) => {
    const lowest = minimum.push(index, current, contractionLength);
    return source[index] === null ? null : lowest;
  });
  return { value, highestExpansion, lowestContraction };
}

/** Caller must explicitly choose annualization; no timestamps/timeframe inference or hidden252. */
export function historicalVolatility(
  source: NumericSeries,
  periodsPerYear: number,
  length = 10
): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0)
    throw new RangeError("Historical volatility requires explicit positive periodsPerYear");
  const window = new RollingMoments(length);
  return source.map((current, index) => {
    const change = logReturn(current, source[index - 1]);
    if (change === null) return null;
    const moments = window.push(change);
    return moments === null
      ? null
      : finiteOrNull(moments.normalizedDeviation * moments.scale * 100 * Math.sqrt(periodsPerYear));
  });
}
