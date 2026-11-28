import type { PixelPoint } from "./types.js";
import type { AnnotationBounds } from "./drawing-annotation-layout.js";

/** One polygon avoids double opacity where a callout tail meets its box. */
export function annotationOutline(body: AnnotationBounds, anchor: PixelPoint): PixelPoint[] {
  const { left, right, top, bottom } = body;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];
  if (anchor.x >= left && anchor.x <= right && anchor.y >= top && anchor.y <= bottom)
    return corners;
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const dx = anchor.x - center.x,
    dy = anchor.y - center.y;
  const side =
    Math.abs(dx) / Math.max(1, right - left) > Math.abs(dy) / Math.max(1, bottom - top)
      ? dx > 0
        ? 1
        : 3
      : dy > 0
        ? 2
        : 0;
  const horizontal = side === 0 || side === 2;
  const limit = horizontal ? [left, right] : [top, bottom];
  const half = Math.min(6, (limit[1]! - limit[0]!) / 4);
  const at = Math.max(
    limit[0]! + half,
    Math.min(limit[1]! - half, horizontal ? anchor.x : anchor.y)
  );
  const forward = side === 0 || side === 1;
  const first = at + (forward ? -half : half),
    last = at + (forward ? half : -half);
  const fixed = side === 0 ? top : side === 1 ? right : side === 2 ? bottom : left;
  const point = (value: number) => (horizontal ? { x: value, y: fixed } : { x: fixed, y: value });
  corners.splice(side + 1, 0, point(first), anchor, point(last));
  return corners;
}

export function annotationPolygonContains(
  points: readonly PixelPoint[],
  point: PixelPoint
): boolean {
  let inside = false;
  for (let i = 0, previous = points.length - 1; i < points.length; previous = i++) {
    const a = points[i]!,
      b = points[previous]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
