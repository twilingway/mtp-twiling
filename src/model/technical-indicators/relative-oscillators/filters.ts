import type { NumericSeries, NumericValue } from "../types.js";
import { add, blend, number, root, scalar, times, ZERO, type Scalar } from "./numeric.js";
import { ObservationWindow } from "./window.js";

export class RecursiveMean {
  private count = 0;
  private value: Scalar | null = null;
  constructor(
    private readonly length: number,
    private readonly kind: "EMA" | "RMA"
  ) {}
  push(value: Scalar | null): Scalar | null {
    if (value !== null) {
      this.count++;
      const weight =
        this.kind === "EMA" ? 2 / (this.length + 1) : 1 / Math.min(this.count, this.length);
      this.value = this.value === null ? value : blend(this.value, value, weight);
    }
    return this.kind === "RMA" && this.count < this.length ? null : this.value;
  }
}
export function rolling(source: readonly (Scalar | null)[], length: number, weighted = false) {
  const window = new ObservationWindow(length);
  return source.map((value) => {
    const summary = window.push(value);
    return summary === null ? null : weighted ? summary.weighted : summary.mean;
  });
}
export function deviation(source: readonly (Scalar | null)[], length: number) {
  const window = new ObservationWindow(length);
  return source.map((value) => {
    const summary = window.push(value);
    return summary === null ? null : root(summary.variance);
  });
}
export function recursive(source: readonly (Scalar | null)[], length: number, kind: "EMA" | "RMA") {
  const filter = new RecursiveMean(length, kind);
  return source.map((value) => filter.push(value));
}
/** Fixed positional SWMA; unlike observation windows it propagates any of four nulls. */
export function swma(source: readonly (Scalar | null)[]): (Scalar | null)[] {
  const weights = [1 / 6, 2 / 6, 2 / 6, 1 / 6];
  return source.map((_, index) => {
    if (index < 3) return null;
    let sum = ZERO;
    for (let offset = 0; offset < 4; offset++) {
      const value = source[index - 3 + offset]!;
      if (value === null) return null;
      sum = add(sum, times(value, weights[offset]!));
    }
    return sum;
  });
}
export const scalars = (source: NumericSeries): (Scalar | null)[] =>
  source.map((value) => (value === null ? null : scalar(value)));
export const numbers = (source: readonly (Scalar | null)[]): NumericValue[] =>
  source.map((value) => (value === null ? null : number(value)));

/** Partial positional window; nulls do not enter the monotonic deque. */
export function extrema(source: NumericSeries, length: number, highest: boolean): NumericValue[] {
  const queue: number[] = [];
  let start = 0;
  return source.map((value, index) => {
    while (start < queue.length && queue[start]! <= index - length) start++;
    if (value !== null) {
      while (
        start < queue.length &&
        (highest ? source[queue.at(-1)!]! <= value : source[queue.at(-1)!]! >= value)
      )
        queue.pop();
      queue.push(index);
    }
    if (start > 10000) {
      queue.splice(0, start);
      start = 0;
    }
    return start === queue.length ? null : source[queue[start]!]!;
  });
}
