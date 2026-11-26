import type { ITimeScaleApi, Logical, Time } from "lightweight-charts";

export function lightweightDrawingX(
  scale: Pick<ITimeScaleApi<Time>, "logicalToCoordinate">,
  index: number
): number | null {
  if (!Number.isFinite(index)) return null;
  const left = Math.floor(index);
  const start = scale.logicalToCoordinate(left as Logical);
  if (start === null || left === index) return start;
  // Lightweight 5 returns 0 for fractional logical indices, including cross-interval anchors.
  const end = scale.logicalToCoordinate((left + 1) as Logical);
  return end === null ? null : start + (end - start) * (index - left);
}
