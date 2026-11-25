import { assertLength, finiteOrNull } from "../primitives.js";
import type { NumericValue, TechnicalBar } from "../types.js";
import { assertBars, cumulative, relativeChange, typicalPrice } from "./validation.js";

export function obv(bars: readonly TechnicalBar[]): NumericValue[] {
  assertBars(bars, ["close", "volume"]);
  return cumulative(
    bars.map((bar, index) => {
      const previous = bars[index - 1]?.close;
      return bar.close === null || bar.volume === null || previous == null
        ? null
        : (bar.close > previous ? 1 : bar.close < previous ? -1 : 0) * bar.volume;
    })
  );
}

export function pvt(bars: readonly TechnicalBar[]): NumericValue[] {
  assertBars(bars, ["close", "volume"]);
  return cumulative(
    bars.map((bar, index) => {
      const previous = bars[index - 1]?.close;
      if (bar.close === null || bar.volume === null || previous == null) return null;
      const change = relativeChange(bar.close, previous);
      return change === null ? null : finiteOrNull(change * bar.volume);
    })
  );
}

export function accumulationDistribution(bars: readonly TechnicalBar[]): NumericValue[] {
  assertBars(bars, ["high", "low", "close", "volume"]);
  return cumulative(
    bars.map((bar) => {
      if (bar.high === null || bar.low === null || bar.close === null || bar.volume === null)
        return null;
      if (bar.high === bar.low) return 0;
      const scale = Math.max(Math.abs(bar.high), Math.abs(bar.low), Math.abs(bar.close));
      const upper = bar.close - bar.low,
        lower = bar.high - bar.close,
        range = bar.high - bar.low;
      const numerator =
        (Number.isFinite(upper) ? upper / scale : bar.close / scale - bar.low / scale) -
        (Number.isFinite(lower) ? lower / scale : bar.high / scale - bar.close / scale);
      const denominator = Number.isFinite(range)
        ? range / scale
        : bar.high / scale - bar.low / scale;
      return finiteOrNull((numerator / denominator) * bar.volume);
    })
  );
}

interface Flow {
  positive: number;
  negative: number;
  valid: boolean;
}

/** Full positional window of length adjacent changes; missing flows invalidate that window. */
export function mfi(bars: readonly TechnicalBar[], length = 14): NumericValue[] {
  assertLength(length);
  if (length > 2000) throw new RangeError("MFI length must not exceed 2000");
  assertBars(bars, ["high", "low", "close", "volume"]);
  const prices = bars.map(typicalPrice),
    window: Flow[] = [];
  let position = 0,
    positive = 0,
    negative = 0,
    invalid = 0,
    sinceRebase = 0;
  return bars.map((bar, index) => {
    const price = prices[index]!,
      previous = prices[index - 1];
    const raw = price === null || bar.volume === null ? null : finiteOrNull(price * bar.volume);
    const flow: Flow = { positive: 0, negative: 0, valid: raw !== null && previous != null };
    if (flow.valid && price !== null && previous != null && raw !== null) {
      if (price > previous) flow.positive = raw;
      else if (price < previous) flow.negative = raw;
    }
    let cancellation = false;
    if (window.length === length) {
      const old = window[position]!;
      positive -= old.positive;
      negative -= old.negative;
      cancellation =
        (old.positive !== 0 && Math.abs(positive) < Math.abs(old.positive) * 1e-6) ||
        (old.negative !== 0 && Math.abs(negative) < Math.abs(old.negative) * 1e-6);
      invalid -= Number(!old.valid);
      window[position] = flow;
      position = (position + 1) % length;
    } else window.push(flow);
    positive += flow.positive;
    negative += flow.negative;
    invalid += Number(!flow.valid);
    sinceRebase++;
    if (
      cancellation ||
      sinceRebase >= length ||
      !Number.isFinite(positive) ||
      !Number.isFinite(negative)
    ) {
      positive = 0;
      negative = 0;
      for (const item of window) {
        positive += item.positive;
        negative += item.negative;
      }
      sinceRebase = 0;
    }
    if (
      window.length < length ||
      invalid > 0 ||
      !Number.isFinite(positive) ||
      !Number.isFinite(negative)
    )
      return null;
    const scale = Math.max(Math.abs(positive), Math.abs(negative));
    if (scale === 0) return null;
    const denominator = positive / scale + negative / scale;
    return denominator === 0 ? null : finiteOrNull(100 * (positive / scale / denominator));
  });
}
