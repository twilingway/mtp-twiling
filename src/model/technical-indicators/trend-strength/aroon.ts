import { assertLength } from "../primitives.js";
import type { NumericValue, TechnicalBar } from "../types.js";
import { ExtremeIndexWindow } from "./extrema.js";
import { assertTrendBars } from "./inputs.js";

/** n+1 bar window, available partial history; most-recent ties are an explicit local policy. */
export function aroon(bars: readonly TechnicalBar[], length = 14) {
  assertLength(length);
  assertTrendBars(bars, false);
  const highs = new ExtremeIndexWindow(true),
    lows = new ExtremeIndexWindow(false);
  const up: NumericValue[] = [],
    down: NumericValue[] = [];
  bars.forEach((bar, index) => {
    const high = highs.push(index, bar.high, length + 1),
      low = lows.push(index, bar.low, length + 1);
    up.push(
      bar.high === null || high === null ? null : (100 * (length - (index - high.index))) / length
    );
    down.push(
      bar.low === null || low === null ? null : (100 * (length - (index - low.index))) / length
    );
  });
  return { up, down };
}

export function aroonOscillator(bars: readonly TechnicalBar[], length = 14): NumericValue[] {
  const { up, down } = aroon(bars, length);
  return up.map((value, index) =>
    value === null || down[index] === null ? null : value - down[index]!
  );
}
