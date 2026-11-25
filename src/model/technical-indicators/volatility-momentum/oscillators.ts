import { assertLength, assertSeries, ema, finiteOrNull } from "../primitives.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "../types.js";
import { assertBarFields, positiveLog } from "./validation.js";
import { RollingMoments } from "./windows.js";

/** Public built-in fixed periods: fast 5, slow 34, source HL2. */
export function awesomeOscillator(bars: readonly TechnicalBar[]): NumericValue[] {
  assertBarFields(bars, ["high", "low"]);
  const fast = new RollingMoments(5),
    slow = new RollingMoments(34);
  return bars.map((bar) => {
    if (bar.high === null || bar.low === null) return null;
    const range = bar.high - bar.low;
    const midpoint = Number.isFinite(range) ? bar.low + range / 2 : bar.high / 2 + bar.low / 2,
      short = fast.push(midpoint),
      long = slow.push(midpoint);
    return short === null || long === null ? null : finiteOrNull(short.mean - long.mean);
  });
}

export function balanceOfPower(bars: readonly TechnicalBar[]): NumericValue[] {
  assertBarFields(bars, ["open", "high", "low", "close"]);
  return bars.map((bar) => {
    if (
      bar.open === null ||
      bar.high === null ||
      bar.low === null ||
      bar.close === null ||
      bar.high === bar.low
    )
      return null;
    const scale = Math.max(
      Math.abs(bar.open),
      Math.abs(bar.high),
      Math.abs(bar.low),
      Math.abs(bar.close)
    );
    const change = bar.close - bar.open,
      range = bar.high - bar.low;
    const numerator = Number.isFinite(change)
      ? change / scale
      : bar.close / scale - bar.open / scale;
    const denominator = Number.isFinite(range) ? range / scale : bar.high / scale - bar.low / scale;
    return denominator === 0 ? null : finiteOrNull(numerator / denominator);
  });
}

/** Complete consecutive adjacent changes; gap recovery is conservative, not Pine sparse parity. */
export function cmo(source: NumericSeries, length = 9): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  const gains = new RollingMoments(length),
    losses = new RollingMoments(length);
  return source.map((value, index) => {
    const previous = source[index - 1];
    const change = value === null || previous == null ? null : finiteOrNull(value - previous);
    if (change === null) {
      gains.reset();
      losses.reset();
      return null;
    }
    const gain = gains.push(Math.max(change, 0)),
      loss = losses.push(Math.max(-change, 0));
    if (gain === null || loss === null) return null;
    const scale = Math.max(gain.mean, loss.mean);
    if (scale === 0) return null;
    return finiteOrNull(
      100 * ((gain.mean / scale - loss.mean / scale) / (gain.mean / scale + loss.mean / scale))
    );
  });
}

export function ultimateOscillator(
  bars: readonly TechnicalBar[],
  fastLength = 7,
  middleLength = 14,
  slowLength = 28
): NumericValue[] {
  for (const length of [fastLength, middleLength, slowLength]) assertLength(length);
  assertBarFields(bars, ["high", "low", "close"]);
  const windows = [fastLength, middleLength, slowLength].map((length) => ({
    bp: new RollingMoments(length),
    tr: new RollingMoments(length)
  }));
  return bars.map((bar, index) => {
    const previous = bars[index - 1]?.close;
    if (bar.high === null || bar.low === null || bar.close === null || previous == null) {
      windows.forEach(({ bp, tr }) => {
        bp.reset();
        tr.reset();
      });
      return null;
    }
    const bottom = Math.min(bar.low, previous),
      pressure = finiteOrNull(bar.close - bottom),
      range = finiteOrNull(Math.max(bar.high, previous) - bottom);
    if (pressure === null || range === null) {
      windows.forEach(({ bp, tr }) => {
        bp.reset();
        tr.reset();
      });
      return null;
    }
    const ratios = windows.map(({ bp, tr }) => {
      const numerator = bp.push(pressure),
        denominator = tr.push(range);
      return numerator === null || denominator === null || denominator.mean === 0
        ? null
        : finiteOrNull(numerator.mean / denominator.mean);
    });
    return ratios.some((value) => value === null)
      ? null
      : finiteOrNull((100 * (4 * ratios[0]! + 2 * ratios[1]! + ratios[2]!)) / 7);
  });
}

/** Actual TradingView built-in: change of triple EMA(log(source)), scaled by 10000, not percentROC. */
export function trix(source: NumericSeries, length = 18): NumericValue[] {
  assertLength(length);
  assertSeries(source);
  const logs = source.map(positiveLog),
    triple = ema(ema(ema(logs, length), length), length);
  return triple.map((value, index) => {
    const previous = triple[index - 1];
    return logs[index] === null || value === null || previous == null
      ? null
      : finiteOrNull(10000 * (value - previous));
  });
}
