import type { NumericValue, TechnicalBar } from "../types.js";
import { ExtremeIndexWindow } from "../trend-strength/extrema.js";
import { finite, midpoint, period, validate } from "./inputs.js";

export function fisherTransform(bars: readonly TechnicalBar[], length = 9) {
  period(length);
  validate(bars, ["high", "low"]);
  const highs = new ExtremeIndexWindow(true),
    lows = new ExtremeIndexWindow(false);
  let normalized: NumericValue = null,
    previous: NumericValue = null;
  const value: NumericValue[] = [],
    trigger: NumericValue[] = [];
  bars.forEach((bar, i) => {
    const source = midpoint(bar.high, bar.low);
    const high = highs.push(i, source, length),
      low = lows.push(i, source, length);
    let current: NumericValue = null,
      next: NumericValue = null;
    if (source !== null && high !== null && low !== null && high.value !== low.value) {
      const span = finite(high.value - low.value),
        change = finite(source - low.value);
      if (span !== null && change !== null) {
        const raw = finite(0.66 * (change / span - 0.5) + 0.67 * (normalized ?? 0));
        if (raw !== null) {
          next = raw > 0.99 ? 0.999 : raw < -0.99 ? -0.999 : raw;
          current = finite(0.5 * Math.log((1 + next) / (1 - next)) + 0.5 * (previous ?? 0));
        }
      }
    }
    trigger.push(previous);
    value.push(current);
    normalized = next;
    previous = current;
  });
  return { value, trigger };
}
