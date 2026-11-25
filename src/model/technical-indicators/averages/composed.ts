import { assertLength, ema, finiteOrNull, sma } from "../primitives.js";
import type { NumericSeries, NumericValue } from "../types.js";
import { wma } from "./windows.js";

/** Same first-value EMA period on both stages; mask only the original missing input. */
export function dema(source: NumericSeries, length: number): NumericValue[] {
  const first = ema(source, length),
    second = ema(first, length);
  return first.map((value, index) => {
    const smoothed = second[index];
    return source[index] === null || value === null || smoothed == null
      ? null
      : finiteOrNull(value + (value - smoothed));
  });
}

/** 3*(EMA1-EMA2)+EMA3 avoids overflowing 3*EMA1 for a large constant source. */
export function tema(source: NumericSeries, length: number): NumericValue[] {
  const first = ema(source, length),
    second = ema(first, length),
    third = ema(second, length);
  return first.map((value, index) => {
    const twice = second[index],
      thrice = third[index];
    return source[index] === null || value === null || twice == null || thrice == null
      ? null
      : finiteOrNull(3 * (value - twice) + thrice);
  });
}

/** Original Hull Integer(n/2), Integer(sqrt(n)); period 1 is the explicit identity extension. */
export function hma(source: NumericSeries, length: number): NumericValue[] {
  assertLength(length);
  const half = wma(source, Math.max(1, Math.floor(length / 2))),
    full = wma(source, length),
    raw = full.map((value, index) => {
      const fast = half[index];
      return value === null || fast == null ? null : finiteOrNull(fast + (fast - value));
    });
  const result = wma(raw, Math.max(1, Math.floor(Math.sqrt(length))));
  return result.map((value, index) =>
    source[index] === null || raw[index] === null ? null : value
  );
}

/** Published SMMA: SMA seed when previous output is null; missing source resets recurrence. */
export function smma(source: NumericSeries, length: number): NumericValue[] {
  const basis = sma(source, length),
    alpha = 1 / length;
  let previous: NumericValue = null;
  return source.map((value, index) => {
    previous =
      previous === null
        ? basis[index]!
        : value === null
          ? null
          : finiteOrNull((1 - alpha) * previous + alpha * value);
    return value === null ? null : previous;
  });
}
