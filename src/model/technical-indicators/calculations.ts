import type { NumericSeries, NumericValue, TechnicalBar } from "./types.js";
import { assertTechnicalBars } from "./data.js";
import {
  assertLength,
  assertSeries,
  ema,
  finiteOrNull,
  populationDeviation,
  rma,
  sma
} from "./primitives.js";

/** Mirrors the published built-in RSI's adjacent change and zero-loss branch order. */
export function rsi(source: NumericSeries, length = 14): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  const changes = source.map((value, index) => {
    const before = source[index - 1];
    return value === null || before == null ? null : value - before;
  });
  const gains = rma(
      changes.map((value) => (value === null ? null : Math.max(value, 0))),
      length
    ),
    losses = rma(
      changes.map((value) => (value === null ? null : Math.max(-value, 0))),
      length
    );
  return gains.map((gain, index) => {
    const loss = losses[index];
    if (gain === null || loss == null) return null;
    return loss === 0 ? 100 : gain === 0 ? 0 : finiteOrNull(100 - 100 / (1 + gain / loss));
  });
}
export function macd(source: NumericSeries, fastLength = 12, slowLength = 26, signalLength = 9) {
  const fast = ema(source, fastLength),
    slow = ema(source, slowLength),
    line = fast.map((value, index) =>
      value === null || slow[index] == null ? null : finiteOrNull(value - slow[index])
    ),
    signal = ema(line, signalLength),
    histogram = line.map((value, index) =>
      value === null || signal[index] == null ? null : finiteOrNull(value - signal[index])
    );
  return { macd: line, signal, histogram };
}
export function bollingerBands(source: NumericSeries, length = 20, multiplier = 2) {
  if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 100)
    throw new RangeError("Invalid Bollinger multiplier");
  const basis = sma(source, length),
    deviation = populationDeviation(source, length);
  const shifted = (sign: number) =>
    basis.map((value, index) =>
      value === null || deviation[index] == null
        ? null
        : finiteOrNull(value + sign * multiplier * deviation[index])
    );
  return { basis, upper: shifted(1), lower: shifted(-1) };
}
/** ta.tr(true): missing preceding close falls back to the current high-low range. */
export function trueRange(bars: readonly TechnicalBar[]): NumericValue[] {
  assertTechnicalBars(bars);
  return bars.map((bar, index) => {
    if (bar.high === null || bar.low === null) return null;
    const previousClose = bars[index - 1]?.close;
    return previousClose == null
      ? bar.high - bar.low
      : Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previousClose),
          Math.abs(bar.low - previousClose)
        );
  });
}
export const atr = (bars: readonly TechnicalBar[], length = 14): NumericValue[] =>
  rma(trueRange(bars), length);

/** Extrema use the last length bar positions; na extrema are ignored, not zero-filled. */
function extremum(source: NumericSeries, length: number, maximum: boolean): NumericValue[] {
  const indices: number[] = [];
  let head = 0;
  return source.map((value, index) => {
    while (head < indices.length && indices[head]! <= index - length) head++;
    if (value !== null) {
      while (
        indices.length > head &&
        (maximum ? source[indices.at(-1)!]! <= value : source[indices.at(-1)!]! >= value)
      )
        indices.pop();
      indices.push(index);
    }
    if (head > 1024 && head * 2 > indices.length) {
      indices.splice(0, head);
      head = 0;
    }
    return head < indices.length ? source[indices[head]!]! : null;
  });
}
export function stochastic(bars: readonly TechnicalBar[], length = 14, smoothK = 3, smoothD = 3) {
  assertTechnicalBars(bars);
  assertLength(length);
  const highs = extremum(
      bars.map((bar) => bar.high),
      length,
      true
    ),
    lows = extremum(
      bars.map((bar) => bar.low),
      length,
      false
    ),
    raw = bars.map((bar, index) => {
      const high = highs[index],
        low = lows[index];
      return bar.close === null || high == null || low == null || high === low
        ? null
        : finiteOrNull((100 * (bar.close - low)) / (high - low));
    }),
    k = sma(raw, smoothK),
    d = sma(k, smoothD);
  return { raw, k, d };
}
