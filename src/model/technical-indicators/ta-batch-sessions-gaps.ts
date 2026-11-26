import { assertTechnicalBars } from "./data.js";
import { finiteOrNull } from "./primitives.js";
import type { TechnicalBar } from "./types.js";

const RANGE_LENGTH = 14;
export const DEFAULT_GAP_DEVIATION_PERCENT = 30;
export const DEFAULT_GAP_TRAIL_LENGTH = 300;

export interface GapOptions {
  readonly maxGaps: number;
  readonly deviationPercent?: number;
  readonly closePartially?: boolean;
  readonly maxTrailBars?: number | null;
}

export interface GapSegment {
  readonly startTimestamp: number;
  readonly endTimestamp: number | null;
  readonly lower: number;
  readonly upper: number;
}

export interface PriceGap {
  readonly direction: "up" | "down";
  readonly detectionTimestamp: number;
  readonly segments: readonly GapSegment[];
}

interface ActiveGap {
  direction: PriceGap["direction"];
  detectionTimestamp: number;
  segments: GapSegment[];
  startIndex: number;
  closed: boolean;
}

function updateGap(
  gap: ActiveGap,
  bar: TechnicalBar,
  expires: boolean,
  closePartially: boolean
): void {
  const segment = gap.segments.at(-1)!;
  const isUpGap = gap.direction === "up";
  const edge = isUpGap ? bar.low : bar.high;
  const entered = edge !== null && (isUpGap ? edge < segment.upper : edge > segment.lower);
  if (!expires && !entered) return;

  gap.segments[gap.segments.length - 1] = { ...segment, endTimestamp: bar.timestamp };
  const partial = entered && (isUpGap ? edge > segment.lower : edge < segment.upper);
  gap.closed = expires || !closePartially || !partial;
  if (!gap.closed && edge !== null) {
    gap.segments.push({
      startTimestamp: bar.timestamp,
      endTimestamp: null,
      lower: isUpGap ? segment.lower : edge,
      upper: isUpGap ? edge : segment.upper
    });
  }
}

export function priceGaps(bars: readonly TechnicalBar[], options: GapOptions): PriceGap[] {
  const {
    maxGaps,
    deviationPercent = DEFAULT_GAP_DEVIATION_PERCENT,
    closePartially = false,
    maxTrailBars = null
  } = options;
  if (!Number.isInteger(maxGaps) || maxGaps < 1 || maxGaps > 1000)
    throw new RangeError("Invalid maximum number of gaps");
  if (!Number.isFinite(deviationPercent) || deviationPercent < 0)
    throw new RangeError("Invalid gap deviation percentage");
  if (maxTrailBars !== null && (!Number.isSafeInteger(maxTrailBars) || maxTrailBars < 1))
    throw new RangeError("Invalid maximum gap trail");
  assertTechnicalBars(bars);

  const gaps: ActiveGap[] = [];
  const active = new Set<ActiveGap>();
  let validRanges = 0;
  bars.forEach((bar, index) => {
    for (const gap of active) {
      const expires = maxTrailBars !== null && index - gap.startIndex >= maxTrailBars;
      updateGap(gap, bar, expires, closePartially);
      if (gap.closed) active.delete(gap);
    }

    const { high, low } = bar;
    const range = high === null || low === null ? null : finiteOrNull(high - low);
    validRanges = range === null ? 0 : validRanges + 1;
    if (validRanges < RANGE_LENGTH || high === null || low === null) return;

    const previous = bars[index - 1]!;
    const up = low > previous.high!;
    const down = high < previous.low!;
    if (!up && !down) return;
    const lower = up ? previous.high! : high;
    const upper = up ? low : previous.low!;
    let mean = 0;
    for (let offset = 0; offset < RANGE_LENGTH; offset++) {
      const candle = bars[index - offset]!;
      mean += (candle.high! - candle.low! - mean) / (offset + 1);
    }
    const width = finiteOrNull(upper - lower);
    if (width === null || width < (deviationPercent / 100) * mean) return;

    const gap: ActiveGap = {
      direction: up ? "up" : "down",
      detectionTimestamp: bar.timestamp,
      startIndex: index - 1,
      closed: maxTrailBars === 1,
      segments: [
        {
          startTimestamp: previous.timestamp,
          endTimestamp: maxTrailBars === 1 ? bar.timestamp : null,
          lower,
          upper
        }
      ]
    };
    gaps.push(gap);
    if (!gap.closed) active.add(gap);
    if (gaps.length > maxGaps) active.delete(gaps.shift()!);
  });

  return gaps.map(({ direction, detectionTimestamp, segments }) => ({
    direction,
    detectionTimestamp,
    segments
  }));
}
