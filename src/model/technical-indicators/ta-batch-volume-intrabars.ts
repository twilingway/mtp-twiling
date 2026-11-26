import { candleCalendarPeriod } from "../candle-clock.js";
import { shiftTimeframe } from "../intervals/calendar.js";
import type { NativeIntervalId, IntervalId } from "../intervals/registry.js";
import type { HistoryRange } from "../types.js";
import type {
  CumulativeVolumePeriod,
  IntrabarVolumePeriod,
  IntrabarVolumeSeed
} from "./ta-batch-volume-flow-delta.js";
import type { TurnoverInterval } from "./ta-batch-volume-flow-turnover.js";
import { lowerTurnoverDuration } from "./ta-batch-volume-flow-turnover.js";
import type { TechnicalBar } from "./types.js";

export type IntrabarVolumeBar = Pick<TechnicalBar, "timestamp" | "open" | "close" | "volume">;

export interface IntrabarVolumeHistory {
  readonly instrumentKey: string;
  readonly currency: string;
  readonly interval: TurnoverInterval;
  readonly range: HistoryRange;
  readonly bars: readonly IntrabarVolumeBar[];
}

export type VolumeDeltaAnchor = "1d" | "1w" | "1M";

export type IntrabarVolumeHistoryRequirement = {
  readonly kind: "intrabar-volume";
  readonly lookbackBars: null;
  readonly anchor?: VolumeDeltaAnchor;
  readonly seedPolicy: "known-lower-coverage-and-direction";
  readonly convergence: "exact-on-complete-window";
};

export function intrabarVolumeInterval(timeframe: IntervalId): TurnoverInterval | undefined {
  switch (timeframe) {
    case "1d":
      return "5m";
    case "1w":
    case "1M":
      return "1h";
    case "3M":
    case "6M":
    case "12M":
    case "45m":
    case "3h":
      return undefined;
    default:
      return "1m";
  }
}

function causalBars(history: IntrabarVolumeHistory, step: number) {
  const samples = new Map<number, { bar: IntrabarVolumeBar; seed?: IntrabarVolumeSeed }>();
  let previousTimestamp = -Infinity;
  let previous: IntrabarVolumeSeed = { close: null, direction: null };
  for (const bar of history.bars) {
    const { timestamp, open, close } = bar;
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp % step !== 0 ||
      timestamp <= previousTimestamp ||
      timestamp < history.range.from ||
      timestamp > history.range.to
    )
      throw new RangeError("Invalid source order or coverage for lower volume");
    const seed = timestamp === previousTimestamp + step ? previous : undefined;
    samples.set(timestamp, { bar, ...(seed ? { seed } : {}) });
    previousTimestamp = timestamp;
    const prior = seed?.close;
    previous = {
      close,
      direction:
        open === null || close === null
          ? null
          : close !== open
            ? close > open
              ? 1
              : -1
            : prior === undefined || prior === null
              ? null
              : close !== prior
                ? close > prior
                  ? 1
                  : -1
                : (seed?.direction ?? null)
    };
  }
  return samples;
}

export function assembleIntrabarVolume(
  bars: readonly TechnicalBar[],
  timeframe: NativeIntervalId,
  history: IntrabarVolumeHistory
): readonly IntrabarVolumePeriod[] {
  const step = lowerTurnoverDuration(history.interval);
  const lower = causalBars(history, step);
  const dataEnd = history.range.to;
  return bars.map(({ timestamp }) => {
    const endTime = shiftTimeframe(timestamp, timeframe, 1);
    const last = Math.min(endTime - step, dataEnd);
    if (timestamp % step !== 0 || timestamp < history.range.from || last < timestamp)
      return { timestamp, endTime, intrabars: null };
    const intrabars: IntrabarVolumeBar[] = [];
    for (let time = timestamp; time <= last; time += step) {
      const item = lower.get(time);
      if (!item) return { timestamp, endTime, intrabars: null };
      intrabars.push(item.bar);
    }
    const seed = lower.get(timestamp)?.seed;
    return { timestamp, endTime, intrabars, ...(seed ? { seed } : {}) };
  });
}

export function cumulativeVolumePeriods(
  periods: readonly IntrabarVolumePeriod[],
  timeframe: NativeIntervalId,
  anchor: VolumeDeltaAnchor
): readonly CumulativeVolumePeriod[] {
  const chartIsAtLeastAnchor =
    timeframe === "1M" ||
    (timeframe === "1w" && anchor !== "1M") ||
    (timeframe === "1d" && anchor === "1d");
  return periods.map((period) => {
    if (chartIsAtLeastAnchor) return { ...period, anchorTimestamp: period.timestamp };
    const { start } = candleCalendarPeriod(period.timestamp, anchor);
    // A weekly chart's first candle opening in the month can be after UTC day one.
    const anchorTimestamp = timeframe === "1w" ? candleCalendarPeriod(start, "1w").end : start;
    const startsOnMonday = timeframe === "1w" && candleCalendarPeriod(start, "1w").start === start;
    return { ...period, anchorTimestamp: startsOnMonday ? start : anchorTimestamp };
  });
}
