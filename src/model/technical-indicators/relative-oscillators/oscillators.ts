import type { NumericValue, PriceSource, TechnicalBar } from "../types.js";
import {
  budget,
  bounded,
  input,
  optionsInput,
  period,
  prices,
  sourceFields,
  treeVisits
} from "./inputs.js";
import { extrema, numbers, recursive, rolling, scalars, swma, RecursiveMean } from "./filters.js";
import { add, difference, number, ratio, scalar, times, ZERO, type Scalar } from "./numeric.js";

export interface StochasticRsiOptions {
  readonly rsiLength?: number;
  readonly stochasticLength?: number;
  readonly smoothK?: number;
  readonly smoothD?: number;
  readonly source?: PriceSource;
}
export function stochasticRsi(bars: readonly TechnicalBar[], options: StochasticRsiOptions = {}) {
  optionsInput(options, ["rsiLength", "stochasticLength", "smoothK", "smoothD", "source"]);
  const {
    rsiLength = 14,
    stochasticLength = 14,
    smoothK = 3,
    smoothD = 3,
    source = "close"
  } = options;
  [rsiLength, stochasticLength, smoothK, smoothD].forEach(period);
  input(bars, sourceFields(source));
  budget(bars.length, 8 + treeVisits(smoothK) + treeVisits(smoothD));
  const values = prices(bars, source);
  const gain = new RecursiveMean(rsiLength, "RMA");
  const loss = new RecursiveMean(rsiLength, "RMA");
  let previousRsi: NumericValue = null;
  const rsi = values.map((value, index): NumericValue => {
    const previous = index === 0 ? null : values[index - 1]!;
    const change = value === null || previous === null ? null : difference(value, previous);
    const up = gain.push(change === null ? null : change.unit > 0 ? change : ZERO);
    const down = loss.push(change === null ? null : change.unit < 0 ? times(change, -1) : ZERO);
    if (up === null || down === null) return null;
    // With L>1 a zero change scales both RMAs by the same factor. Preserve that exact ratio;
    // independent rounding must not turn a flat RSI into a spurious stoch extremum.
    const result =
      change?.unit === 0 && rsiLength > 1 && previousRsi !== null
        ? previousRsi
        : ratio(up, add(up, down), 100);
    previousRsi = result;
    return result;
  });
  const high = extrema(rsi, stochasticLength, true);
  const low = extrema(rsi, stochasticLength, false);
  const raw = rsi.map((value, index) => {
    const top = high[index]!;
    const bottom = low[index]!;
    if (value === null || top === null || bottom === null) return null;
    return ratio(difference(value, bottom), difference(top, bottom), 100);
  });
  const k = rolling(scalars(raw), smoothK);
  return { k: numbers(k), d: numbers(rolling(k, smoothD)) };
}

export interface RelativeVigorOptions {
  readonly length?: number;
  readonly offset?: number;
}
export function relativeVigorIndex(
  bars: readonly TechnicalBar[],
  options: RelativeVigorOptions = {}
) {
  optionsInput(options, ["length", "offset"]);
  const { length = 10, offset = 0 } = options;
  period(length);
  bounded(offset, -500, 500, true);
  input(bars, ["open", "high", "low", "close"]);
  budget(bars.length, 8 + 2 * treeVisits(length));
  const delta = (a: "close" | "high", b: "open" | "low") =>
    bars.map((bar) => (bar[a] === null || bar[b] === null ? null : difference(bar[a], bar[b])));
  // Both sums have exactly L known samples; their common factor L cancels in the ratio.
  const numerator = rolling(swma(delta("close", "open")), length);
  const denominator = rolling(swma(delta("high", "low")), length);
  const value = numerator.map((top, i) => {
    const bottom = denominator[i]!;
    return top === null || bottom === null ? null : ratio(top, bottom);
  });
  return { value, signal: numbers(swma(scalars(value))) };
}

export interface CoppockOptions {
  readonly wmaLength?: number;
  readonly longRocLength?: number;
  readonly shortRocLength?: number;
}
export function coppockCurve(bars: readonly TechnicalBar[], options: CoppockOptions = {}) {
  optionsInput(options, ["wmaLength", "longRocLength", "shortRocLength"]);
  const { wmaLength = 10, longRocLength = 14, shortRocLength = 11 } = options;
  [wmaLength, longRocLength, shortRocLength].forEach(period);
  input(bars, ["close"]);
  budget(bars.length, 5 + treeVisits(wmaLength));
  const roc = (index: number, length: number): Scalar | null => {
    const current = bars[index]!.close;
    const previous = index < length ? null : bars[index - length]!.close;
    if (current === null || previous === null || previous === 0) return null;
    const delta = difference(current, previous);
    // Retain extended exponent through WMA; only final public outputs require finite doubles.
    const divisor = scalar(previous);
    return times(scalar(delta.unit / divisor.unit, delta.exponent - divisor.exponent), 100);
  };
  const combined = bars.map((_, index) => {
    const long = roc(index, longRocLength);
    const short = roc(index, shortRocLength);
    return long === null || short === null ? null : add(long, short);
  });
  return numbers(rolling(combined, wmaLength, true));
}

export interface BullBearOptions {
  readonly length?: number;
}
export function bullBearPower(bars: readonly TechnicalBar[], options: BullBearOptions = {}) {
  optionsInput(options, ["length"]);
  const { length = 13 } = options;
  period(length);
  input(bars, ["high", "low", "close"]);
  budget(bars.length, 5);
  const ema = recursive(scalars(bars.map((bar) => bar.close)), length, "EMA");
  return bars.map((bar, i) => {
    const average = ema[i]!;
    if (bar.high === null || bar.low === null || average === null) return null;
    return number(add(add(scalar(bar.high), scalar(bar.low)), times(average, -2)));
  });
}
