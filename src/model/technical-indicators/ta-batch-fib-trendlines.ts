import { atr } from "./calculations.js";
import { assertTechnicalBars } from "./data.js";
import { assertLength } from "./primitives.js";
import type { PivotAnchor } from "./ta-batch-fib-geometry.js";
import { swingPivotRuns } from "./ta-batch-fib-pivots.js";
import type { TechnicalBar } from "./types.js";

const TRENDLINE_LOOKBACK = 5000;

/** Alternating anchors used to build small and large trendline candidates. */
export function trendlinePivotRuns(bars: readonly TechnicalBar[], size: "small" | "large") {
  const ranges = atr(bars, 14);
  const radius = size === "small" ? 5 : 25;
  const multiplier = size === "small" ? 2 : 5;
  return swingPivotRuns(bars, {
    radius,
    fromIndex: Math.max(bars.length - TRENDLINE_LOOKBACK, 0),
    canUse: (point) => ranges[point.index] != null,
    acceptsReversal: (previous, distance) => distance > multiplier * ranges[previous.index]!
  });
}

export interface TrendlineBreakout {
  readonly firstOutsideIndex: number;
  readonly confirmedAt: number;
  readonly timestamp: number;
}

export function trendlineBreakout(
  bars: readonly TechnicalBar[],
  from: PivotAnchor,
  through: PivotAnchor,
  side: "support" | "resistance",
  closes = 3
): TrendlineBreakout | null {
  assertLength(closes);
  assertTechnicalBars(bars);
  if (
    !Number.isSafeInteger(from.index) ||
    !Number.isSafeInteger(through.index) ||
    from.index < 0 ||
    from.index >= through.index ||
    bars[from.index]?.timestamp !== from.timestamp ||
    bars[through.index]?.timestamp !== through.timestamp ||
    !Number.isFinite(from.value) ||
    !Number.isFinite(through.value)
  )
    throw new RangeError("Invalid trendline anchors");

  const slope = (through.value - from.value) / (through.index - from.index);
  let outside = 0;
  for (let index = through.index + 1; index < bars.length; index++) {
    const bar = bars[index]!;
    const value = through.value + slope * (index - through.index);
    if (
      bar.close === null ||
      !Number.isFinite(value) ||
      (side === "support" ? bar.close >= value : bar.close <= value)
    )
      outside = 0;
    else if (++outside === closes)
      return {
        firstOutsideIndex: index - closes + 1,
        confirmedAt: index,
        timestamp: bar.timestamp
      };
  }
  return null;
}
