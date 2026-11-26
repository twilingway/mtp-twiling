import type { NumericSeries, NumericValue, TechnicalBar } from "../types.js";
import { convex, finite } from "./inputs.js";

/** Epoch tags make gap reset O(1); a bounded tree avoids subtractive cancellation. */
function rollingSma(source: NumericSeries, length: number): NumericValue[] {
  let size = 1;
  while (size < length) size *= 2;
  const means = new Float64Array(2 * size);
  const counts = new Uint32Array(2 * size);
  const epochs = new Uint32Array(2 * size);
  const result: NumericValue[] = Array<NumericValue>(source.length).fill(null);
  let epoch = 1;
  let cursor = 0;
  let seen = 0;
  for (let i = 0; i < source.length; i++) {
    const value = source[i]!;
    if (value === null) {
      epoch++;
      cursor = 0;
      seen = 0;
      continue;
    }
    let node = size + cursor;
    means[node] = value;
    counts[node] = 1;
    epochs[node] = epoch;
    while (node > 1) {
      node = Math.floor(node / 2);
      const left = 2 * node;
      const right = left + 1;
      const a = epochs[left] === epoch ? counts[left]! : 0;
      const b = epochs[right] === epoch ? counts[right]! : 0;
      counts[node] = a + b;
      epochs[node] = epoch;
      means[node] =
        a === 0
          ? means[right]!
          : b === 0
            ? means[left]!
            : convex(means[left]!, means[right]!, b / (a + b));
    }
    cursor = (cursor + 1) % length;
    seen++;
    if (seen >= length) result[i] = means[1]!;
  }
  return result;
}
/** Contiguous local policy: gaps reset both seed and recursive state. */
export function average(
  source: NumericSeries,
  length: number,
  kind: "SMA" | "EMA" | "RMA"
): NumericValue[] {
  if (kind === "SMA") return rollingSma(source, length);
  const result: NumericValue[] = Array<NumericValue>(source.length).fill(null);
  let previous: NumericValue = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const value = source[i]!;
    if (value === null) {
      previous = null;
      seed = 0;
      count = 0;
      continue;
    }
    if (kind === "EMA" || previous !== null) {
      previous =
        previous === null
          ? value
          : convex(previous, value, kind === "EMA" ? 2 / (length + 1) : 1 / length);
      result[i] = previous;
    } else {
      count++;
      seed = count === 1 ? value : convex(seed, value, 1 / count);
      if (count === length) {
        previous = seed;
        result[i] = seed;
      }
    }
  }
  return result;
}

export function trueRange(bars: readonly TechnicalBar[]): NumericValue[] {
  return bars.map((bar, i) => {
    if (bar.high === null || bar.low === null) return null;
    const previous = bars[i - 1]?.close;
    return finite(
      previous == null
        ? bar.high - bar.low
        : Math.max(bar.high - bar.low, Math.abs(bar.high - previous), Math.abs(bar.low - previous))
    );
  });
}

/** Partial startup windows; a local null resets the contiguous segment. */
export function extrema(source: NumericSeries, length: number, highest: boolean): NumericValue[] {
  const result: NumericValue[] = Array<NumericValue>(source.length).fill(null);
  const queue: number[] = [];
  let head = 0;
  for (let i = 0; i < source.length; i++) {
    const value = source[i]!;
    if (value === null) {
      queue.length = 0;
      head = 0;
      continue;
    }
    while (queue.length > head && queue[head]! <= i - length) head++;
    while (
      queue.length > head &&
      (highest ? source[queue.at(-1)!]! <= value : source[queue.at(-1)!]! >= value)
    )
      queue.pop();
    queue.push(i);
    result[i] = source[queue[head]!]!;
    if (head > 10000) {
      queue.splice(0, head);
      head = 0;
    }
  }
  return result;
}
