import type { PixelPoint } from "./types.js";

type Segment = [PixelPoint, PixelPoint];

export interface DrawingRectangle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function rectangleBounds(a: PixelPoint, b: PixelPoint): DrawingRectangle {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y)
  };
}

export function rectangleEdges({ left, right, top, bottom }: DrawingRectangle): Segment[] {
  const a = { x: left, y: top },
    b = { x: right, y: top },
    c = { x: right, y: bottom },
    d = { x: left, y: bottom };
  return [
    [a, b],
    [b, c],
    [c, d],
    [d, a]
  ];
}

function clipParameter(start: number, end: number, bound: number): [number, number] | null {
  if (start === end) return start >= 0 && start <= bound ? [0, 1] : null;
  const first = -start / (end - start),
    second = (bound - start) / (end - start);
  return [Math.min(first, second), Math.max(first, second)];
}

export function visibleSegment([a, b]: Segment, width: number, height: number): Segment | null {
  const x = clipParameter(a.x, b.x, width),
    y = clipParameter(a.y, b.y, height);
  if (!x || !y) return null;
  const from = Math.max(0, x[0], y[0]),
    to = Math.min(1, x[1], y[1]);
  if (from > to) return null;
  const project = (fraction: number) => ({
    x: a.x + fraction * (b.x - a.x),
    y: a.y + fraction * (b.y - a.y)
  });
  return [project(from), project(to)];
}
