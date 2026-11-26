import { barsInput, period, seriesInput } from "./channel-average/inputs.js";
import { priceSource } from "./data.js";
import { roc } from "./momentum-volume/oscillators.js";
import { relativeChange } from "./momentum-volume/validation.js";
import { ema, finiteOrNull, sma } from "./primitives.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "./types.js";
import { ExtremeWindow, RollingMoments } from "./volatility-momentum/windows.js";

function positionalSma(source: NumericSeries, length: number): NumericValue[] {
  const averages = sma(source, length);
  let lastMissing = -1;
  return averages.map((value, index) => {
    if (source[index] === null) lastMissing = index;
    return index - lastMissing < length ? null : value;
  });
}

/** Sum of the ratio between single and double EMA of high-low. */
export function massIndex(bars: readonly TechnicalBar[], emaLength = 9, sumLength = 25) {
  period(emaLength);
  period(sumLength);
  barsInput(bars, undefined, false);
  const ranges = bars.map(({ high, low }) =>
    high === null || low === null ? null : finiteOrNull(high - low)
  );
  const first = ema(ranges, emaLength).map((value, i) => (ranges[i] === null ? null : value));
  const second = ema(first, emaLength);
  const ratios = first.map((value, i) => {
    const denominator = second[i]!;
    return value === null || denominator === null || denominator === 0
      ? null
      : finiteOrNull(value / denominator);
  });
  return positionalSma(ratios, sumLength).map((value) =>
    value === null ? null : finiteOrNull(value * sumLength)
  );
}

/** Root mean square of percentage drawdowns from each bar's rolling high. */
export function ulcerIndex(source: NumericSeries, length = 14): NumericValue[] {
  period(length);
  seriesInput(source);
  const highest = new ExtremeWindow(true);
  const drawdowns = new RollingMoments(length);
  let lastMissing = -1;
  return source.map((value, index) => {
    if (value === null) lastMissing = index;
    const high = highest.push(index, value, length);
    const change = value === null || high === null ? null : relativeChange(value, high);
    const percent = change === null ? null : finiteOrNull(100 * change);
    if (index - lastMissing < length || percent === null) {
      drawdowns.reset();
      return null;
    }
    const moments = drawdowns.push(percent);
    if (!moments) return null;
    return finiteOrNull(
      Math.hypot(moments.normalizedMean, moments.normalizedDeviation) * moments.scale
    );
  });
}

const specialKCycles = [
  [10, 10, 1],
  [15, 10, 2],
  [20, 10, 3],
  [30, 15, 4],
  [40, 50, 1],
  [65, 65, 2],
  [75, 75, 3],
  [100, 100, 4],
  [195, 130, 1],
  [265, 130, 2],
  [390, 130, 3],
  [530, 195, 4]
] as const;

export const SPECIAL_K_WARMUP = 725;

export function pringSpecialK(
  source: NumericSeries,
  firstSignalLength = 100,
  secondSignalLength = 100
) {
  seriesInput(source);
  period(firstSignalLength);
  period(secondSignalLength);
  if (source.length < SPECIAL_K_WARMUP) {
    return { specialK: source.map(() => null), signal: source.map(() => null) };
  }

  const specialK: NumericValue[] = source.map(() => 0);
  for (const [rocLength, averageLength, weight] of specialKCycles) {
    const component = positionalSma(roc(source, rocLength), averageLength);
    for (let i = 0; i < source.length; i++) {
      const total = specialK[i]!;
      const value = component[i]!;
      specialK[i] = total === null || value === null ? null : finiteOrNull(total + value * weight);
    }
  }
  const signal = positionalSma(positionalSma(specialK, firstSignalLength), secondSignalLength);
  return { specialK, signal };
}

const CHOP_RANGE = 30;
const CHOP_EMA = 34;

function normalizedSlope(
  current: number,
  previous: number,
  low: number,
  high: number,
  typical: number
) {
  if (high === low || typical === 0) return null;
  const difference = current - previous;
  const range = high - low;
  const scale = Math.max(Math.abs(high), Math.abs(low), Math.abs(current), Math.abs(previous));
  const numerator = Number.isFinite(difference)
    ? difference / scale
    : current / scale - previous / scale;
  const denominator = Number.isFinite(range) ? range / scale : high / scale - low / scale;
  return finiteOrNull(25 * (numerator / denominator) * (low / typical));
}

/** The zone is an ordinal color role. Each available bar renders at height 1. */
export function chopZone(bars: readonly TechnicalBar[]) {
  barsInput(bars);
  const typical = priceSource(bars, "hlc3");
  const averages = ema(priceSource(bars, "close"), CHOP_EMA);
  const highest = new ExtremeWindow(true);
  const lowest = new ExtremeWindow(false);
  let lastMissing = -1;
  const angle = bars.map((bar, index) => {
    const max = highest.push(index, bar.high, CHOP_RANGE);
    const min = lowest.push(index, bar.low, CHOP_RANGE);
    const price = typical[index]!;
    if (price === null) lastMissing = index;
    if (price === null || index - lastMissing < CHOP_RANGE || max === null || min === null)
      return null;

    const current = averages[index]!;
    const previous = averages[index - 1]!;
    if (current === null || previous === null) return null;
    const slope = normalizedSlope(current, previous, min, max, price);
    if (slope === null) return null;
    const magnitude = Math.round((180 / Math.PI) * Math.atan(Math.abs(slope)));
    return slope < 0 && magnitude > 0 ? -magnitude : magnitude;
  });
  const zone = angle.map((degrees) => {
    if (degrees === null || degrees === 0) return degrees;
    const magnitude = Math.min(4, Math.max(1, Math.abs(degrees) - 1));
    return degrees < 0 ? -magnitude : magnitude;
  });
  return { angle, zone };
}
