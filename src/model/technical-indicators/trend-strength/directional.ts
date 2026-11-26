import { assertLength, finiteOrNull, rma } from "../primitives.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "../types.js";
import { assertTrendBars, present, trendTrueRange } from "./inputs.js";

/** fixnan holds only an actually known prior ratio; initial 0/0 remains unknown. */
function directionalRatio(movement: NumericSeries, range: NumericSeries): NumericValue[] {
  let previous: NumericValue = null;
  return movement.map((value, index) => {
    const denominator = range[index];
    const ratio =
      value === null || denominator == null || denominator === 0
        ? null
        : finiteOrNull(100 * (value / denominator));
    if (ratio !== null) previous = ratio;
    return previous;
  });
}

export function dmi(bars: readonly TechnicalBar[], diLength = 14, adxSmoothing = 14) {
  assertLength(diLength);
  assertLength(adxSmoothing);
  assertTrendBars(bars);
  const plusDM: NumericValue[] = [],
    minusDM: NumericValue[] = [];
  bars.forEach((bar, index) => {
    const previous = bars[index - 1];
    if (bar.high === null || bar.low === null || previous?.high == null || previous.low === null) {
      plusDM.push(null);
      minusDM.push(null);
      return;
    }
    const up = finiteOrNull(bar.high - previous.high),
      down = finiteOrNull(previous.low - bar.low);
    if (up === null || down === null) {
      plusDM.push(null);
      minusDM.push(null);
      return;
    }
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  });
  const rawRange = trendTrueRange(bars, false),
    range = rma(rawRange, diLength);
  const plus = directionalRatio(rma(plusDM, diLength), range),
    minus = directionalRatio(rma(minusDM, diLength), range);
  const dx = plus.map((value, index) => {
    const other = minus[index];
    if (value === null || other == null) return null;
    const scale = Math.max(value, other);
    return scale === 0
      ? 0
      : Math.abs(value / scale - other / scale) / (value / scale + other / scale);
  });
  const smoothed = rma(dx, adxSmoothing);
  const mask = (values: NumericSeries) =>
    values.map((value, index) =>
      present(bars[index]!) &&
      rawRange[index] !== null &&
      plusDM[index] !== null &&
      minusDM[index] !== null
        ? value
        : null
    );
  return {
    plusDI: mask(plus),
    minusDI: mask(minus),
    adx: mask(smoothed.map((value) => (value === null ? null : finiteOrNull(100 * value))))
  };
}

/** Same verified Wilder/fixnan pipeline as the separate public ADX built-in. */
export function adx(
  bars: readonly TechnicalBar[],
  diLength = 14,
  adxSmoothing = 14
): NumericValue[] {
  return dmi(bars, diLength, adxSmoothing).adx;
}
