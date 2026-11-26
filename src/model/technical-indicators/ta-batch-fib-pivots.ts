import { assertTechnicalBars } from "./data.js";
import { assertLength, finiteOrNull } from "./primitives.js";
import type { TechnicalBar } from "./types.js";

export interface ConfirmedPivot {
  readonly kind: "high" | "low";
  readonly index: number;
  readonly confirmedAt: number;
  readonly timestamp: number;
  readonly value: number;
}

export interface ZigzagSegment {
  readonly from: ConfirmedPivot;
  readonly to: ConfirmedPivot;
  readonly priceChange: number | null;
  readonly percentChange: number | null;
  readonly volume: number | null;
}

interface PivotWindow {
  readonly start: number;
  readonly end: number;
  readonly radius: number;
}

function* completePriceRuns(bars: readonly TechnicalBar[], start: number, radius: number) {
  for (let index = start; index < bars.length; index++) {
    const { high, low } = bars[index]!;
    if (high !== null && low !== null) continue;
    if (index - start > radius * 2) yield { start, end: index, radius };
    start = index + 1;
  }
  if (bars.length - start > radius * 2) yield { start, end: bars.length, radius };
}

function centeredExtrema(
  bars: readonly TechnicalBar[],
  { start, end, radius }: PivotWindow,
  kind: ConfirmedPivot["kind"],
  allowRightTies: boolean
): ReadonlySet<number> {
  const candidates: number[] = [];
  const extrema = new Set<number>();
  let head = 0;
  for (let index = start; index < end; index++) {
    const value = bars[index]![kind]!;
    const left = index - radius * 2;
    while (head < candidates.length && candidates[head]! < left) head++;
    while (candidates.length > head) {
      const last = bars[candidates.at(-1)!]![kind]!;
      if ((kind === "high" && last >= value) || (kind === "low" && last <= value)) break;
      candidates.pop();
    }
    candidates.push(index);
    const center = index - radius;
    if (left >= start && candidates[head] === center) {
      const next = candidates[head + 1];
      if (allowRightTies || next === undefined || bars[next]![kind] !== bars[center]![kind])
        extrema.add(center);
    }
    if (head > 1024 && head * 2 > candidates.length) {
      candidates.splice(0, head);
      head = 0;
    }
  }
  return extrema;
}

function pivot(
  bars: readonly TechnicalBar[],
  kind: ConfirmedPivot["kind"],
  index: number,
  radius: number
): ConfirmedPivot {
  const bar = bars[index]!;
  return { kind, index, confirmedAt: index + radius, timestamp: bar.timestamp, value: bar[kind]! };
}

/** Marks strict five-bar fractals by default. Pass closed bars through the confirmation bar. */
export function williamsFractals(bars: readonly TechnicalBar[], radius = 2): ConfirmedPivot[] {
  assertLength(radius);
  assertTechnicalBars(bars);
  const points: ConfirmedPivot[] = [];
  for (const run of completePriceRuns(bars, 0, radius)) {
    const highs = centeredExtrema(bars, run, "high", false);
    const lows = centeredExtrema(bars, run, "low", false);
    for (let index = run.start + radius; index < run.end - radius; index++) {
      if (highs.has(index)) points.push(pivot(bars, "high", index, radius));
      if (lows.has(index)) points.push(pivot(bars, "low", index, radius));
    }
  }
  return points;
}

interface SwingOptions {
  readonly radius: number;
  readonly fromIndex?: number;
  readonly canUse?: (point: ConfirmedPivot) => boolean;
  readonly acceptsReversal: (previous: ConfirmedPivot, distance: number) => boolean;
}

/** Shared alternating-extrema calculation. Gaps split independent runs. */
export function swingPivotRuns(
  bars: readonly TechnicalBar[],
  { radius, fromIndex = 0, canUse = () => true, acceptsReversal }: SwingOptions
): ConfirmedPivot[][] {
  assertLength(radius);
  assertTechnicalBars(bars);
  const result: ConfirmedPivot[][] = [];
  for (const run of completePriceRuns(bars, fromIndex, radius)) {
    const highs = centeredExtrema(bars, run, "high", true);
    const lows = centeredExtrema(bars, run, "low", true);
    const points: ConfirmedPivot[] = [];
    for (let index = run.start + radius; index < run.end - radius; index++) {
      const previous = points.at(-1);
      for (const kind of previous?.kind === "low" ? LOW_FIRST : HIGH_FIRST) {
        if (!(kind === "high" ? highs : lows).has(index)) continue;
        const next = pivot(bars, kind, index, radius);
        if (!canUse(next)) continue;
        if (!previous) {
          points.push(next);
          break;
        }
        const distance =
          kind === "high" ? next.value - previous.value : previous.value - next.value;
        if (distance <= 0) continue;
        if (kind === previous.kind) {
          points[points.length - 1] = next;
          break;
        }
        if (acceptsReversal(previous, distance)) {
          points.push(next);
          break;
        }
      }
    }
    if (points.length) result.push(points);
  }
  return result;
}

const LOW_FIRST = ["low", "high"] as const;
const HIGH_FIRST = ["high", "low"] as const;

function segmentVolume(bars: readonly TechnicalBar[], start: number, end: number): number | null {
  let volume = 0;
  for (let index = start + 1; index <= end; index++) {
    const amount = bars[index]!.volume;
    if (amount === null) return null;
    volume += amount;
  }
  return finiteOrNull(volume);
}

/** Uses completed candles and emits only segments between confirmed pivots. */
export function confirmedZigzag(
  bars: readonly TechnicalBar[],
  pivotLegs = 10,
  deviationPercent = 5
): ZigzagSegment[] {
  if (!Number.isInteger(pivotLegs) || pivotLegs < 2 || pivotLegs > 10000)
    throw new RangeError("Pivot legs must be an integer in 2..10000");
  if (!Number.isFinite(deviationPercent) || deviationPercent < 0)
    throw new RangeError("Invalid Zigzag deviation percentage");
  const runs = swingPivotRuns(bars, {
    radius: Math.floor(pivotLegs / 2),
    acceptsReversal: (previous, distance) =>
      previous.value === 0
        ? deviationPercent === 0
        : distance / Math.abs(previous.value) >= deviationPercent / 100
  });
  return runs.flatMap((pivots) =>
    pivots.slice(1).map((to, i) => {
      const from = pivots[i]!;
      const priceChange = to.value - from.value;
      return {
        from,
        to,
        priceChange: finiteOrNull(priceChange),
        percentChange:
          from.value === 0 ? null : finiteOrNull((priceChange / Math.abs(from.value)) * 100),
        volume: segmentVolume(bars, from.index, to.index)
      };
    })
  );
}
