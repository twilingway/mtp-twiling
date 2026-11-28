import { preservePolylineClosure } from "../../model/drawing-anchor-edit.js";
import { roundPriceToStep } from "../../charts/price-format.js";
import { isAnnotationTool } from "../../model/drawing-annotation.js";
import { drawingGeometry } from "../../model/drawing-model.js";
import { isDrawing } from "../../model/backup-format.js";
import type { DrawingAnnotationSettings } from "../../model/types.js";
import type { ChartAdapter } from "../../charts/adapter.js";
import type { Drawing, DrawingDraft, DrawingPoint, PixelPoint } from "../../model/types.js";

export function annotationScreenSettings(
  drawing: DrawingDraft,
  chart: ChartAdapter | null
): Partial<DrawingAnnotationSettings> {
  if (!chart || !drawing.points[0]) return { screenX: 0.5, screenY: 0.3 };
  const first = chart.pointToPixel(drawing.points[0]),
    size = chart.plotSize();
  if (!first) return { screenX: 0.5, screenY: 0.3 };
  const body = drawingGeometry(
    drawing,
    (point) => chart.pointToPixel(point),
    size.width,
    size.height,
    { selected: true }
  )?.annotation?.body;
  const width = drawing.name === "table" && body ? body.right - body.left : 0,
    height = drawing.name === "table" && body ? body.bottom - body.top : 0;
  const second = drawing.points[1] && chart.pointToPixel(drawing.points[1]);
  return {
    screenX: Math.max(0, Math.min(1, first.x / Math.max(1, size.width - width))),
    screenY: Math.max(0, Math.min(1, first.y / Math.max(1, size.height - height))),
    ...(second && { offsetX: second.x - first.x, offsetY: second.y - first.y })
  };
}

export interface DrawingDrag {
  id: string;
  pointerId: number;
  handle: number;
  start: PixelPoint;
  original: Drawing;
  pixels: (PixelPoint | null)[];
  token: number;
  clone: boolean;
  cloneId: string | null;
}

export function dragChartDrawing(
  active: DrawingDrag,
  pixel: PixelPoint,
  chart: ChartAdapter,
  drawingPoint: (pixel: PixelPoint, temporary: boolean) => DrawingPoint | null,
  step: number | null
): Drawing {
  const original = active.original,
    annotation = original.settings?.annotation;
  const delta = { x: pixel.x - active.start.x, y: pixel.y - active.start.y };
  const id = active.cloneId ?? active.id;
  const annotated = (patch: Partial<DrawingAnnotationSettings>): Drawing => ({
    ...original,
    id,
    settings: { ...original.settings, annotation: { ...annotation, ...patch } }
  });
  if (!active.clone && original.name === "signpost" && active.handle === 1)
    return annotated({
      offsetX: Math.max(-4000, Math.min(4000, (annotation?.offsetX ?? 0) + delta.x)),
      offsetY: Math.max(-4000, Math.min(4000, (annotation?.offsetY ?? -60) + delta.y))
    });
  if (!active.clone && original.name === "table" && active.handle > 0) {
    const size = chart.plotSize();
    const layout = drawingGeometry(
      original,
      (point) => chart.pointToPixel(point),
      size.width,
      size.height,
      { selected: true }
    )?.annotation;
    if (layout?.body) {
      const cells = annotation?.table?.cells ?? [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""]
      ];
      const columns = layout.cells
        .filter((cell) => cell.row === 0)
        .map((cell) => cell.bounds.right - cell.bounds.left);
      const rows = layout.cells
        .filter((cell) => cell.column === 0)
        .map((cell) => cell.bounds.bottom - cell.bounds.top);
      const width = layout.body.right - layout.body.left,
        height = layout.body.bottom - layout.body.top;
      if (active.handle === 1)
        return annotated({
          width: Math.max(columns.length * 24, Math.min(1600, width + delta.x)),
          height: Math.max(rows.length * 16, Math.min(1200, height + delta.y))
        });
      const row = active.handle >= 200,
        index = active.handle - (row ? 200 : 100),
        sizes = row ? rows : columns;
      const first = sizes[index],
        next = sizes[index + 1],
        minimum = row ? 16 : 24;
      if (first !== undefined && next !== undefined) {
        const shift = Math.max(minimum - first, Math.min(next - minimum, row ? delta.y : delta.x));
        sizes[index] = first + shift;
        sizes[index + 1] = next - shift;
        return annotated({
          width,
          height,
          table: { cells, columnWidths: columns, rowHeights: rows }
        });
      }
    }
    return { ...original, id };
  }
  if (isAnnotationTool(original.name) && annotation?.screenAnchored) {
    const size = chart.plotSize();
    const body =
      original.name === "table"
        ? drawingGeometry(original, (point) => chart.pointToPixel(point), size.width, size.height, {
            selected: true
          })?.annotation?.body
        : null;
    const freeWidth = Math.max(1, size.width - (body ? body.right - body.left : 0)),
      freeHeight = Math.max(1, size.height - (body ? body.bottom - body.top : 0));
    return {
      ...original,
      id,
      settings: {
        ...original.settings,
        annotation: {
          ...annotation,
          screenX: Math.max(0, Math.min(1, (annotation.screenX ?? 0.5) + delta.x / freeWidth)),
          screenY: Math.max(0, Math.min(1, (annotation.screenY ?? 0.3) + delta.y / freeHeight))
        }
      }
    };
  }
  const points = original.points.map((point, i) => {
    if (!active.clone && active.handle >= 0 && active.handle !== i) return point;
    const start = active.pixels[i];
    const moved = start
      ? ((!active.clone && active.handle >= 0
          ? drawingPoint({ x: start.x + delta.x, y: start.y + delta.y }, false)
          : chart.pixelToPoint(start.x + delta.x, start.y + delta.y)) ?? point)
      : point;
    return moved === point ? point : { ...moved, value: roundPriceToStep(moved.value, step) };
  });
  const candidate: unknown = {
    ...original,
    id,
    points: preservePolylineClosure(original.name, original.points, points, active.handle)
  };
  return isDrawing(candidate) ? candidate : original;
}
