import type { PixelPoint } from "../model/types.js";

export function isPanMovement(start: PixelPoint, current: PixelPoint): boolean {
  return Math.abs(current.x - start.x) + Math.abs(current.y - start.y) > 3;
}

/** Recenter only when an anchor is outside, retaining the exact visible span. */
export function focusRange(
  anchors: readonly number[],
  range: { from: number; to: number }
): { from: number; to: number } | null {
  const finite = anchors.filter(Number.isFinite);
  if (!finite.length || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return null;
  const low = Math.min(...finite),
    high = Math.max(...finite);
  if (low >= range.from && high <= range.to) return null;
  const span = range.to - range.from,
    center = low + (high - low) / 2;
  return span > 0 ? { from: center - span / 2, to: center + span / 2 } : null;
}
