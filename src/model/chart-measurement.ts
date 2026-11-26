import type { Candle, DrawingPoint } from "./types.js";

/** Number of real bars at or before the time. A projected bar cannot increase the count. */
function barRank(candles: readonly Pick<Candle, "timestamp">[], timestamp: number): number {
  let first = 0;
  let end = candles.length;
  while (first < end) {
    const middle = Math.floor((first + end) / 2);
    if (candles[middle]!.timestamp <= timestamp) first = middle + 1;
    else end = middle;
  }
  return first;
}

export function measureChartRange(
  from: DrawingPoint,
  to: DrawingPoint,
  candles: readonly Pick<Candle, "timestamp">[]
) {
  const change = to.value - from.value;
  const ratio = change / Math.abs(from.value);
  return {
    change,
    percent: Number.isFinite(ratio * 100) ? ratio * 100 : null,
    bars: Math.abs(barRank(candles, to.timestamp) - barRank(candles, from.timestamp)),
    elapsed: Math.abs(to.timestamp - from.timestamp)
  };
}
