import { assertLength, assertSeries } from "../primitives.js";
import type { NumericSeries, NumericValue } from "../types.js";
import { RollingAverageWindow } from "./rolling-window.js";

/** Last length non-null observations, oldest weight 1, newest weight length; gaps stay null. */
export function wma(source: NumericSeries, length: number): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  const window = new RollingAverageWindow(length, true);
  return source.map((value) => (value === null ? null : window.push(value)));
}

/** Jointly valid source/volume observations; zero volume is valid, zero total weight is not. */
export function vwma(source: NumericSeries, volume: NumericSeries, length: number): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  assertSeries(volume);
  if (source.length !== volume.length) throw new RangeError("Source and volume must align");
  if (volume.some((value) => value !== null && value < 0))
    throw new RangeError("Volume must be nonnegative");
  const window = new RollingAverageWindow(length, false);
  return source.map((value, index) => {
    const weight = volume[index];
    return value === null || weight == null ? null : window.push(value, weight);
  });
}
