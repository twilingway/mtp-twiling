import { intlLocale } from "../i18n/preferences.js";
import { paintAreaText, paintLineText } from "./drawing-line-text.js";
import { drawingGeometry } from "./drawing-model.js";
import type { DrawingProjector, FibGeometry } from "./drawing-model.js";
import type { DrawingDraft, LineStyle } from "./types.js";
import { drawingHandleIndices } from "./drawing-tool-policy.js";
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
    } else if (g.shape) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (d.name === "highlighter") {
        ctx.lineWidth = g.style.width * 6;
        ctx.globalAlpha = g.style.lineOpacity * 0.3;
      }
      for (const path of g.shape.paths) {
        ctx.beginPath();
        path.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (path.closed) ctx.closePath();
        if ((path.closed || path.fillClosed) && g.style.fill) {
          ctx.globalAlpha = g.style.opacity;
          ctx.fillStyle = g.style.color;
          ctx.fill();
          ctx.globalAlpha = g.style.lineOpacity;
        }
        ctx.stroke();
      }
      paintAreaText(ctx, g.shape.bounds, g.style, width, height);
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
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
      for (const index of drawingHandleIndices(d.name, g.points.length)) {
        const p = g.points[index]!;
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
