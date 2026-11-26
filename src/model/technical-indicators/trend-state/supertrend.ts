import type { NumericValue, TechnicalBar } from "../types.js";
import { Wilder } from "./filters.js";
import { bounded, complete, finite, midpoint, period, validate } from "./inputs.js";

export function supertrend(bars: readonly TechnicalBar[], atrLength = 10, factor = 3) {
  period(atrLength);
  bounded(factor, 0.01, 1_000_000);
  validate(bars, ["high", "low", "close", "open"]);
  const value: NumericValue[] = [],
    direction: NumericValue[] = [],
    upTrend: NumericValue[] = [],
    downTrend: NumericValue[] = [],
    bodyMiddle: NumericValue[] = [];
  let atrState = new Wilder(atrLength),
    previous: TechnicalBar | null = null;
  let upper: NumericValue = null,
    lower: NumericValue = null,
    previousAtr: NumericValue = null,
    previousValue: NumericValue = null;
  const reset = () => {
    atrState = new Wilder(atrLength);
    previous = null;
    upper = lower = previousAtr = previousValue = null;
  };
  bars.forEach((bar, i) => {
    let output: NumericValue = null,
      trend: NumericValue = null;
    if (!complete(bar)) reset();
    else {
      const range = finite(
        Math.max(
          bar.high! - bar.low!,
          previous === null ? 0 : Math.abs(bar.high! - previous.close!),
          previous === null ? 0 : Math.abs(bar.low! - previous.close!)
        )
      );
      if (range === null) reset();
      else {
        const atr = atrState.push(range),
          center = midpoint(bar.high, bar.low)!;
        const rawUpper = atr === null ? null : finite(center + factor * atr);
        const rawLower = atr === null ? null : finite(center - factor * atr);
        if (atr !== null && (rawUpper === null || rawLower === null)) reset();
        else {
          const oldUpper = upper ?? 0,
            oldLower = lower ?? 0;
          lower =
            (rawLower !== null && rawLower > oldLower) ||
            (previous !== null && previous.close! < oldLower)
              ? rawLower
              : oldLower;
          upper =
            (rawUpper !== null && rawUpper < oldUpper) ||
            (previous !== null && previous.close! > oldUpper)
              ? rawUpper
              : oldUpper;
          trend =
            previousAtr === null
              ? 1
              : previousValue === oldUpper
                ? bar.close! > upper!
                  ? -1
                  : 1
                : bar.close! < lower!
                  ? 1
                  : -1;
          previousValue = trend === -1 ? lower : upper;
          // A known ATR is required for a price output; internal nz state is never a fake quote.
          output = atr === null || previous === null ? null : previousValue;
          previousAtr = atr;
          previous = bar;
        }
      }
    }
    value.push(output);
    direction.push(trend);
    upTrend.push(trend === -1 ? output : null);
    downTrend.push(trend === 1 ? output : null);
    bodyMiddle.push(i === 0 ? null : midpoint(bar.open, bar.close));
  });
  return { value, direction, upTrend, downTrend, bodyMiddle };
}
