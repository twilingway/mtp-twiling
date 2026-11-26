import { assertLength, finiteOrNull, sma } from "./primitives.js";
import { ExtremeIndexWindow } from "./trend-strength/extrema.js";
import type { NumericValue, TechnicalBar } from "./types.js";

type RangeBar = Pick<TechnicalBar, "high" | "low">;
type PivotBar = RangeBar & Pick<TechnicalBar, "timestamp">;

export interface PivotStrength {
  readonly left: number;
  readonly right: number;
}

export interface ConfirmedPivot {
  readonly kind: "high" | "low";
  readonly timestamp: number;
  readonly confirmedTimestamp: number;
  readonly value: number;
}

export function assertPriceRange(bar: RangeBar): void {
  if (
    (bar.high !== null && !Number.isFinite(bar.high)) ||
    (bar.low !== null && !Number.isFinite(bar.low)) ||
    (bar.high !== null && bar.low !== null && bar.high < bar.low)
  ) {
    throw new RangeError("Invalid high/low values");
  }
}

/** One observation for each supplied period, in that period's price units. */
export function averageDailyRange(bars: readonly RangeBar[], length: number): NumericValue[] {
  const ranges = bars.map((bar) => {
    assertPriceRange(bar);
    return bar.high === null || bar.low === null ? null : finiteOrNull(bar.high - bar.low);
  });
  return sma(ranges, length).map((value, index) => (ranges[index] === null ? null : value));
}

function beatWindow(
  values: readonly NumericValue[],
  width: number,
  maximum: boolean,
  reverse: boolean
): boolean[] {
  const extremes = new ExtremeIndexWindow(maximum);
  const beats: boolean[] = [];
  let consecutive = 0;
  for (let step = 0; step < values.length; step++) {
    const index = reverse ? values.length - 1 - step : step;
    const previous = values[index + (reverse ? 1 : -1)] ?? null;
    const neighbor = extremes.push(step, previous, width);
    consecutive = previous === null ? 0 : consecutive + 1;
    const value = values[index]!;
    beats[index] =
      consecutive >= width &&
      value !== null &&
      neighbor !== null &&
      (maximum ? value > neighbor.value : value < neighbor.value);
  }
  return beats;
}

/** The caller supplies closed candles, including the right window that confirms each pivot. */
export function pivotPointsHighLow(
  bars: readonly PivotBar[],
  highStrength: PivotStrength,
  lowStrength: PivotStrength
): ConfirmedPivot[] {
  for (const strength of [highStrength, lowStrength]) {
    assertLength(strength.left);
    assertLength(strength.right);
  }
  let previous = -Infinity;
  for (const bar of bars) {
    assertPriceRange(bar);
    if (!Number.isSafeInteger(bar.timestamp) || bar.timestamp <= previous) {
      throw new RangeError("Expected ordered pivot timestamps");
    }
    previous = bar.timestamp;
  }

  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const highLeft = beatWindow(highs, highStrength.left, true, false);
  const highRight = beatWindow(highs, highStrength.right, true, true);
  const lowLeft = beatWindow(lows, lowStrength.left, false, false);
  const lowRight = beatWindow(lows, lowStrength.right, false, true);
  const result: ConfirmedPivot[] = [];
  for (const [index, bar] of bars.entries()) {
    if (highLeft[index] && highRight[index]) {
      result.push({
        kind: "high",
        timestamp: bar.timestamp,
        confirmedTimestamp: bars[index + highStrength.right]!.timestamp,
        value: bar.high!
      });
    }
    if (lowLeft[index] && lowRight[index]) {
      result.push({
        kind: "low",
        timestamp: bar.timestamp,
        confirmedTimestamp: bars[index + lowStrength.right]!.timestamp,
        value: bar.low!
      });
    }
  }
  return result;
}
