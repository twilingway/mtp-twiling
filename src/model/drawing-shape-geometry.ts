import type { DrawingTool, PixelPoint } from "./types.js";
import type { DrawingRectangle } from "./drawing-screen-geometry.js";

export interface ShapePath {
  points: PixelPoint[];
  closed: boolean;
  fillClosed?: boolean;
}
export interface ShapeGeometry {
  paths: ShapePath[];
  bounds: DrawingRectangle;
  lines: [PixelPoint, PixelPoint][];
}
const tau = Math.PI * 2;
const mix = (a: PixelPoint, b: PixelPoint, t: number): PixelPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});
const length = (a: PixelPoint, b: PixelPoint) => Math.hypot(b.x - a.x, b.y - a.y);
const steps = (distance: number) => Math.max(24, Math.min(512, Math.ceil(distance / 3)));
function sample(count: number, at: (t: number) => PixelPoint): PixelPoint[] {
  return Array.from({ length: count + 1 }, (_, index) => at(index / count));
}
export function shapeBounds(points: readonly PixelPoint[]): DrawingRectangle {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  return { left, right, top, bottom };
}
function arrowHead(a: PixelPoint, b: PixelPoint, width: number): PixelPoint[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x),
    size = Math.max(10, width * 4);
  return [
    {
      x: b.x - Math.cos(angle - Math.PI / 6) * size,
      y: b.y - Math.sin(angle - Math.PI / 6) * size
    },
    b,
    { x: b.x - Math.cos(angle + Math.PI / 6) * size, y: b.y - Math.sin(angle + Math.PI / 6) * size }
  ];
}
function broadArrow(a: PixelPoint, b: PixelPoint, width: number): PixelPoint[] {
  const distance = length(a, b);
  if (distance < 0.001) return [a, b];
  const ux = (b.x - a.x) / distance,
    uy = (b.y - a.y) / distance;
  const half = Math.min(distance / 4, Math.max(8, width * 3));
  const head = Math.min(distance * 0.45, half * 2.5);
  const point = (along: number, across: number) => ({
    x: a.x + ux * along - uy * across,
    y: a.y + uy * along + ux * across
  });
  return [
    point(0, half / 2),
    point(distance - head, half / 2),
    point(distance - head, half),
    b,
    point(distance - head, -half),
    point(distance - head, -half / 2),
    point(0, -half / 2)
  ];
}
export function drawingArcHeight(a: PixelPoint, b: PixelPoint, c: PixelPoint): number {
  const bx = b.x - a.x,
    by = b.y - a.y,
    distance = Math.hypot(bx, by);
  return distance ? ((c.x - a.x) * -by + (c.y - a.y) * bx) / distance : 0;
}
export function drawingArcControlPoint(
  a: PixelPoint,
  b: PixelPoint,
  c: PixelPoint,
  height = drawingArcHeight(a, b, c)
): PixelPoint {
  const bx = b.x - a.x,
    by = b.y - a.y,
    distance = Math.hypot(bx, by);
  return {
    x: a.x + bx / 2 - (distance ? (by / distance) * height : 0),
    y: a.y + by / 2 + (distance ? (bx / distance) * height : 0)
  };
}
function ellipticalArc(a: PixelPoint, b: PixelPoint, c: PixelPoint): PixelPoint[] {
  const bx = b.x - a.x,
    by = b.y - a.y,
    distance = Math.hypot(bx, by),
    height = drawingArcHeight(a, b, c);
  if (!distance || Math.abs(height) < 1e-7 * Math.max(1, distance)) return [a, b];
  const center = { x: a.x + bx / 2, y: a.y + by / 2 },
    ux = bx / distance,
    uy = by / distance,
    edgeCosine = Math.sqrt(3) / 2;
  // A 60-degree ellipse segment stretches along the chord normal; its border stays open.
  const count = Math.ceil(steps(distance + Math.abs(height) * 2) / 4) * 4;
  const result = sample(count, (t) => {
    const angle = ((t - 0.5) * Math.PI) / 3,
      along = distance * Math.sin(angle),
      across = (height * (Math.cos(angle) - edgeCosine)) / (1 - edgeCosine);
    return { x: center.x + ux * along - uy * across, y: center.y + uy * along + ux * across };
  });
  result[0] = a;
  result[count / 2] = drawingArcControlPoint(a, b, c);
  result[result.length - 1] = b;
  return result;
}

/** One geometry drives both engines, painting and selection. All inputs are projected anchors. */
export function drawingShapeGeometry(
  tool: DrawingTool,
  anchors: PixelPoint[],
  width: number
): ShapeGeometry | null {
  const [a, b, c, d] = anchors;
  if (!a) return null;
  const paths: ShapePath[] = [];
  const add = (points: PixelPoint[], closed = false, fillClosed = false) =>
    paths.push({ points, closed, ...(fillClosed && { fillClosed }) });
  if (tool === "arrowUp" || tool === "arrowDown") {
    const sign = tool === "arrowUp" ? 1 : -1;
    add(
      [
        [0, 0],
        [14, 16],
        [6, 16],
        [6, 36],
        [-6, 36],
        [-6, 16],
        [-14, 16]
      ].map(([x = 0, y = 0]) => ({ x: a.x + x, y: a.y + y * sign })),
      true
    );
  } else if (!b) add([a]);
  else if (tool === "brush" || tool === "highlighter" || tool === "polyline" || tool === "path") {
    const closed =
      tool === "polyline" &&
      anchors.length > 3 &&
      a.x === anchors.at(-1)?.x &&
      a.y === anchors.at(-1)?.y;
    add(anchors, closed);
    if (tool === "path") {
      const last = anchors.at(-1)!,
        previous = anchors.at(-2)!;
      add(arrowHead(previous, last, width));
    }
  } else if (tool === "arrowPointer") add(broadArrow(a, b, width), true);
  else if (tool === "arrow") {
    add([a, b]);
    add(arrowHead(a, b, width));
  } else if (tool === "circle" || tool === "ellipse") {
    const center = tool === "circle" ? a : mix(a, b, 0.5);
    const rx = tool === "circle" ? length(a, b) : Math.abs(a.x - b.x) / 2;
    const ry = tool === "circle" ? rx : Math.abs(a.y - b.y) / 2;
    add(
      sample(Math.ceil(steps(tau * Math.max(rx, ry)) / 4) * 4, (t) => ({
        x: center.x + rx * Math.cos(t * tau),
        y: center.y + ry * Math.sin(t * tau)
      })),
      true
    );
  } else if (tool === "rotatedRectangle") {
    if (!c) add([a, b]);
    else {
      const distance = length(a, b),
        nx = distance ? -(b.y - a.y) / distance : 0,
        ny = distance ? (b.x - a.x) / distance : 1;
      const across = (c.x - a.x) * nx + (c.y - a.y) * ny;
      add(
        [
          a,
          b,
          { x: b.x + nx * across, y: b.y + ny * across },
          { x: a.x + nx * across, y: a.y + ny * across }
        ],
        true
      );
    }
  } else if (tool === "triangle") add(c ? [a, b, c] : [a, b], Boolean(c));
  else if (tool === "arc") {
    const points = c ? ellipticalArc(a, b, c) : [a, b];
    add(points, false, points.length > 2);
  } else if (tool === "quadraticCurve")
    add(
      c
        ? sample(steps(length(a, c) + length(c, b)), (t) => mix(mix(a, c, t), mix(c, b, t), t))
        : [a, b]
    );
  else if (tool === "cubicCurve") {
    add(
      c && d
        ? sample(steps(length(a, c) + length(c, d) + length(d, b)), (t) =>
            mix(mix(mix(a, c, t), mix(c, d, t), t), mix(mix(c, d, t), mix(d, b, t), t), t)
          )
        : [a, b]
    );
  } else return null;
  const lines: ShapeGeometry["lines"] = [];
  const all: PixelPoint[] = [];
  for (const path of paths) {
    all.push(...path.points);
    for (let i = 1; i < path.points.length; i++) lines.push([path.points[i - 1]!, path.points[i]!]);
    if (path.closed && path.points.length > 2) lines.push([path.points.at(-1)!, path.points[0]!]);
  }
  return { paths, lines, bounds: shapeBounds(all) };
}

export function pointInShape(point: PixelPoint, shape: ShapeGeometry): boolean {
  for (const path of shape.paths) {
    if (!path.closed && !path.fillClosed) continue;
    let inside = false;
    for (let i = 0, j = path.points.length - 1; i < path.points.length; j = i++) {
      const a = path.points[i]!,
        b = path.points[j]!;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
