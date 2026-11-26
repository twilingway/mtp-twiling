import type { TechnicalBar } from "../types.js";
import { budget, bounded, input, optionsInput, period, treeVisits } from "./inputs.js";
import { deviation, numbers, recursive, rolling, scalars, RecursiveMean } from "./filters.js";
import { add, multiply, number, ratio, scalar, times, ZERO, type Scalar } from "./numeric.js";

export const VOLATILITY_MA_TYPES = [
  "None",
  "SMA",
  "SMA + Bollinger Bands",
  "EMA",
  "SMMA (RMA)",
  "WMA",
  "VWMA"
] as const;
export type VolatilityMaType = (typeof VOLATILITY_MA_TYPES)[number];
export interface RelativeVolatilityOptions {
  readonly length?: number;
  readonly offset?: number;
  readonly maType?: VolatilityMaType;
  readonly maLength?: number;
  readonly bbMultiplier?: number;
}
export function relativeVolatilityIndex(
  bars: readonly TechnicalBar[],
  options: RelativeVolatilityOptions = {}
) {
  optionsInput(options, ["length", "offset", "maType", "maLength", "bbMultiplier"]);
  const { length = 10, offset = 0, maType = "SMA", maLength = 14, bbMultiplier = 2 } = options;
  [length, maLength].forEach(period);
  bounded(offset, -500, 500, true);
  bounded(bbMultiplier, 0.001, 50);
  if (!VOLATILITY_MA_TYPES.includes(maType)) throw new RangeError("Unknown volatility MA type");
  input(bars, maType === "VWMA" ? ["close", "volume"] : ["close"]);
  const windows = maType === "SMA + Bollinger Bands" || maType === "VWMA" ? 2 : 1;
  budget(bars.length, 10 + treeVisits(length) + windows * treeVisits(maLength));
  const stddev = deviation(scalars(bars.map((bar) => bar.close)), length);
  const upper = new RecursiveMean(14, "EMA");
  const lower = new RecursiveMean(14, "EMA");
  const value = bars.map((bar, index) => {
    const previous = index === 0 ? null : bars[index - 1]!.close;
    const knownChange = previous !== null && bar.close !== null;
    // Pine v6 comparisons involving na are false: preserve both distinct conditionals.
    const nonIncreasing = knownChange && bar.close <= previous;
    const increasing = knownChange && bar.close > previous;
    const up = upper.push(nonIncreasing ? ZERO : stddev[index]!);
    const down = lower.push(increasing ? ZERO : stddev[index]!);
    return up === null || down === null ? null : ratio(up, add(up, down), 100);
  });
  const source = scalars(value);
  let smoothing: (Scalar | null)[];
  switch (maType) {
    case "None":
      smoothing = bars.map(() => null);
      break;
    case "EMA":
    case "SMMA (RMA)":
      smoothing = recursive(source, maLength, maType === "EMA" ? "EMA" : "RMA");
      break;
    case "VWMA": {
      const volume = bars.map((bar) => (bar.volume === null ? null : scalar(bar.volume)));
      const products = source.map((value, i) => {
        const weight = volume[i]!;
        return value === null || weight === null ? null : multiply(value, weight);
      });
      const numerator = rolling(products, maLength);
      const denominator = rolling(volume, maLength);
      smoothing = numerator.map((top, i) => {
        const bottom = denominator[i]!;
        const result = top === null || bottom === null ? null : ratio(top, bottom);
        return result === null ? null : scalar(result);
      });
      break;
    }
    default:
      smoothing = rolling(source, maLength, maType === "WMA");
  }
  const spread = maType === "SMA + Bollinger Bands" ? deviation(source, maLength) : null;
  const band = (sign: 1 | -1) =>
    smoothing.map((mean, i) => {
      const deviation = spread?.[i];
      return mean === null || deviation === null || deviation === undefined
        ? null
        : number(add(mean, times(deviation, sign * bbMultiplier)));
    });
  return { value, smoothing: numbers(smoothing), upperBand: band(1), lowerBand: band(-1) };
}
