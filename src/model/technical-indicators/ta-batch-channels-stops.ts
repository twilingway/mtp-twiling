import type { NumericSeries, NumericValue, PriceSource, TechnicalBar } from "./types.js";
import { average, extrema, trueRange } from "./channel-average/filters.js";
import { addScaled, barsInput, bounded, period, prices } from "./channel-average/inputs.js";

export const chandeKrollStopDefaults = Object.freeze({
  atrLength: 10,
  multiplier: 1,
  stopLength: 9
} as const);

export interface ChandeKrollStopOptions {
  readonly atrLength?: number;
  readonly multiplier?: number;
  readonly stopLength?: number;
}

export interface ChandeKrollStopResult {
  readonly highStop: NumericSeries;
  readonly lowStop: NumericSeries;
}

export function chandeKrollStop(
  bars: readonly TechnicalBar[],
  options: ChandeKrollStopOptions = {}
): ChandeKrollStopResult {
  const {
    atrLength = chandeKrollStopDefaults.atrLength,
    multiplier = chandeKrollStopDefaults.multiplier,
    stopLength = chandeKrollStopDefaults.stopLength
  } = options;
  period(atrLength);
  period(stopLength);
  bounded(multiplier, 0, 1000000);
  barsInput(bars);
  const atr = average(trueRange(bars), atrLength, "RMA");
  const high = extrema(
    bars.map((bar) => bar.high),
    atrLength,
    true
  );
  const low = extrema(
    bars.map((bar) => bar.low),
    atrLength,
    false
  );
  const initialStop = (value: NumericValue, i: number, factor: number) => {
    const range = atr[i]!;
    return value === null || range === null ? null : addScaled(value, range, factor);
  };
  return {
    highStop: extrema(
      high.map((value, i) => initialStop(value, i, -multiplier)),
      stopLength,
      true
    ),
    lowStop: extrema(
      low.map((value, i) => initialStop(value, i, multiplier)),
      stopLength,
      false
    )
  };
}

export const volatilityStopDefaults = Object.freeze({
  length: 20,
  multiplier: 2,
  source: "close"
} as const);

export interface VolatilityStopOptions {
  readonly length?: number;
  readonly multiplier?: number;
  readonly source?: PriceSource;
}

export interface VolatilityStopResult {
  readonly value: NumericSeries;
  /** +1 is an uptrend and -1 is a downtrend. */
  readonly direction: readonly (1 | -1 | null)[];
}

export function volatilityStop(
  bars: readonly TechnicalBar[],
  options: VolatilityStopOptions = {}
): VolatilityStopResult {
  const {
    length = volatilityStopDefaults.length,
    multiplier = volatilityStopDefaults.multiplier,
    source = volatilityStopDefaults.source
  } = options;
  period(length);
  bounded(multiplier, 0, 1000000);
  barsInput(bars, source);
  const sourceValues = prices(bars, source);
  const ranges = trueRange(bars).map((value, i) => (sourceValues[i] === null ? null : value));
  const atr = average(ranges, length, "RMA");
  const direction: (1 | -1 | null)[] = Array<1 | -1 | null>(bars.length).fill(null);
  let previous: NumericValue = null;
  let extreme = 0;
  let uptrend = true;
  const value = sourceValues.map((price, i) => {
    const range = atr[i]!;
    if (price === null || range === null) {
      previous = null;
      return null;
    }
    if (previous === null) {
      extreme = price;
      uptrend = true;
    }
    extreme = uptrend ? Math.max(extreme, price) : Math.min(extreme, price);
    const candidate = addScaled(extreme, range, uptrend ? -multiplier : multiplier);
    if (candidate === null) {
      previous = null;
      return null;
    }
    previous =
      previous === null
        ? candidate
        : uptrend
          ? Math.max(previous, candidate)
          : Math.min(previous, candidate);
    const nextUptrend = price >= previous;
    if (nextUptrend !== uptrend) {
      uptrend = nextUptrend;
      extreme = price;
      previous = addScaled(price, range, uptrend ? -multiplier : multiplier);
    }
    direction[i] = previous === null ? null : uptrend ? 1 : -1;
    return previous;
  });
  return { value, direction };
}
