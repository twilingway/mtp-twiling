import { fibPrice } from "../drawing-model.js";
import { finiteOrNull } from "./primitives.js";
import type { ConfirmedPivot } from "./ta-batch-fib-pivots.js";

export type PivotAnchor = Pick<ConfirmedPivot, "index" | "timestamp" | "value">;
type Pair = readonly [PivotAnchor, PivotAnchor];
type Triple = readonly [PivotAnchor, PivotAnchor, PivotAnchor];

function checkAnchors(anchors: readonly PivotAnchor[]): void {
  let previousIndex = -1;
  let previousTime = -1;
  for (const { index, timestamp, value } of anchors) {
    if (
      !Number.isSafeInteger(index) ||
      index <= previousIndex ||
      !Number.isFinite(timestamp) ||
      timestamp < 0 ||
      timestamp <= previousTime ||
      !Number.isFinite(value)
    )
      throw new RangeError("Geometry needs finite anchors on increasing bars");
    previousIndex = index;
    previousTime = timestamp;
  }
}

const RETRACEMENT_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const EXTENSION_RATIOS = [0, 0.618, 1, 1.618, 2, 2.618] as const;

function fibonacciLevels(anchors: Pair | Triple, ratios: readonly number[], reverse: boolean) {
  checkAnchors(anchors);
  return ratios.map((ratio) => {
    if (!Number.isFinite(ratio)) throw new RangeError("Non-finite Fibonacci ratio");
    return { ratio, value: finiteOrNull(fibPrice(anchors, ratio, reverse, anchors.length === 3)) };
  });
}

/** Computes price levels for two externally selected pivot anchors. */
export function fibonacciRetracementLevels(
  anchors: Pair,
  ratios: readonly number[] = RETRACEMENT_RATIOS,
  reverse = false
) {
  return fibonacciLevels(anchors, ratios, reverse);
}

/** Anchors A and B define the impulse. Anchor C sets the retracement origin. */
export function fibonacciExtensionLevels(
  anchors: Triple,
  ratios: readonly number[] = EXTENSION_RATIOS,
  reverse = false
) {
  return fibonacciLevels(anchors, ratios, reverse);
}

export type PitchforkStyle = "original" | "schiff" | "modified-schiff" | "inside";

interface BarPoint {
  readonly index: number;
  readonly value: number;
}

export interface PitchforkLine {
  readonly from: BarPoint;
  readonly through: BarPoint;
}

const midpoint = (a: BarPoint, b: BarPoint): BarPoint => ({
  index: a.index / 2 + b.index / 2,
  value: a.value / 2 + b.value / 2
});

function medianLine(anchors: Triple, variant: PitchforkStyle): PitchforkLine {
  const [first, second, third] = anchors;
  const a = { index: first.index, value: first.value };
  const c = { index: third.index, value: third.value };
  const firstMid = midpoint(first, second);
  const secondMid = midpoint(second, third);
  switch (variant) {
    case "original":
      return { from: a, through: secondMid };
    case "schiff":
      return { from: { index: a.index, value: firstMid.value }, through: secondMid };
    case "modified-schiff":
      return { from: firstMid, through: secondMid };
    case "inside":
      return { from: firstMid, through: c };
  }
}

/** Uses bar positions because display spacing is uniform through exchange closed periods. */
export function pitchforkGeometry(
  anchors: Triple,
  variant: PitchforkStyle = "original",
  ratios: readonly number[] = [0.5, 1]
) {
  checkAnchors(anchors);
  const median = medianLine(anchors, variant);
  const slope =
    (median.through.value - median.from.value) / (median.through.index - median.from.index);
  const distance = (anchor: BarPoint) =>
    Math.abs(anchor.value - (median.from.value + slope * (anchor.index - median.from.index)));
  const halfWidth = Math.max(distance(anchors[1]), distance(anchors[2]));
  if (!Number.isFinite(halfWidth)) return null;
  const shiftedLine = (offset: number): PitchforkLine | null => {
    const from = finiteOrNull(median.from.value + offset);
    const through = finiteOrNull(median.through.value + offset);
    return from === null || through === null
      ? null
      : { from: { ...median.from, value: from }, through: { ...median.through, value: through } };
  };
  const levels = ratios.map((ratio) => {
    if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError("Invalid pitchfork ratio");
    return { ratio, upper: shiftedLine(ratio * halfWidth), lower: shiftedLine(-ratio * halfWidth) };
  });
  return { median, levels };
}
