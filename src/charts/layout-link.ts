import { shiftTimeframe } from "../model/intervals/calendar.js";
import { NATIVE_TIMEFRAME_CONFIG } from "../model/intervals/native-timeframes.js";
import { logicalForTime } from "../model/intervals/projected-time.js";
import type { Candle, Timeframe } from "../model/types.js";
import type { LinkedTimeWindow } from "./adapter.js";

export function linkedBarIndex(
  data: readonly Candle[],
  timestamp: number,
  timeframe: Timeframe
): number | null {
  if (!Number.isFinite(timestamp)) return null;
  const index = Math.floor(logicalForTime(data, timestamp, NATIVE_TIMEFRAME_CONFIG[timeframe].ms));
  const bar = data[index];
  return bar &&
    Number.isFinite(bar.close) &&
    timestamp >= bar.timestamp &&
    timestamp < shiftTimeframe(bar.timestamp, timeframe, 1)
    ? index
    : null;
}

export function linkedTimeIndices(
  data: readonly Candle[],
  window: LinkedTimeWindow,
  timeframe: Timeframe
): { from?: number; to: number } | null {
  const first = data[0]?.timestamp;
  const last = data.at(-1)?.timestamp;
  if (first == null || last == null || !Number.isFinite(window.to)) return null;
  const interval = NATIVE_TIMEFRAME_CONFIG[timeframe].ms;
  if (window.kind === "time") {
    if (window.to < first) return null;
    return { to: logicalForTime(data, Math.min(window.to, last), interval) };
  }
  if (
    !Number.isFinite(window.from) ||
    window.from > window.to ||
    window.to < first ||
    window.from > last
  )
    return null;
  return {
    from: logicalForTime(data, Math.max(window.from, first), interval),
    to: logicalForTime(data, Math.min(window.to, last), interval)
  };
}

export function inPlot(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}
