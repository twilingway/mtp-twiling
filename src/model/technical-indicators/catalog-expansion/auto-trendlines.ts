import { atr } from "../calculations.js";
import type { PitchforkLine } from "../ta-batch-fib-geometry.js";
import { williamsFractals } from "../ta-batch-fib-pivots.js";
import type { ConfirmedPivot } from "../ta-batch-fib-pivots.js";
import { trendlineBreakout, trendlinePivotRuns } from "../ta-batch-fib-trendlines.js";
import type { TrendlineBreakout } from "../ta-batch-fib-trendlines.js";
import type { TechnicalBar } from "../types.js";
import { closedPriceRun, offsetPivot } from "./auto-sloped-geometry.js";

export type TrendlineSize = "small" | "large";
export type TrendlineSide = "support" | "resistance";
export interface AutoTrendlineOptions {
  readonly size: TrendlineSize | "both";
  readonly barsToBreakout: number;
  readonly extendRight: boolean;
}

interface Candidate {
  readonly size: TrendlineSize;
  readonly side: TrendlineSide;
  readonly from: ConfirmedPivot;
  readonly to: ConfirmedPivot;
  readonly touches: number;
  readonly tolerance: number;
  readonly span: number;
  readonly slope: number;
}

export interface AutoTrendline {
  readonly size: TrendlineSize;
  readonly side: TrendlineSide;
  readonly line: PitchforkLine;
  readonly anchors: readonly [ConfirmedPivot, ConfirmedPivot];
  readonly touches: number;
  readonly startIndex: number;
  readonly endIndex: number | null;
  readonly breakout: TrendlineBreakout | null;
}

const MAX_TOUCH_WINDOW = 5000;
const MAX_ANCHORS_PER_SIDE = 48;
const MAX_PRIOR_ANCHORS = 12;
const MAX_LINES_PER_SIDE = 4;

function firstTouchAtOrAfter(points: readonly ConfirmedPivot[], index: number): number {
  let from = 0,
    to = points.length;
  while (from < to) {
    const middle = Math.floor((from + to) / 2);
    if (points[middle]!.index < index) from = middle + 1;
    else to = middle;
  }
  return from;
}

function baseCandidate(
  size: TrendlineSize,
  side: TrendlineSide,
  from: ConfirmedPivot,
  to: ConfirmedPivot,
  pivots: readonly ConfirmedPivot[],
  tolerance: number
): Candidate | null {
  const span = to.index - from.index;
  const slope = (to.value - from.value) / span;
  if (span <= 0 || !Number.isFinite(slope)) return null;
  let touches = 2;
  for (let i = firstTouchAtOrAfter(pivots, from.index + 1); i < pivots.length; i++) {
    const pivot = pivots[i]!;
    if (pivot.index >= to.index) break;
    const price = from.value + slope * (pivot.index - from.index);
    if (!Number.isFinite(price)) return null;
    const distance = side === "support" ? pivot.value - price : price - pivot.value;
    if (distance < -tolerance) return null;
    if (distance <= tolerance) touches++;
  }
  return { size, side, from, to, touches, tolerance, span, slope };
}

function rankedCandidates(
  bars: readonly TechnicalBar[],
  sizes: readonly TrendlineSize[]
): Candidate[] {
  const ranges = atr(bars, 14);
  const touchStart = Math.max(0, bars.length - MAX_TOUCH_WINDOW);
  const touches = williamsFractals(bars.slice(touchStart), 3).map((pivot) =>
    offsetPivot(pivot, touchStart)
  );
  const result: Candidate[] = [];
  for (const size of sizes) {
    const runs = trendlinePivotRuns(bars, size);
    for (const side of ["support", "resistance"] as const) {
      const kind = side === "support" ? "low" : "high";
      const sideTouches = touches.filter((pivot) => pivot.kind === kind);
      for (const run of runs) {
        const anchors = run.filter((pivot) => pivot.kind === kind).slice(-MAX_ANCHORS_PER_SIDE);
        for (let j = 1; j < anchors.length; j++) {
          const to = anchors[j]!;
          for (let i = Math.max(0, j - MAX_PRIOR_ANCHORS); i < j; i++) {
            const from = anchors[i]!;
            const tolerance = ranges[from.index]! / 4 + ranges[to.index]! / 4;
            const candidate = baseCandidate(size, side, from, to, sideTouches, tolerance);
            if (candidate) result.push(candidate);
          }
        }
      }
    }
  }
  return result.sort(
    (a, b) =>
      b.touches - a.touches ||
      b.span - a.span ||
      Math.abs(b.slope) - Math.abs(a.slope) ||
      b.to.index - a.to.index ||
      (a.size === b.size ? 0 : a.size === "large" ? -1 : 1)
  );
}

function duplicates(candidate: Candidate, selected: Candidate): boolean {
  if (candidate.side !== selected.side) return false;
  const from = Math.max(candidate.from.index, selected.from.index);
  const to = Math.min(candidate.to.index, selected.to.index);
  if (to - from <= Math.min(candidate.span, selected.span) * 0.3) return false;
  const center = from / 2 + to / 2;
  const priceAt = ({ from, slope }: Candidate) => from.value + slope * (center - from.index);
  return (
    Math.abs(priceAt(candidate) - priceAt(selected)) <=
    Math.max(candidate.tolerance, selected.tolerance)
  );
}

export function autoTrendlines(
  input: readonly TechnicalBar[],
  options: AutoTrendlineOptions,
  lastBarClosed = false
): AutoTrendline[] {
  const { size, barsToBreakout, extendRight } = options;
  if (!Number.isInteger(barsToBreakout) || barsToBreakout < 1 || barsToBreakout > 100)
    throw new RangeError("Trendline breakout length must be an integer in 1..100");
  const { bars, start } = closedPriceRun(input, lastBarClosed);
  const sizes = size === "both" ? (["large", "small"] as const) : [size];
  const chosen: Candidate[] = [];
  const result: AutoTrendline[] = [];
  const counts = { support: 0, resistance: 0 };
  for (const candidate of rankedCandidates(bars, sizes)) {
    const { from, to, side, size } = candidate;
    if (counts[side] >= MAX_LINES_PER_SIDE || chosen.some((other) => duplicates(candidate, other)))
      continue;
    counts[side]++;
    chosen.push(candidate);
    const event = extendRight
      ? trendlineBreakout(bars, from, to, side, barsToBreakout, to.confirmedAt)
      : null;
    const right = event?.confirmedAt ?? bars.length - 1;
    const extend = extendRight && right - to.index <= candidate.span * 2;
    const leftAnchor = offsetPivot(from, start),
      rightAnchor = offsetPivot(to, start);
    result.push({
      size,
      side,
      line: { from: leftAnchor, through: rightAnchor },
      anchors: [leftAnchor, rightAnchor],
      touches: candidate.touches,
      startIndex: leftAnchor.index,
      endIndex: extend ? (event ? right + start : null) : rightAnchor.index,
      breakout:
        extend && event
          ? {
              ...event,
              firstOutsideIndex: event.firstOutsideIndex + start,
              confirmedAt: event.confirmedAt + start
            }
          : null
    });
  }
  return result;
}
