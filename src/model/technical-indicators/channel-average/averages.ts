import type { NumericSeries, NumericValue } from "../types.js";
import { bounded, convex, directBudget, finite, integer, period, seriesInput } from "./inputs.js";

export interface AlmaOptions {
  readonly length?: number;
  readonly offset?: number;
  readonly sigma?: number;
  /** Optional Pine ta.alma argument; not a visible input of the builtin. */
  readonly floor?: boolean;
}
export function alma(source: NumericSeries, options: AlmaOptions = {}): NumericValue[] {
  const { length = 9, offset = 0.85, sigma = 6, floor = false } = options;
  period(length);
  bounded(offset, -100, 100);
  bounded(sigma, 0.000001, 10000);
  if (typeof floor !== "boolean") throw new RangeError("ALMA floor must be boolean");
  seriesInput(source);
  directBudget(source.length, length);
  const center = floor ? Math.floor(offset * (length - 1)) : offset * (length - 1);
  const width = length / sigma;
  // Subtract the peak sampled log weight to avoid a zero underflow denominator.
  const nearest = Math.min(length - 1, Math.max(0, Math.round(center)));
  const peak = -0.5 * ((nearest - center) / width) ** 2;
  const weights = Array.from({ length }, (_, i) =>
    Math.exp(-0.5 * ((i - center) / width) ** 2 - peak)
  );
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  const result: NumericValue[] = Array<NumericValue>(source.length).fill(null);
  let valid = 0;
  for (let i = 0; i < source.length; i++) {
    valid = source[i] === null ? 0 : valid + 1;
    if (valid < length) continue;
    let scale = 0;
    for (let j = 0; j < length; j++) scale = Math.max(scale, Math.abs(source[i - length + 1 + j]!));
    if (scale === 0) {
      result[i] = 0;
      continue;
    }
    let value = 0;
    for (let j = 0; j < length; j++)
      value += (source[i - length + 1 + j]! / scale) * (weights[j]! / denominator);
    result[i] = finite(Math.min(1, Math.max(-1, value)) * scale);
  }
  return result;
}

export interface LsmaOptions {
  readonly length?: number;
  readonly offset?: number;
}
/** Offset changes the fitted x coordinate, never the calculation timestamp. */
export function lsma(source: NumericSeries, options: LsmaOptions = {}): NumericValue[] {
  const { length = 25, offset = 0 } = options;
  period(length, 2);
  integer(offset, -10000, 10000);
  seriesInput(source);
  directBudget(source.length, length);
  const result: NumericValue[] = Array<NumericValue>(source.length).fill(null);
  const center = (length - 1) / 2;
  const denominator = (length * (length * length - 1)) / 12;
  let valid = 0;
  for (let i = 0; i < source.length; i++) {
    valid = source[i] === null ? 0 : valid + 1;
    if (valid < length) continue;
    let scale = 0;
    for (let j = 0; j < length; j++) scale = Math.max(scale, Math.abs(source[i - length + 1 + j]!));
    if (scale === 0) {
      result[i] = 0;
      continue;
    }
    let mean = 0;
    let covariance = 0;
    for (let j = 0; j < length; j++) {
      const value = source[i - length + 1 + j]! / scale;
      mean = j === 0 ? value : convex(mean, value, 1 / (j + 1));
      covariance += (j - center) * value;
    }
    result[i] = finite((mean + (covariance / denominator) * (center - offset)) * scale);
  }
  return result;
}
