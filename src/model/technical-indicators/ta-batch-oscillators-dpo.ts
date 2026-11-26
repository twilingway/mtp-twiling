import { assertLength, assertSeries, finiteOrNull } from "./primitives.js";
import { mean } from "./trend-state/filters.js";
import type { NumericSeries } from "./types.js";

export function detrendedPriceOscillatorShift(length: number): number {
  assertLength(length);
  return Math.floor(length / 2) + 1;
}

export function detrendedPriceOscillator(
  source: NumericSeries,
  { length = 21, centered = false } = {}
) {
  const shiftBars = detrendedPriceOscillatorShift(length);
  if (typeof centered !== "boolean") throw new RangeError("Invalid DPO centered option");
  assertSeries(source);
  const average = mean(source, length);
  const value = source.map((price, index) => {
    const averageIndex = index + (centered ? shiftBars : -shiftBars);
    const laggedAverage = average[averageIndex];
    return price === null || laggedAverage == null || source[averageIndex] === null
      ? null
      : finiteOrNull(price - laggedAverage);
  });
  return { value };
}
