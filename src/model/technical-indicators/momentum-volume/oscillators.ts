import { assertLength, assertSeries, finiteOrNull } from "../primitives.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "../types.js";
import { assertBars, relativeChange } from "./validation.js";

export function momentum(source: NumericSeries, length = 10): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  return source.map((value, index) => {
    const previous = source[index - length];
    return value === null || previous == null ? null : finiteOrNull(value - previous);
  });
}

export function roc(source: NumericSeries, length = 9): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  return source.map((value, index) => {
    const previous = source[index - length];
    if (value === null || previous == null) return null;
    const change = relativeChange(value, previous);
    return change === null ? null : finiteOrNull(100 * change);
  });
}

/** O(bars * length), O(length) memory. Source gaps do not consume the observation window. */
export function cci(source: NumericSeries, length = 20): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  const window: number[] = [];
  let position = 0;
  return source.map((value) => {
    if (value === null) return null;
    if (window.length < length) window.push(value);
    else {
      window[position] = value;
      position = (position + 1) % length;
    }
    if (window.length < length) return null;
    const scale = Math.max(...window.map(Math.abs));
    if (scale === 0) return null;
    const differences = window.map((item) => {
      const difference = item - value;
      return Number.isFinite(difference) ? difference / scale : item / scale - value / scale;
    });
    let mean = 0;
    for (const item of differences) mean += item / length;
    let deviation = 0;
    for (const item of differences) deviation += Math.abs(item - mean) / length;
    return deviation === 0 ? null : finiteOrNull(-mean / deviation / 0.015);
  });
}

class ExtremeWindow {
  private entries: { index: number; value: number }[] = [];
  private head = 0;
  constructor(private readonly maximum: boolean) {}
  push(index: number, value: NumericValue, length: number): NumericValue {
    while (this.head < this.entries.length && this.entries[this.head]!.index <= index - length)
      this.head++;
    if (value !== null) {
      while (
        this.entries.length > this.head &&
        (this.maximum ? this.entries.at(-1)!.value <= value : this.entries.at(-1)!.value >= value)
      )
        this.entries.pop();
      this.entries.push({ index, value });
    }
    if (this.head > 1024 && this.head * 2 > this.entries.length) {
      this.entries.splice(0, this.head);
      this.head = 0;
    }
    return this.entries[this.head]?.value ?? null;
  }
}

/** Full positional high/low window; optional source mirrors the built-in Source setting. */
export function williamsR(
  bars: readonly TechnicalBar[],
  length = 14,
  source?: NumericSeries
): NumericValue[] {
  assertLength(length);
  assertBars(bars, ["high", "low"]);
  const values = source ?? bars.map((bar) => bar.close);
  assertSeries(values);
  if (values.length !== bars.length) throw new RangeError("Source and bars must align");
  const highs = new ExtremeWindow(true),
    lows = new ExtremeWindow(false);
  let lastMissing = -1;
  return bars.map((bar, index) => {
    const high = highs.push(index, bar.high, length),
      low = lows.push(index, bar.low, length);
    if (bar.high === null || bar.low === null) lastMissing = index;
    const value = values[index]!;
    if (
      value === null ||
      index < length - 1 ||
      index - lastMissing < length ||
      high === null ||
      low === null
    )
      return null;
    const scale = Math.max(Math.abs(high), Math.abs(low), Math.abs(value));
    if (scale === 0 || high === low) return null;
    const difference = value - high,
      range = high - low;
    const numerator = Number.isFinite(difference)
      ? difference / scale
      : value / scale - high / scale;
    const denominator = Number.isFinite(range) ? range / scale : high / scale - low / scale;
    return denominator === 0 ? null : finiteOrNull(100 * (numerator / denominator));
  });
}
