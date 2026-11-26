import type { NumericSeries, NumericValue, PriceSource, TechnicalBar } from "../types.js";
import { average, extrema, trueRange } from "./filters.js";
import {
  addScaled,
  barsInput,
  bounded,
  convex,
  finite,
  integer,
  period,
  prices
} from "./inputs.js";

export interface ChannelResult {
  readonly basis: NumericSeries;
  readonly upper: NumericSeries;
  readonly lower: NumericSeries;
}
export interface KeltnerOptions {
  readonly length?: number;
  readonly multiplier?: number;
  readonly source?: PriceSource;
  readonly useExponentialMa?: boolean;
  readonly bandsStyle?: "Average True Range" | "True Range" | "Range";
  readonly atrLength?: number;
}
export function keltnerChannels(
  bars: readonly TechnicalBar[],
  options: KeltnerOptions = {}
): ChannelResult {
  const {
    length = 20,
    multiplier = 2,
    source = "close",
    useExponentialMa = true,
    bandsStyle = "Average True Range",
    atrLength = 10
  } = options;
  period(length);
  period(atrLength);
  bounded(multiplier, 0, 1000000);
  if (
    typeof useExponentialMa !== "boolean" ||
    !["Average True Range", "True Range", "Range"].includes(bandsStyle)
  )
    throw new RangeError("Unknown Keltner option");
  barsInput(bars, source);
  const basis = average(prices(bars, source), length, useExponentialMa ? "EMA" : "SMA");
  const range =
    bandsStyle === "Range"
      ? average(
          bars.map((bar) =>
            bar.high === null || bar.low === null ? null : finite(bar.high - bar.low)
          ),
          length,
          "RMA"
        )
      : bandsStyle === "True Range"
        ? trueRange(bars)
        : average(trueRange(bars), atrLength, "RMA");
  const upper = basis.map((value, i) =>
    value === null || range[i] === null ? null : addScaled(value, range[i]!, multiplier)
  );
  const lower = basis.map((value, i) =>
    value === null || range[i] === null ? null : addScaled(value, range[i]!, -multiplier)
  );
  return { basis, upper, lower };
}
export interface DonchianOptions {
  readonly length?: number;
  readonly displayOffset?: number;
}
export function donchianChannels(
  bars: readonly TechnicalBar[],
  options: DonchianOptions = {}
): ChannelResult {
  const { length = 20, displayOffset = 0 } = options;
  period(length);
  integer(displayOffset, -10000, 10000);
  barsInput(bars, undefined, false);
  const upper = extrema(
    bars.map((bar) => bar.high),
    length,
    true
  );
  const lower = extrema(
    bars.map((bar) => bar.low),
    length,
    false
  );
  const basis = upper.map((value, i) =>
    value === null || lower[i] === null ? null : convex(value, lower[i]!, 0.5)
  );
  return { basis, upper, lower };
}
export interface ChandelierOptions {
  readonly length?: number;
  readonly atrLength?: number;
  readonly multiplier?: number;
}
export interface ChandelierResult {
  readonly longExit: NumericSeries;
  readonly shortExit: NumericSeries;
}
export function chandelierExit(
  bars: readonly TechnicalBar[],
  options: ChandelierOptions = {}
): ChandelierResult {
  const { length = 22, atrLength = 22, multiplier = 3 } = options;
  period(length);
  period(atrLength);
  bounded(multiplier, 0, 1000000);
  barsInput(bars);
  const high = extrema(
    bars.map((bar) => bar.high),
    length,
    true
  );
  const low = extrema(
    bars.map((bar) => bar.low),
    length,
    false
  );
  const atr = average(trueRange(bars), atrLength, "RMA");
  const level = (extreme: NumericValue, range: NumericValue, sign: number) =>
    extreme === null || range === null ? null : addScaled(extreme, range, sign * multiplier);
  return {
    longExit: high.map((value, i) => level(value, atr[i]!, -1)),
    shortExit: low.map((value, i) => level(value, atr[i]!, 1))
  };
}
