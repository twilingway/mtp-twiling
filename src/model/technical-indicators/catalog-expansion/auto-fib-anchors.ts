import { atr } from "../calculations.js";
import type { PivotAnchor } from "../ta-batch-fib-geometry.js";
import { swingPivotRuns } from "../ta-batch-fib-pivots.js";
import type { TechnicalBar } from "../types.js";

export const AUTO_FIB_ATR_LENGTH = 10;
const MIN_PULLBACK = 0.236;

function radiusForDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 2 || depth > 10000)
    throw new RangeError("Auto Fibonacci depth must be an integer in 2..10000");
  return Math.floor(depth / 2);
}

function newestClosedPriceRun(bars: readonly TechnicalBar[], lastBarClosed: boolean) {
  // An unknown open tail must not confirm a pivot. Older prices are not linked across missing bars.
  const end = lastBarClosed ? bars.length : Math.max(0, bars.length - 1);
  let start = end;
  while (start > 0) {
    const { high, low } = bars[start - 1]!;
    if (high === null || low === null) break;
    start--;
  }
  return { start, bars: bars.slice(start, end) };
}

function originalIndex(pivot: PivotAnchor, offset: number): PivotAnchor {
  return { index: pivot.index + offset, timestamp: pivot.timestamp, value: pivot.value };
}

export function autoFibRetracementAnchors(
  input: readonly TechnicalBar[],
  depth: number,
  deviation: number,
  lastBarClosed = false
): readonly [PivotAnchor, PivotAnchor] | null {
  if (!Number.isFinite(deviation) || deviation < 0 || deviation > 10000)
    throw new RangeError("Invalid Auto Fibonacci deviation");
  const radius = radiusForDepth(depth);
  const { bars, start } = newestClosedPriceRun(input, lastBarClosed);
  const averageRanges = atr(bars, AUTO_FIB_ATR_LENGTH);
  const run = swingPivotRuns(bars, {
    radius,
    acceptsReversal(previous, distance, candidate) {
      const close = bars[candidate.confirmedAt]!.close;
      const range = averageRanges[candidate.confirmedAt];
      if (!Number.isFinite(distance) || close === null || close === 0 || range == null)
        return false;
      if (previous.value === 0) return deviation === 0;
      return distance / Math.abs(previous.value) >= (range / Math.abs(close)) * deviation;
    }
  }).at(-1);
  const previous = run?.at(-2);
  const current = run?.at(-1);
  return previous && current
    ? [originalIndex(previous, start), originalIndex(current, start)]
    : null;
}

export function autoFibExtensionAnchors(
  input: readonly TechnicalBar[],
  depth: number,
  lastBarClosed = false
): readonly [PivotAnchor, PivotAnchor, PivotAnchor] | null {
  const radius = radiusForDepth(depth);
  const { bars, start } = newestClosedPriceRun(input, lastBarClosed);
  const run = swingPivotRuns(bars, { radius, ties: "both", acceptsReversal: () => true }).at(-1);
  if (!run) return null;

  for (let index = run.length - 1; index >= 2; index--) {
    const from = run[index - 2]!;
    const to = run[index - 1]!;
    const correction = run[index]!;
    const impulse = Math.abs(to.value - from.value);
    const pullback = Math.abs(to.value - correction.value);
    if (Number.isFinite(impulse) && pullback >= impulse * MIN_PULLBACK && pullback <= impulse) {
      return [
        originalIndex(from, start),
        originalIndex(to, start),
        originalIndex(correction, start)
      ];
    }
  }
  return null;
}
