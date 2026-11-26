import { assertSeries, finiteOrNull } from "./primitives.js";
import type { NumericValue, TechnicalBar } from "./types.js";

type Direction = -1 | 1;
type LowerVolumeBar = Pick<TechnicalBar, "timestamp" | "open" | "close" | "volume">;

export interface IntrabarVolumePeriod {
  readonly timestamp: number;
  readonly endTime: number;
  /** Null means coverage is unknown. An empty array means complete coverage without trades. */
  readonly intrabars: readonly LowerVolumeBar[] | null;
}

export interface CumulativeVolumePeriod extends IntrabarVolumePeriod {
  /** Timestamp of the first chart bar in the anchor period, even if not loaded. */
  readonly anchorTimestamp: number;
}

export interface IntrabarVolumeSeed {
  readonly close: NumericValue;
  readonly direction: Direction | null;
}

export interface VolumeDeltaBar {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export interface UpDownVolumeBar {
  readonly up: number;
  /** Negative down volume, to plot below zero. */
  readonly down: number;
  readonly delta: number;
}

const EMPTY_SEED: IntrabarVolumeSeed = { close: null, direction: null };

function classifyVolume(
  periods: readonly IntrabarVolumePeriod[],
  seed: IntrabarVolumeSeed,
  keepPreviousDirection: boolean
) {
  assertSeries([seed.close]);
  if (seed.direction !== null && seed.direction !== 1 && seed.direction !== -1)
    throw new RangeError("Invalid intrabar direction");
  let previousClose = seed.close;
  let direction = seed.direction;
  let previousEnd = -Infinity;
  return periods.map((period) => {
    if (
      !Number.isSafeInteger(period.timestamp) ||
      !Number.isSafeInteger(period.endTime) ||
      period.endTime <= period.timestamp ||
      period.timestamp < previousEnd
    )
      throw new RangeError("Chart bar intervals must be ordered and distinct");
    previousEnd = period.endTime;
    if (period.intrabars === null) {
      previousClose = null;
      direction = null;
      return null;
    }

    let up = 0;
    let down = 0;
    let running = 0;
    let high = 0;
    let low = 0;
    let complete = true;
    let lastTime = -Infinity;
    for (const bar of period.intrabars) {
      if (
        !Number.isSafeInteger(bar.timestamp) ||
        bar.timestamp < period.timestamp ||
        bar.timestamp >= period.endTime ||
        bar.timestamp <= lastTime
      )
        throw new RangeError("Intrabar times must ascend within their chart bar");
      assertSeries([bar.open, bar.close]);
      lastTime = bar.timestamp;
      if (bar.open === null || bar.close === null) direction = null;
      else if (bar.close !== bar.open) direction = bar.close > bar.open ? 1 : -1;
      else if (previousClose === null) direction = null;
      else if (bar.close !== previousClose) direction = bar.close > previousClose ? 1 : -1;
      else if (!keepPreviousDirection) direction = 1;
      previousClose = bar.close;

      if (bar.volume === 0) continue;
      if (
        bar.volume === null ||
        !Number.isFinite(bar.volume) ||
        bar.volume < 0 ||
        direction === null
      ) {
        complete = false;
        continue;
      }
      if (direction === 1) up += bar.volume;
      else down += bar.volume;
      running += direction * bar.volume;
      high = Math.max(high, running);
      low = Math.min(low, running);
    }

    return complete && Number.isFinite(up) && Number.isFinite(down)
      ? { up, down: down === 0 ? 0 : -down, close: running, high, low }
      : null;
  });
}

export function volumeDelta(
  periods: readonly IntrabarVolumePeriod[],
  seed: IntrabarVolumeSeed = EMPTY_SEED
): (VolumeDeltaBar | null)[] {
  return classifyVolume(periods, seed, true).map((bar) =>
    bar === null ? null : { open: 0, high: bar.high, low: bar.low, close: bar.close }
  );
}

export function upDownVolume(
  periods: readonly IntrabarVolumePeriod[],
  previousClose: NumericValue = null
): (UpDownVolumeBar | null)[] {
  return classifyVolume(periods, { close: previousClose, direction: null }, false).map((bar) =>
    bar === null ? null : { up: bar.up, down: bar.down, delta: bar.up + bar.down }
  );
}

export function cumulativeVolumeDelta(
  periods: readonly CumulativeVolumePeriod[],
  seed: IntrabarVolumeSeed = EMPTY_SEED
): (VolumeDeltaBar | null)[] {
  let anchorTimestamp = -Infinity;
  let previousTime = -Infinity;
  let total: NumericValue = null;
  return volumeDelta(periods, seed).map((bar, index) => {
    const period = periods[index]!;
    if (!Number.isSafeInteger(period.anchorTimestamp) || period.anchorTimestamp > period.timestamp)
      throw new RangeError("Anchor must start at or before the chart bar");
    if (period.anchorTimestamp !== anchorTimestamp) {
      if (period.anchorTimestamp <= previousTime)
        throw new RangeError("Anchor periods must appear in chronological order");
      anchorTimestamp = period.anchorTimestamp;
      total = period.timestamp === anchorTimestamp ? 0 : null;
    }
    previousTime = period.timestamp;
    if (total === null || bar === null) {
      total = null;
      return null;
    }
    const open = total;
    const high = finiteOrNull(open + bar.high);
    const low = finiteOrNull(open + bar.low);
    total = high === null || low === null ? null : finiteOrNull(open + bar.close);
    return total === null || high === null || low === null
      ? null
      : { open, high, low, close: total };
  });
}
