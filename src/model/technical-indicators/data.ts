import type { NumericValue, PriceSource, TechnicalBar } from "./types.js";
import { finiteOrNull } from "./primitives.js";

export function assertTechnicalBars(bars: readonly TechnicalBar[]): void {
  let previous = -1;
  for (const bar of bars) {
    if (!Number.isFinite(bar.timestamp) || bar.timestamp < 0 || bar.timestamp <= previous)
      throw new RangeError("Technical indicator timestamps must be finite and strictly increasing");
    previous = bar.timestamp;
    for (const value of [bar.open, bar.high, bar.low, bar.close, bar.volume])
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value)))
        throw new RangeError("Technical indicator fields must be finite or null");
    if (bar.volume !== null && bar.volume < 0) throw new RangeError("Negative candle volume");
    if (bar.high !== null && bar.low !== null && bar.low > bar.high)
      throw new RangeError("Invalid candle range");
    for (const value of [bar.open, bar.close])
      if (
        value !== null &&
        ((bar.high !== null && value > bar.high) || (bar.low !== null && value < bar.low))
      )
        throw new RangeError("Price outside candle range");
  }
}
export function priceSource(bars: readonly TechnicalBar[], source: PriceSource): NumericValue[] {
  return bars.map((bar) => {
    if (source === "hl2")
      return bar.high === null || bar.low === null
        ? null
        : finiteOrNull(bar.high / 2 + bar.low / 2);
    if (source === "hlc3")
      return bar.high === null || bar.low === null || bar.close === null
        ? null
        : finiteOrNull(bar.high / 3 + bar.low / 3 + bar.close / 3);
    if (source === "ohlc4")
      return bar.open === null || bar.high === null || bar.low === null || bar.close === null
        ? null
        : finiteOrNull(bar.open / 4 + bar.high / 4 + bar.low / 4 + bar.close / 4);
    return bar[source];
  });
}
