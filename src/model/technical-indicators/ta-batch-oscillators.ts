import { assertTechnicalBars } from "./data.js";
import { momentum, roc } from "./momentum-volume/oscillators.js";
import { relativeChange } from "./momentum-volume/validation.js";
import { assertLength, assertSeries, ema, finiteOrNull } from "./primitives.js";
import { mean } from "./trend-state/filters.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "./types.js";
import { ExtremeWindow } from "./volatility-momentum/windows.js";

export type PriceOscillatorAverage = "EMA" | "SMA";

function maskGaps(values: NumericSeries, source: NumericSeries): NumericValue[] {
  return values.map((value, index) => (source[index] === null ? null : value));
}

function signalEma(source: NumericSeries, length: number): NumericValue[] {
  return maskGaps(ema(source, length), source);
}

function customEma(source: NumericSeries, length: number): NumericValue[] {
  let state: NumericValue = null;
  const alpha = 2 / length;
  return source.map((value) => {
    if (value === null) return null;
    state = state === null ? value : finiteOrNull(alpha * value + (1 - alpha) * state);
    return state;
  });
}

export function priceMomentumOscillator(
  source: NumericSeries,
  { firstLength = 35, secondLength = 20, signalLength = 10 } = {}
) {
  [firstLength, secondLength, signalLength].forEach(assertLength);
  if (firstLength < 2 || secondLength < 2)
    throw new RangeError("PMO smoothing length must be at least 2");
  const scaled = customEma(roc(source, 1), firstLength).map((value) =>
    value === null ? null : finiteOrNull(value * 10)
  );
  const value = customEma(scaled, secondLength);
  return { value, signal: signalEma(value, signalLength) };
}

function oscillatorAverage(kind: PriceOscillatorAverage) {
  if (kind === "EMA") return ema;
  if (kind === "SMA") return mean;
  throw new RangeError("Invalid oscillator moving average");
}

export interface PercentagePriceOscillatorOptions {
  readonly fastLength?: number;
  readonly slowLength?: number;
  readonly signalLength?: number;
  readonly oscillatorAverage?: PriceOscillatorAverage;
  readonly signalAverage?: PriceOscillatorAverage;
}

export function percentagePriceOscillator(
  source: NumericSeries,
  {
    fastLength = 12,
    slowLength = 26,
    signalLength = 9,
    oscillatorAverage: mainAverage = "EMA",
    signalAverage = "EMA"
  }: PercentagePriceOscillatorOptions = {}
) {
  assertSeries(source);
  const average = oscillatorAverage(mainAverage);
  const fast = average(source, fastLength);
  const slow = average(source, slowLength);
  const value = source.map((price, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    if (price === null || fastValue == null || slowValue == null) return null;
    const change = relativeChange(fastValue, slowValue);
    return change === null ? null : finiteOrNull(change * 100);
  });
  const signal = maskGaps(oscillatorAverage(signalAverage)(value, signalLength), value);
  return { value, signal, histogram: difference(value, signal) };
}

function difference(left: NumericSeries, right: NumericSeries): NumericValue[] {
  return left.map((value, index) => {
    const reference = right[index];
    return value === null || reference == null ? null : finiteOrNull(value - reference);
  });
}

function smoothedRatio(
  changes: NumericSeries,
  ranges: NumericSeries,
  firstLength: number,
  secondLength: number,
  multiplier: number
) {
  const smooth = (series: NumericSeries) => signalEma(signalEma(series, firstLength), secondLength);
  const numerator = smooth(changes);
  const denominator = smooth(ranges);
  return numerator.map((value, index) => {
    const range = denominator[index];
    return value === null || range == null || range === 0
      ? null
      : finiteOrNull(multiplier * (value / range));
  });
}

export function stochasticMomentumIndex(
  bars: readonly TechnicalBar[],
  { kLength = 10, dLength = 3, emaLength = 3 } = {}
) {
  [kLength, dLength, emaLength].forEach(assertLength);
  assertTechnicalBars(bars);
  const highest = new ExtremeWindow(true);
  const lowest = new ExtremeWindow(false);
  const ranges: NumericValue[] = [];
  const changes = bars.map((bar, index) => {
    const high = highest.push(index, bar.high, kLength);
    const low = lowest.push(index, bar.low, kLength);
    if (
      index + 1 < kLength ||
      bar.high === null ||
      bar.low === null ||
      bar.close === null ||
      high === null ||
      low === null
    ) {
      ranges.push(null);
      return null;
    }
    const span = high - low;
    const halfRange = Number.isFinite(span) ? span / 2 : high / 2 - low / 2;
    ranges.push(halfRange);
    return finiteOrNull(bar.close - (high / 2 + low / 2));
  });
  const value = smoothedRatio(changes, ranges, dLength, dLength, 100);
  return { value, signal: signalEma(value, emaLength) };
}

export interface SmiErgodicOptions {
  readonly shortLength?: number;
  readonly longLength?: number;
  readonly signalLength?: number;
}

export function smiErgodicIndicator(
  source: NumericSeries,
  { shortLength = 5, longLength = 20, signalLength = 5 }: SmiErgodicOptions = {}
) {
  [shortLength, longLength, signalLength].forEach(assertLength);
  const changes = momentum(source, 1);
  const ranges = changes.map((change) => (change === null ? null : Math.abs(change)));
  const value = smoothedRatio(changes, ranges, shortLength, longLength, 1);
  return { value, signal: signalEma(value, signalLength) };
}

export function smiErgodicOscillator(source: NumericSeries, options?: SmiErgodicOptions) {
  const { value, signal } = smiErgodicIndicator(source, options);
  return { histogram: difference(value, signal) };
}
