import { addScaled, directBudget, period, seriesInput } from "./channel-average/inputs.js";
import type { NumericSeries, NumericValue } from "./types.js";

function centeredValue(value: number, anchor: number, scale: number): number {
  if (scale === 0) return 0;
  const difference = value - anchor;
  return Number.isFinite(difference) ? difference / scale : value / scale - anchor / scale;
}

function fitWindow(source: NumericSeries, start: number, length: number) {
  const anchor = source[start]!;
  if (anchor === null) return null;
  let scale = Math.abs(anchor);
  for (let offset = 1; offset < length; offset++) {
    const value = source[start + offset]!;
    if (value === null) return null;
    scale = Math.max(scale, Math.abs(value));
  }

  const middle = (length - 1) / 2;
  const indexSquares = (length * (length ** 2 - 1)) / 12;
  let mean = 0;
  let valueSquares = 0;
  let cross = 0;
  for (let offset = 0; offset < length; offset++) {
    const value = centeredValue(source[start + offset]!, anchor, scale);
    const delta = value - mean;
    mean += delta / (offset + 1);
    valueSquares += delta * (value - mean);
    cross += (offset - middle) * value;
  }
  return { anchor, scale, mean, middle, cross, valueSquares, indexSquares };
}

/** Pearson correlation between closes and increasing bar positions. Unitless [-1, 1]. */
export function trendStrengthIndex(closes: NumericSeries, length = 14): NumericValue[] {
  period(length, 2);
  seriesInput(closes);
  directBudget(closes.length, length);
  return closes.map((_, index) => {
    if (index + 1 < length) return null;
    const fit = fitWindow(closes, index - length + 1, length);
    if (!fit || fit.valueSquares <= 0) return null;
    const r = fit.cross / (Math.sqrt(fit.indexSquares) * Math.sqrt(fit.valueSquares));
    return Math.max(-1, Math.min(1, r));
  });
}

/** One line per band over the latest window, with population RMS residual widths. */
export function linearRegressionChannel(
  source: NumericSeries,
  length = 100,
  upperDeviation: number | null = 2,
  lowerDeviation: number | null = 2
) {
  period(length, 2);
  seriesInput(source);
  for (const multiplier of [upperDeviation, lowerDeviation]) {
    if (multiplier !== null && (!Number.isFinite(multiplier) || multiplier < 0))
      throw new RangeError("Regression deviations must be finite and nonnegative or null");
  }

  const empty = (): NumericValue[] => Array<NumericValue>(source.length).fill(null);
  const result = { center: empty(), upper: empty(), lower: empty() };
  const start = source.length - length;
  if (start < 0) return result;
  const fit = fitWindow(source, start, length);
  if (!fit) return result;

  const slope = fit.cross / fit.indexSquares;
  const at = (offset: number) => fit.mean + slope * (offset - fit.middle);
  let residualSquares = 0;
  for (let offset = 0; offset < length; offset++) {
    const value = centeredValue(source[start + offset]!, fit.anchor, fit.scale);
    residualSquares += (value - at(offset)) ** 2;
  }
  const deviation = Math.sqrt(residualSquares / length);
  for (let offset = 0; offset < length; offset++) {
    const index = start + offset;
    const center = at(offset);
    result.center[index] = addScaled(fit.anchor, fit.scale, center);
    if (upperDeviation !== null)
      result.upper[index] = addScaled(fit.anchor, fit.scale, center + upperDeviation * deviation);
    if (lowerDeviation !== null)
      result.lower[index] = addScaled(fit.anchor, fit.scale, center - lowerDeviation * deviation);
  }
  return result;
}
