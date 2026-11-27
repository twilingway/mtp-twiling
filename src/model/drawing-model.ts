import { intlLocale } from "../i18n/preferences.js";
import { paintAreaText, paintLineText } from "./drawing-line-text.js";
import { rectangleBounds, rectangleEdges } from "./drawing-screen-geometry.js";
import type { DrawingRectangle } from "./drawing-screen-geometry.js";
import type {
  DrawingDraft,
  DrawingPoint,
  DrawingSettings,
  DrawingTool,
  FibLevelStyle,
  LineStyle,
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
  return name !== "rectangle" && !name.startsWith("fibonacci");
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
    opacity: 0.2,
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
}
interface FibGeometry extends BaseGeometry {
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
function fibLabelPosition(
  g: FibGeometry,
  side: "left" | "center" | "right",
  width: number
): { x: number; align: "left" | "center" | "right" } {
  if (side === "center") return { x: (g.from + g.to) / 2, align: "center" };
  if (side === "right")
    return g.style.extendRight ? { x: width - 4, align: "right" } : { x: g.to + 4, align: "left" };
  return g.style.extendLeft ? { x: 4, align: "left" } : { x: g.from - 4, align: "right" };
}

export function paintDrawings(
  ctx: CanvasRenderingContext2D,
  items: readonly DrawingDraft[],
  project: DrawingProjector,
  width: number,
  height: number,
  selected: string | null,
  handleRadius = 5
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.setLineDash([]);
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Arial, sans-serif';
  const dash = (style: LineStyle) =>
    style === "dashed" ? [6, 4] : style === "dotted" ? [2, 3] : [];
  for (const d of items) {
    const g = drawingGeometry(d, project, width, height);
    if (!g) continue;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = g.style.lineOpacity;
    ctx.lineWidth = g.style.width;
    ctx.strokeStyle = g.style.color;
    ctx.setLineDash(dash(g.style.lineStyle));
    ctx.font = `${g.style.fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`;
    if (g.levels) {
      if (g.style.fill)
        for (let i = 1; i < g.levels.length; i++) {
          ctx.globalAlpha = g.style.opacity;
          const current = g.levels[i],
            previous = g.levels[i - 1];
          if (!current || !previous) continue;
          ctx.fillStyle = current.color;
          ctx.fillRect(g.from, previous.y, g.to - g.from, current.y - previous.y);
        }
      ctx.globalAlpha = g.style.lineOpacity;
      const joined = new Set<FibGeometry["levels"][number]>();
      for (const l of g.levels) {
        let text = `${g.style.labels ? (g.style.labelFormat === "percent" ? new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(l.ratio * 100) + "%" : new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 5 }).format(l.ratio)) : ""}${g.style.prices ? " (" + new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 5 }).format(l.value) + ")" : ""}`;
        const { x: labelX, align: labelAlign } = fibLabelPosition(g, g.style.labelSide, width);
        const custom = fibLabelPosition(g, g.style.textAlign, width);
        if (
          text &&
          g.style.textEnabled &&
          l.text &&
          g.style.labelSide === g.style.textAlign &&
          (g.style.labelVertical === "middle" ? "center" : g.style.labelVertical) ===
            g.style.textVertical
        ) {
          text += ` · ${l.text}`;
          joined.add(l);
        }
        const gaps: { from: number; to: number }[] = [];
        const gap = (value: string, x: number, align: "left" | "center" | "right") => {
          const measured = ctx.measureText(value).width;
          const from = x - (align === "right" ? measured : align === "center" ? measured / 2 : 0);
          gaps.push({ from: from - 4, to: from + measured + 4 });
        };
        if ((g.style.labels || g.style.prices) && g.style.labelVertical === "middle")
          gap(text, labelX, labelAlign);
        if (!joined.has(l) && g.style.textEnabled && l.text && g.style.textVertical === "center")
          gap(l.text, custom.x, custom.align);
        ctx.strokeStyle = l.color;
        ctx.beginPath();
        let lineStart = g.from;
        for (const hole of gaps.sort((a, b) => a.from - b.from)) {
          if (hole.to <= lineStart || hole.from >= g.to) continue;
          if (hole.from > lineStart) {
            ctx.moveTo(lineStart, l.y);
            ctx.lineTo(Math.min(g.to, hole.from), l.y);
          }
          lineStart = Math.min(g.to, Math.max(lineStart, hole.to));
        }
        if (lineStart < g.to) {
          ctx.moveTo(lineStart, l.y);
          ctx.lineTo(g.to, l.y);
        }
        ctx.stroke();
        if (g.style.labels || g.style.prices) {
          ctx.fillStyle = l.color;
          ctx.textAlign = labelAlign;
          ctx.textBaseline =
            g.style.labelVertical === "middle"
              ? "middle"
              : g.style.labelVertical === "bottom"
                ? "top"
                : "bottom";
          ctx.fillText(
            text,
            labelX,
            l.y +
              (g.style.labelVertical === "middle" ? 0 : g.style.labelVertical === "bottom" ? 5 : -5)
          );
        }
      }
      if (g.style.textEnabled)
        for (const level of g.levels) {
          if (!level.text || joined.has(level)) continue;
          ctx.fillStyle = level.color;
          const placement = fibLabelPosition(g, g.style.textAlign, width);
          ctx.textAlign = placement.align;
          ctx.textBaseline =
            g.style.textVertical === "center"
              ? "middle"
              : g.style.textVertical === "bottom"
                ? "top"
                : "bottom";
          ctx.fillText(
            level.text,
            placement.x,
            level.y +
              (g.style.textVertical === "center" ? 0 : g.style.textVertical === "bottom" ? 5 : -5)
          );
        }
      if (g.style.trendLine) {
        ctx.globalAlpha = g.style.trendOpacity;
        ctx.strokeStyle = g.style.trendColor;
        ctx.lineWidth = g.style.trendWidth;
        ctx.setLineDash(dash(g.style.trendStyle));
        ctx.beginPath();
        g.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (g.style.textEnabled && g.style.text.trim()) {
        const ys = [...g.points, ...g.levels].map(({ y }) => y);
        paintAreaText(
          ctx,
          { left: g.from, right: g.to, top: Math.min(...ys), bottom: Math.max(...ys) },
          g.style,
          width,
          height
        );
      }
    } else if (g.rectangle) {
      const { left, top, right, bottom } = g.rectangle;
      if (g.style.fill) {
        ctx.globalAlpha = g.style.opacity;
        ctx.fillStyle = g.style.color;
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.globalAlpha = g.style.lineOpacity;
      }
      ctx.strokeRect(left, top, right - left, bottom - top);
      paintAreaText(ctx, g.rectangle, g.style, width, height);
    } else {
      for (const [a, b] of g.lines) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const line = g.lines[0];
      if (line) paintLineText(ctx, line, g.style, width, height);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (d.id === selected)
      for (const p of g.points) {
        ctx.fillStyle = "#131722";
        ctx.strokeStyle = "#2962ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
  }
  ctx.restore();
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
      const handle = geometry.points.findIndex(
        (p) => Math.hypot(p.x - point.x, p.y - point.y) < handleRadius
      );
      if (handle >= 0) return { id: drawing.id, handle };
      if (geometry.lines.some(([a, b]) => segmentDistance(point, a, b) < 7))
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
