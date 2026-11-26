import type { NumericValue, TechnicalBar } from "../types.js";
import { bounded, complete, finite, validate } from "./inputs.js";

/** Dense reference recurrence; unknown/overflow starts a new contiguous segment. */
export function parabolicSar(
  bars: readonly TechnicalBar[],
  start = 0.02,
  increment = 0.02,
  maximum = 0.2
): NumericValue[] {
  for (const value of [start, increment, maximum]) bounded(value, 0, 1);
  validate(bars, ["high", "low", "close"]);
  let result: NumericValue = null,
    extreme = 0,
    acceleration = start,
    below = false;
  let previous: TechnicalBar | null = null,
    twoBack: TechnicalBar | null = null;
  return bars.map((bar) => {
    if (!complete(bar)) {
      result = null;
      previous = twoBack = null;
      return null;
    }
    if (previous === null) {
      previous = bar;
      return null;
    }
    let first = false;
    if (result === null) {
      below = bar.close! > previous.close!;
      extreme = below ? bar.high! : bar.low!;
      result = below ? previous.low! : previous.high!;
      acceleration = start;
      first = true;
    }
    const projected = finite(result + acceleration * (extreme - result));
    if (projected === null) {
      result = null;
      previous = twoBack = null;
      return null;
    }
    result = projected;
    if ((below && result > bar.low!) || (!below && result < bar.high!)) {
      result = below ? Math.max(bar.high!, extreme) : Math.min(bar.low!, extreme);
      below = !below;
      extreme = below ? bar.high! : bar.low!;
      acceleration = start;
      first = true;
    }
    if (!first && (below ? bar.high! > extreme : bar.low! < extreme)) {
      extreme = below ? bar.high! : bar.low!;
      acceleration = Math.min(acceleration + increment, maximum);
    }
    result = below
      ? Math.min(result, previous.low!, twoBack?.low ?? Infinity)
      : Math.max(result, previous.high!, twoBack?.high ?? -Infinity);
    twoBack = previous;
    previous = bar;
    return result;
  });
}
