import { finiteOrNull } from "../primitives.js";
import type { NumericValue, TechnicalBar } from "../types.js";

/** Only consumed OHLC fields are validated; timestamp alignment remains owned by the caller. */
export function assertTrendBars(bars: readonly TechnicalBar[], requireClose = true): void {
  for (const bar of bars) {
    if (bar == null) throw new RangeError("Trend bars must not contain holes");
    for (const value of requireClose ? [bar.high, bar.low, bar.close] : [bar.high, bar.low])
      if (value !== null && !Number.isFinite(value))
        throw new RangeError("Trend fields must be finite or null");
    if (bar.high !== null && bar.low !== null && bar.high < bar.low)
      throw new RangeError("High must not be below low");
    if (
      requireClose &&
      bar.close !== null &&
      ((bar.high !== null && bar.close > bar.high) || (bar.low !== null && bar.close < bar.low))
    )
      throw new RangeError("Close outside candle range");
  }
}

export function present(bar: TechnicalBar): boolean {
  return bar.high !== null && bar.low !== null && bar.close !== null;
}

/** false is ta.tr; true is ta.tr(true), whose first observation is current high-low. */
export function trendTrueRange(bars: readonly TechnicalBar[], fallback: boolean): NumericValue[] {
  return bars.map((bar, index) => {
    if (bar.high === null || bar.low === null) return null;
    const previous = bars[index - 1]?.close;
    if (previous == null) return fallback ? finiteOrNull(bar.high - bar.low) : null;
    return finiteOrNull(
      Math.max(bar.high - bar.low, Math.abs(bar.high - previous), Math.abs(bar.low - previous))
    );
  });
}
