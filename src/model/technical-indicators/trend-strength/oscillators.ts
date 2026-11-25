import { assertLength, finiteOrNull, rma, sma } from "../primitives.js";
import type { NumericValue, TechnicalBar } from "../types.js";
import { ExtremeIndexWindow } from "./extrema.js";
import { assertTrendBars, present, trendTrueRange } from "./inputs.js";

export function vortex(bars: readonly TechnicalBar[], length = 14) {
  assertLength(length);
  if (length < 2) throw new RangeError("Vortex length must be at least 2");
  assertTrendBars(bars);
  const positive = bars.map((bar, index) => {
    const previous = bars[index - 1]?.low;
    return bar.high === null || previous == null
      ? null
      : finiteOrNull(Math.abs(bar.high - previous));
  });
  const negative = bars.map((bar, index) => {
    const previous = bars[index - 1]?.high;
    return bar.low === null || previous == null ? null : finiteOrNull(Math.abs(bar.low - previous));
  });
  const rawRange = trendTrueRange(bars, true),
    denominator = sma(rma(rawRange, 1), length);
  const ratio = (movement: readonly NumericValue[]) =>
    sma(movement, length).map((value, index) => {
      const range = denominator[index];
      return !present(bars[index]!) ||
        movement[index] === null ||
        rawRange[index] === null ||
        value === null ||
        range == null ||
        range === 0
        ? null
        : finiteOrNull(value / range);
    });
  return { plusVI: ratio(positive), minusVI: ratio(negative) };
}

export function choppinessIndex(bars: readonly TechnicalBar[], length = 14): NumericValue[] {
  assertLength(length);
  assertTrendBars(bars);
  const rawRange = trendTrueRange(bars, true),
    meanATR = sma(rma(rawRange, 1), length);
  const highest = new ExtremeIndexWindow(true),
    lowest = new ExtremeIndexWindow(false),
    logLength = Math.log10(length);
  return bars.map((bar, index) => {
    const high = highest.push(index, bar.high, length),
      low = lowest.push(index, bar.low, length);
    const mean = meanATR[index];
    if (
      !present(bar) ||
      rawRange[index] === null ||
      length === 1 ||
      high === null ||
      low === null ||
      mean == null ||
      mean <= 0 ||
      high.value === low.value
    )
      return null;
    const scale = Math.max(Math.abs(high.value), Math.abs(low.value));
    const difference = high.value - low.value;
    const normalized = Number.isFinite(difference)
      ? difference / scale
      : high.value / scale - low.value / scale;
    if (normalized <= 0) return null;
    const logRange = Math.log10(scale) + Math.log10(normalized);
    return finiteOrNull((100 * (Math.log10(mean) + logLength - logRange)) / logLength);
  });
}
