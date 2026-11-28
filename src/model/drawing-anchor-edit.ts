import type { DrawingPoint, DrawingTool, PixelPoint } from "./types.js";
import { drawingArcControlPoint, drawingArcHeight } from "./drawing-shape-geometry.js";

interface AnchorProjection {
  pointToPixel(point: DrawingPoint): PixelPoint | null;
  pixelToPoint(x: number, y: number): DrawingPoint | null;
}

/** Body and clone gestures translate stored anchors; only the Arc control uses its visible normal. */
export function drawingDragPixels(
  name: DrawingTool,
  pixels: readonly (PixelPoint | null)[],
  handle: number,
  clone: boolean
): readonly (PixelPoint | null)[] {
  const [a, b, c] = pixels;
  return name === "arc" && handle === 2 && !clone && a && b && c
    ? pixels.map((point, index) => (index === 2 ? drawingArcControlPoint(a, b, c) : point))
    : pixels;
}

/** Apply geometric handle constraints only to an explicit edit, never to stored data on read. */
export function editDrawingAnchors(
  name: DrawingTool,
  original: readonly DrawingPoint[],
  edited: DrawingPoint[],
  handle: number,
  projection?: AnchorProjection | null
): DrawingPoint[] {
  const result = preservePolylineClosure(name, original, edited, handle);
  if (name !== "arc" || handle < 0 || !projection) return result;
  const [a, b, c] = result.map((point) => projection.pointToPixel(point));
  if (!a || !b || !c) return result.length < 3 ? result : [...original];
  const [oldA, oldB, oldC] = original.map((point) => projection.pointToPixel(point));
  if (handle < 2 && (!oldA || !oldB || !oldC)) return [...original];
  const height =
    handle < 2 && oldA && oldB && oldC
      ? drawingArcHeight(oldA, oldB, oldC)
      : drawingArcHeight(a, b, c);
  const control = drawingArcControlPoint(a, b, c, height);
  const point = projection.pixelToPoint(control.x, control.y);
  return point && Number.isFinite(point.timestamp) && Number.isFinite(point.value)
    ? result.map((value, index) => (index === 2 ? point : value))
    : [...original];
}

/** A repeated first vertex encodes closure without adding a persistence field. */
export function preservePolylineClosure(
  name: DrawingTool,
  original: readonly DrawingPoint[],
  edited: DrawingPoint[],
  handle: number
): DrawingPoint[] {
  const first = original[0],
    last = original.at(-1);
  if (
    name !== "polyline" ||
    original.length < 4 ||
    first?.timestamp !== last?.timestamp ||
    first?.value !== last?.value
  )
    return edited;
  const opposite = handle === 0 ? edited.length - 1 : handle === edited.length - 1 ? 0 : -1;
  return opposite < 0
    ? edited
    : edited.map((point, index) => (index === opposite ? { ...edited[handle]! } : point));
}
