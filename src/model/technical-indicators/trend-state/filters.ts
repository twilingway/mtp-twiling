import type { NumericSeries, NumericValue } from "../types.js";
import { finite, period } from "./inputs.js";

/** Known-observation SMA; null holds the last mean and does not consume a slot. */
export function mean(source: NumericSeries, length: number): NumericValue[] {
  period(length);
  if (length === 1) {
    let previous: NumericValue = null;
    return source.map((value) => {
      if (value !== null) previous = value;
      return previous;
    });
  }
  let window: number[] = [],
    cursor = 0,
    average = 0;
  return source.map((value) => {
    if (value !== null) {
      if (window.length < length) {
        window.push(value);
        const count = window.length;
        average = (1 - 1 / count) * average + value / count;
      } else {
        const previous = window[cursor]!;
        window[cursor] = value;
        cursor = (cursor + 1) % length;
        average = average + (value / length - previous / length);
      }
      if (!Number.isFinite(average)) {
        window = [];
        cursor = 0;
        average = 0;
        return null;
      }
    }
    return window.length === length ? average : null;
  });
}

/** EMA first-known seed, null holds. Overflow discards invalid recursive state. */
export function exponential(source: NumericSeries, length: number): NumericValue[] {
  period(length);
  let previous: NumericValue = null;
  const alpha = 2 / (length + 1);
  return source.map((value) => {
    if (value !== null)
      previous = previous === null ? value : finite(alpha * value + (1 - alpha) * previous);
    return previous;
  });
}

/** Wilder SMA seed; this state is owned by one contiguous Supertrend segment. */
export class Wilder {
  private count = 0;
  private average = 0;
  private previous: NumericValue = null;
  constructor(private readonly length: number) {}
  push(value: number): NumericValue {
    if (this.previous !== null)
      this.previous = finite(this.previous + (value - this.previous) / this.length);
    else {
      this.count++;
      this.average += (value - this.average) / this.count;
      if (this.count === this.length) this.previous = finite(this.average);
    }
    return this.previous;
  }
}
