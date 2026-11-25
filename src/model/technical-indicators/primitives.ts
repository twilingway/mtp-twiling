import type { NumericSeries, NumericValue } from "./types.js";

export function assertLength(length: number): void {
  if (!Number.isInteger(length) || length < 1 || length > 10000)
    throw new RangeError("Invalid indicator length");
}
export function assertSeries(source: NumericSeries): void {
  for (const value of source)
    if (value !== null && !Number.isFinite(value))
      throw new RangeError("Indicator source must contain finite numbers or null");
}
export function finiteOrNull(value: number): NumericValue {
  return Number.isFinite(value) ? value : null;
}

/** Pine SMA ignores na observations; a missing observation does not consume the window. */
export function sma(source: NumericSeries, length: number): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  const window: number[] = [];
  let position = 0,
    mean = 0;
  return source.map((value) => {
    if (value !== null) {
      if (window.length < length) {
        window.push(value);
        mean += (value - mean) / window.length;
      } else {
        const old = window[position]!;
        window[position] = value;
        position = (position + 1) % length;
        mean += (value - old) / length;
      }
    }
    return window.length === length ? finiteOrNull(mean) : null;
  });
}
function smoothed(source: NumericSeries, length: number, wilder: boolean): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  let previous: NumericValue = null,
    seedCount = 0,
    seedMean = 0;
  const alpha = wilder ? 1 / length : 2 / (length + 1);
  return source.map((value) => {
    if (value === null) return previous;
    if (previous !== null) previous = finiteOrNull(alpha * value + (1 - alpha) * previous);
    else if (!wilder) previous = value;
    else {
      seedCount++;
      seedMean += (value - seedMean) / seedCount;
      if (seedCount === length) previous = finiteOrNull(seedMean);
    }
    return previous;
  });
}
/** First non-na value seed, not a period-SMA seed. */
export const ema = (source: NumericSeries, length: number): NumericValue[] =>
  smoothed(source, length, false);
/** Wilder alpha=1/length, seeded by the first length non-na observations' mean. */
export const rma = (source: NumericSeries, length: number): NumericValue[] =>
  smoothed(source, length, true);

/** Stable rolling central moment, population divisor N, na-skipping observation window. */
export function populationDeviation(source: NumericSeries, length: number): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  const window: number[] = [];
  let position = 0,
    mean = 0,
    m2 = 0;
  return source.map((value) => {
    if (value !== null) {
      if (window.length === length) {
        const old = window[position]!;
        if (length === 1) {
          mean = 0;
          m2 = 0;
        } else {
          const remainingMean = mean + (mean - old) / (length - 1);
          m2 -= (old - mean) * (old - remainingMean);
          mean = remainingMean;
        }
        const delta = value - mean;
        mean += delta / length;
        m2 += delta * (value - mean);
        window[position] = value;
        position = (position + 1) % length;
      } else {
        window.push(value);
        const delta = value - mean;
        mean += delta / window.length;
        m2 += delta * (value - mean);
      }
    }
    return window.length === length ? finiteOrNull(Math.sqrt(Math.max(0, m2) / length)) : null;
  });
}
