import { rsi } from "./calculations.js";
import { roc } from "./momentum-volume/oscillators.js";
import { assertLength } from "./primitives.js";
import type { NumericSeries, NumericValue } from "./types.js";

function streak(source: NumericSeries): NumericValue[] {
  // A known first close starts the streak at zero. Gaps break adjacency.
  let count = 0;
  return source.map((price, index) => {
    const previous = source[index - 1];
    if (price === null || previous == null) count = 0;
    else if (price > previous) count = Math.max(0, count) + 1;
    else if (price < previous) count = Math.min(0, count) - 1;
    else count = 0;
    return price === null ? null : count;
  });
}

/** Counts strictly smaller returns in the previous positional window. */
function percentRank(returns: NumericSeries, length: number): NumericValue[] {
  const unique = Array.from(new Set(returns.filter((value) => value !== null))).sort(
    (a, b) => a - b
  );
  const ranks = new Map(unique.map((value, index) => [value, index + 1]));
  const counts = new Int32Array(unique.length + 1);
  let known = 0;
  const add = (value: NumericValue, delta: number) => {
    if (value === null) return;
    known += delta;
    for (let rank = ranks.get(value)!; rank < counts.length; rank += rank & -rank)
      counts[rank] = counts[rank]! + delta;
  };
  return returns.map((value, index) => {
    let output: NumericValue = null;
    if (value !== null && known === length) {
      let lower = 0;
      for (let rank = ranks.get(value)! - 1; rank > 0; rank -= rank & -rank) lower += counts[rank]!;
      output = (100 * lower) / length;
    }
    add(returns[index - length] ?? null, -1);
    add(value, 1);
    return output;
  });
}

export function connorsRsi(
  source: NumericSeries,
  { priceLength = 3, streakLength = 2, rankLength = 100 } = {}
) {
  [priceLength, streakLength, rankLength].forEach(assertLength);
  const rank = percentRank(roc(source, 1), rankLength);
  // A common power-of-two scale keeps RSI unchanged and prevents overflowing adjacent changes.
  const rsiSource = source.some((price, index) => {
    const previous = source[index - 1];
    return price !== null && previous != null && !Number.isFinite(price - previous);
  })
    ? source.map((price) => (price === null ? null : price / 2))
    : source;
  const priceRsi = rsi(rsiSource, priceLength);
  const streakRsi = rsi(streak(source), streakLength);
  const value = rank.map((percent, index) => {
    const price = priceRsi[index];
    const run = streakRsi[index];
    return percent === null || price == null || run == null ? null : (price + run + percent) / 3;
  });
  return { value };
}
