import type { Candle, DrawingPoint, Timeframe } from "../model/types.js";
import { linkedTimeIndices } from "./layout-link.js";

export interface SelectionZoomSource {
  data: readonly Candle[];
  timeframe: Timeframe;
  minMove: number | null;
}

export interface SelectionZoomBounds {
  time: { from: number; to: number };
  price: { from: number; to: number };
}

export function selectionZoomBounds(
  source: SelectionZoomSource,
  first: DrawingPoint,
  second: DrawingPoint
): SelectionZoomBounds | null {
  const low = Math.min(first.value, second.value);
  const high = Math.max(first.value, second.value);
  const difference = high - low;
  if (!Number.isFinite(difference) || difference <= 0) return null;
  const time = linkedTimeIndices(
    source.data,
    {
      kind: "dateRange",
      from: Math.min(first.timestamp, second.timestamp),
      to: Math.max(first.timestamp, second.timestamp)
    },
    source.timeframe
  );
  if (time?.from === undefined) return null;
  // A rectangle can occupy several screen pixels within one native time cell or price tick.
  const padding = Math.max(0, ((source.minMove ?? 0) - difference) / 2);
  const from = low - padding;
  const to = high + padding;
  return Number.isFinite(to - from)
    ? { time: { from: time.from, to: time.to }, price: { from, to } }
    : null;
}

export function selectionTimeWindow(
  time: SelectionZoomBounds["time"],
  width: number,
  minSpacing: number,
  maxSpacing: number
) {
  if (
    ![width, minSpacing, maxSpacing].every(Number.isFinite) ||
    width <= 0 ||
    minSpacing <= 0 ||
    maxSpacing < minSpacing
  )
    return null;
  const center = time.from + (time.to - time.from) / 2;
  const bars = time.to - time.from + 1;
  const spacing = Math.max(minSpacing, Math.min(maxSpacing, width / bars));
  // Preserve the center of the user's selection when the engine reaches a zoom limit.
  const half = Math.max(0, (width / spacing - 1) / 2);
  return { from: center - half, to: center + half, center, spacing };
}
