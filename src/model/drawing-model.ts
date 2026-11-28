export { paintDrawings } from "./drawing-paint.js";
import { rectangleBounds, rectangleEdges } from "./drawing-screen-geometry.js";
import type { DrawingRectangle } from "./drawing-screen-geometry.js";
import { drawingShapeGeometry, pointInShape } from "./drawing-shape-geometry.js";
import type { ShapeGeometry } from "./drawing-shape-geometry.js";
import { drawingHandleIndices, isGeometricTool } from "./drawing-tool-policy.js";
import type {
  DrawingDraft,
  DrawingPoint,
  DrawingSettings,
  DrawingTool,
  FibLevelStyle,
  PixelPoint
} from "./types.js";
export const TOOL_NAMES: Record<DrawingTool, string> = {
  segment: "Линия тренда",
  rayLine: "Луч",
  straightLine: "Удлинённая линия",
  horizontalStraightLine: "Горизонтальная линия",
  horizontalRayLine: "Горизонтальный луч",
  verticalStraightLine: "Вертикальная линия",
  rectangle: "Прямоугольник",
  brush: "Кисть",
  highlighter: "Маркер",
  arrowPointer: "Стрелка-указатель",
  arrow: "Стрелка",
  arrowUp: "Стрелка вверх",
  arrowDown: "Стрелка вниз",
  rotatedRectangle: "Вращающийся прямоугольник",
  path: "Траектория",
  circle: "Окружность",
  ellipse: "Эллипс",
  polyline: "Ломаная линия",
  triangle: "Треугольник",
  arc: "Дуга",
  quadraticCurve: "Кривая",
  cubicCurve: "Двойная кривая",
  fibonacciLine: "Коррекция Фибоначчи",
  fibonacciExtension: "Расширение Фибоначчи по тренду"
};
export const DEFAULT_LEVELS = [
  -1, -0.75, -0.5, -0.25, 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618
];
export const FIB_COLORS = [
  "#787b86",
  "#26a69a",
  "#4caf50",
  "#8bc34a",
  "#787b86",
  "#f23645",
  "#81c784",
  "#4caf50",
  "#00bcd4",
  "#42a5f5",
  "#787b86",
  "#26a69a",
  "#2962ff",
  "#9c27b0",
  "#e91e63"
];
export const DEFAULT_FIB_LEVELS: FibLevelStyle[] = [
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236, 1.272, 1.414, 2.272, 2.414, 2,
  3, 3.272, 3.414, 4, 4.272, 4.414, 4.618, 4.764
].map((value, i) => ({
  value,
  enabled: i < 11,
  color:
    [
      "#808080",
      "#f23645",
      "#ff9800",
      "#4caf50",
      "#089981",
      "#00bcd4",
      "#808080",
      "#2962ff",
      "#f23645",
      "#9c27b0",
      "#e91e63",
      "#ff9800",
      "#f23645",
      "#ff9800",
      "#4caf50",
      "#089981",
      "#00bcd4",
      "#808080",
      "#2962ff",
      "#f23645",
      "#9c27b0",
      "#e91e63",
      "#ff9800",
      "#089981"
    ][i] ?? "#787b86",
  text: ""
}));
export type ResolvedDrawingStyle = Required<
  Omit<DrawingSettings, "levelStyles" | "oneColor" | "extend" | "textColor">
> &
  Pick<DrawingSettings, "levelStyles" | "oneColor" | "extend" | "textColor">;
export function drawingHasLineText(name: DrawingTool): boolean {
  return name !== "rectangle" && !isGeometricTool(name) && !name.startsWith("fibonacci");
}

export function drawingStyle(d: {
  name?: DrawingTool;
  settings?: DrawingSettings;
}): ResolvedDrawingStyle {
  const lineText = d.name !== undefined && drawingHasLineText(d.name);
  return {
    color: "#f4df30",
    width: 2,
    lineStyle: "solid",
    lineOpacity: 1,
    trendLine: true,
    trendColor: "#808080",
    trendWidth: 2,
    trendStyle: "dashed",
    trendOpacity: 1,
    fill: true,
    opacity: d.name === "arrowPointer" || d.name === "arrowUp" || d.name === "arrowDown" ? 1 : 0.2,
    extendLeft: false,
    extendRight: false,
    reverse: false,
    labels: true,
    prices: true,
    levels: DEFAULT_LEVELS,
    labelSide: "left",
    labelVertical: "middle",
    labelFormat: "value",
    fontSize: 12,
    textEnabled: true,
    text: "",
    textAlign: lineText ? "left" : "center",
    textVertical: lineText ? "top" : "center",
    ...d.settings
  };
}
export function fibPrice(
  points: readonly DrawingPoint[],
  ratio: number,
  reverse = false,
  extension = false
): number {
  const [a, b, c] = points;
  if (!a || !b) return NaN;
  const r = reverse ? 1 - ratio : ratio;
  return extension && c ? c.value + (b.value - a.value) * r : b.value + (a.value - b.value) * r;
}
export function lineEnds(
  a: PixelPoint,
  b: PixelPoint | undefined,
  width: number,
  height: number,
  kind: DrawingTool
): [PixelPoint, PixelPoint] | null {
  if (kind === "horizontalStraightLine")
    return [
      { x: 0, y: a.y },
      { x: width, y: a.y }
    ];
  if (kind === "horizontalRayLine") return a.x <= width ? [a, { x: width, y: a.y }] : null;
  if (kind === "verticalStraightLine")
    return [
      { x: a.x, y: 0 },
      { x: a.x, y: height }
    ];
  if (!b || kind === "rectangle") return null;
  if (kind === "segment") return [a, b];
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (Math.abs(dx) < 0.01) {
    if (kind === "straightLine")
      return [
        { x: a.x, y: 0 },
        { x: a.x, y: height }
      ];
    if (dy >= 0 ? a.y > height : a.y < 0) return null;
    return [a, { x: a.x, y: dy >= 0 ? height : 0 }];
  }
  const at = (x: number) => ({ x, y: a.y + ((x - a.x) * dy) / dx });
  if (kind === "rayLine" && (dx >= 0 ? a.x > width : a.x < 0)) return null;
  return kind === "rayLine" ? [a, at(dx >= 0 ? width : 0)] : [at(0), at(width)];
}
export function segmentDistance(p: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export type DrawingProjector = (point: DrawingPoint) => PixelPoint | null | undefined;
interface BaseGeometry {
  points: PixelPoint[];
  style: ResolvedDrawingStyle;
  lines: [PixelPoint, PixelPoint][];
  rectangle?: DrawingRectangle;
  shape?: ShapeGeometry;
}
export interface FibGeometry extends BaseGeometry {
  levels: {
    ratio: number;
    value: number;
    y: number;
    color: string;
    text: string;
  }[];
  from: number;
  to: number;
}
interface LineGeometry extends BaseGeometry {
  levels?: never;
  from?: never;
  to?: never;
}
export function drawingGeometry(
  d: DrawingDraft,
  project: DrawingProjector,
  width: number,
  height: number
): FibGeometry | LineGeometry | null {
  if (d.visible === false) return null;
  const points: PixelPoint[] = [];
  for (const point of d.points) {
    const p = project(point);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    points.push(p);
  }
  const style = drawingStyle(d),
    a = points[0],
    b = points[1];
  if (!a) return null;
  if (isGeometricTool(d.name)) {
    const shape = drawingShapeGeometry(d.name, points, style.width);
    return { points, style, lines: shape?.lines ?? [], ...(shape && { shape }) };
  }
  if (d.name === "rectangle") {
    if (!b) return { points, style, lines: [] };
    const rectangle = rectangleBounds(a, b);
    return { points, style, rectangle, lines: rectangleEdges(rectangle) };
  }
  if (!d.name.startsWith("fibonacci")) {
    const line = lineEnds(a, b, width, height, d.name);
    return { points, style, lines: line ? [line] : [] };
  }
  if (!b) return { points, style, lines: [] };
  const from = style.extendLeft ? 0 : Math.min(a.x, b.x),
    to = style.extendRight ? width : Math.max(a.x, b.x);
  const records = style.levelStyles
    ? style.levelStyles.filter((l) => l.enabled)
    : style.levels.map((value) => ({
        value,
        color: FIB_COLORS[DEFAULT_LEVELS.indexOf(value)] || style.color
      }));
  const levels: FibGeometry["levels"] = [];
  const anchor = d.points[0];
  if (!anchor) return null;
  for (const record of records) {
    const ratio = record.value,
      value = fibPrice(d.points, ratio, style.reverse, d.name === "fibonacciExtension");
    const p = project({ timestamp: anchor.timestamp, value });
    if (!p) return null;
    levels.push({
      ratio,
      value,
      y: p.y,
      color: style.oneColor ? style.color : record.color,
      text: "text" in record && typeof record.text === "string" ? record.text : ""
    });
  }
  return {
    points,
    style,
    levels,
    from,
    to,
    lines: levels.map((l) => [
      { x: from, y: l.y },
      { x: to, y: l.y }
    ])
  };
}
export function drawingLayer(drawing: DrawingDraft): "back" | "front" {
  return drawing.layer ?? "front";
}

export function hitDrawing(
  items: readonly DrawingDraft[],
  point: PixelPoint,
  project: DrawingProjector,
  width: number,
  height: number,
  handleRadius = 10
): { id: string; handle: number } | null {
  for (const layer of ["front", "back"] as const) {
    for (let index = items.length - 1; index >= 0; index--) {
      const drawing = items[index]!;
      if (drawingLayer(drawing) !== layer) continue;
      const geometry = drawingGeometry(drawing, project, width, height);
      if (!geometry) continue;
      const handle = drawingHandleIndices(drawing.name, geometry.points.length).find(
        (index) =>
          Math.hypot(geometry.points[index]!.x - point.x, geometry.points[index]!.y - point.y) <
          handleRadius
      );
      if (handle !== undefined) return { id: drawing.id, handle };
      const tolerance = Math.max(
        7,
        geometry.style.width * (drawing.name === "highlighter" ? 3 : 0.5) + 3
      );
      if (geometry.lines.some(([a, b]) => segmentDistance(point, a, b) < tolerance))
        return { id: drawing.id, handle: -1 };
      if (
        geometry.shape &&
        geometry.style.fill &&
        geometry.style.opacity > 0 &&
        pointInShape(point, geometry.shape)
      )
        return { id: drawing.id, handle: -1 };
      const rectangle = geometry.rectangle;
      if (
        rectangle &&
        geometry.style.fill &&
        geometry.style.opacity > 0 &&
        point.x >= rectangle.left &&
        point.x <= rectangle.right &&
        point.y >= rectangle.top &&
        point.y <= rectangle.bottom
      )
        return { id: drawing.id, handle: -1 };
    }
  }
  return null;
}
