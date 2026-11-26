import { pitchforkGeometry } from "../ta-batch-fib-geometry.js";
import type { PitchforkLine, PitchforkStyle } from "../ta-batch-fib-geometry.js";
import { swingPivotRuns } from "../ta-batch-fib-pivots.js";
import type { ConfirmedPivot } from "../ta-batch-fib-pivots.js";
import type { TechnicalBar } from "../types.js";

interface SlopedInterval {
  readonly styleId: string;
  /** Null means extend to the corresponding visible edge. */
  readonly startIndex: number | null;
  readonly endIndex: number | null;
}

export interface TechnicalSlopedLine extends SlopedInterval {
  readonly kind: "sloped-line";
  readonly line: PitchforkLine;
}

export interface TechnicalSlopedBand extends SlopedInterval {
  readonly kind: "sloped-band";
  readonly upper: PitchforkLine;
  readonly lower: PitchforkLine;
  readonly fillOpacity: number;
}

export type TechnicalSlopedDecoration = TechnicalSlopedLine | TechnicalSlopedBand;

export const slopedPriceAt = (line: PitchforkLine, index: number): number =>
  line.from.value +
  ((line.through.value - line.from.value) / (line.through.index - line.from.index)) *
    (index - line.from.index);

export function closedPriceRun(input: readonly TechnicalBar[], lastBarClosed: boolean) {
  const end = Math.max(0, input.length - (lastBarClosed ? 0 : 1));
  let start = end;
  while (start > 0) {
    const { high, low, close } = input[start - 1]!;
    if (high === null || low === null || close === null) break;
    start--;
  }
  return { start, bars: input.slice(start, end) };
}

export function offsetPivot(pivot: ConfirmedPivot, start: number): ConfirmedPivot {
  return {
    ...pivot,
    index: pivot.index + start,
    confirmedAt: pivot.confirmedAt + start
  };
}

interface AutoPitchforkOptions {
  readonly depth: number;
  readonly variant: PitchforkStyle;
  readonly innerRatio: number;
  readonly outerRatio: number;
  readonly extendLeft: boolean;
  readonly transparency: number;
}

export function autoPitchfork(
  input: readonly TechnicalBar[],
  options: AutoPitchforkOptions,
  lastBarClosed = false
): TechnicalSlopedDecoration[] {
  const { depth, variant, innerRatio, outerRatio, extendLeft, transparency } = options;
  if (!Number.isInteger(depth) || depth < 2 || depth > 10000)
    throw new RangeError("Auto Pitchfork depth must be an integer in 2..10000");
  if (!Number.isFinite(transparency) || transparency < 0 || transparency > 100)
    throw new RangeError("Invalid Auto Pitchfork transparency");
  const { bars, start } = closedPriceRun(input, lastBarClosed);
  const pivots = swingPivotRuns(bars, {
    radius: Math.floor(depth / 2),
    ties: "both",
    acceptsReversal: () => true
  }).at(-1);
  const a = pivots?.at(-3),
    b = pivots?.at(-2),
    c = pivots?.at(-1);
  if (!a || !b || !c) return [];
  const fork = pitchforkGeometry(
    [offsetPivot(a, start), offsetPivot(b, start), offsetPivot(c, start)],
    variant,
    [innerRatio, outerRatio]
  );
  if (!fork) return [];
  const span = {
    startIndex: extendLeft ? null : fork.median.from.index,
    endIndex: null
  };
  const result: TechnicalSlopedDecoration[] = [
    { kind: "sloped-line", styleId: "median", line: fork.median, ...span }
  ];
  for (const [index, pair] of fork.levels.entries()) {
    const styleId = index === 0 ? "inner" : "outer";
    if (pair.upper) result.push({ kind: "sloped-line", styleId, line: pair.upper, ...span });
    if (pair.lower) result.push({ kind: "sloped-line", styleId, line: pair.lower, ...span });
    if (index === 1 && pair.upper && pair.lower && transparency < 100)
      result.push({
        kind: "sloped-band",
        styleId: "background",
        upper: pair.upper,
        lower: pair.lower,
        fillOpacity: 1 - transparency / 100,
        ...span
      });
  }
  return result;
}
