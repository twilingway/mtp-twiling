import { annotationFontCss } from "./drawing-annotation-layout.js";
import { annotationDefaults } from "./drawing-annotation.js";
import type {
  AnnotationBounds,
  AnnotationCell,
  AnnotationLayout,
  AnnotationTextLine
} from "./drawing-annotation-layout.js";
import type { DrawingDraft, LineStyle, PixelPoint } from "./types.js";

const dash = (style: LineStyle | undefined) =>
  style === "dashed" ? [6, 4] : style === "dotted" ? [2, 3] : [];

function outlinePath(
  ctx: CanvasRenderingContext2D,
  points: readonly PixelPoint[],
  body: AnnotationBounds | null
) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const before = Math.hypot(point.x - previous.x, point.y - previous.y);
    const after = Math.hypot(point.x - next.x, point.y - next.y);
    const corner =
      body &&
      (point.x === body.left || point.x === body.right) &&
      (point.y === body.top || point.y === body.bottom);
    const radius = corner ? Math.min(4, before / 2, after / 2) : 0;
    const entry = radius
      ? {
          x: point.x + ((previous.x - point.x) * radius) / before,
          y: point.y + ((previous.y - point.y) * radius) / before
        }
      : point;
    if (index) ctx.lineTo(entry.x, entry.y);
    else ctx.moveTo(entry.x, entry.y);
    if (radius)
      ctx.quadraticCurveTo(
        point.x,
        point.y,
        point.x + ((next.x - point.x) * radius) / after,
        point.y + ((next.y - point.y) * radius) / after
      );
  });
  ctx.closePath();
}

function markerPath(ctx: CanvasRenderingContext2D, layout: AnnotationLayout) {
  const b = layout.marker;
  if (!b) return;
  const x = (b.left + b.right) / 2;
  const width = b.right - b.left;
  const height = b.bottom - b.top;
  ctx.beginPath();
  if (layout.kind === "flag") {
    ctx.moveTo(b.left, b.bottom);
    ctx.lineTo(b.left, b.top);
    ctx.lineTo(b.right, b.top + height * 0.12);
    ctx.lineTo(b.right - width * 0.2, b.top + height * 0.35);
    ctx.lineTo(b.right, b.top + height * 0.57);
    ctx.lineTo(b.left, b.top + height * 0.48);
  } else if (layout.kind === "pin") {
    ctx.moveTo(x, b.bottom);
    ctx.lineTo(b.left + width * 0.1, b.top + height * 0.52);
    ctx.arc(x, b.top + width / 2, width / 2, Math.PI, 0);
    ctx.lineTo(x, b.bottom);
    ctx.closePath();
  } else if (layout.kind === "comment") {
    ctx.moveTo(b.left, b.top);
    ctx.lineTo(b.right, b.top);
    ctx.lineTo(b.right, b.bottom - height * 0.25);
    ctx.lineTo(x, b.bottom - height * 0.25);
    ctx.lineTo(b.left + width * 0.2, b.bottom);
    ctx.lineTo(b.left + width * 0.2, b.bottom - height * 0.25);
    ctx.lineTo(b.left, b.bottom - height * 0.25);
    ctx.closePath();
  } else {
    ctx.moveTo(x, b.top);
    ctx.lineTo(b.right, (b.top + b.bottom) / 2);
    ctx.lineTo(x, b.bottom);
    ctx.lineTo(b.left, (b.top + b.bottom) / 2);
    ctx.closePath();
  }
}

function clipBounds(ctx: CanvasRenderingContext2D, b: AnnotationBounds) {
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.clip();
}

function bodyPath(ctx: CanvasRenderingContext2D, layout: AnnotationLayout) {
  if (layout.outline) outlinePath(ctx, layout.outline, layout.body);
  else if (layout.body) {
    const b = layout.body;
    ctx.beginPath();
    ctx.roundRect(b.left, b.top, b.right - b.left, b.bottom - b.top, 4);
  }
}

function paintText(ctx: CanvasRenderingContext2D, lines: readonly AnnotationTextLine[]) {
  for (const line of lines) {
    if (!line.text || line.maxWidth <= 0) continue;
    ctx.textAlign = line.align;
    ctx.fillText(line.text, line.x, line.y);
  }
}

function paintGrid(ctx: CanvasRenderingContext2D, cells: readonly AnnotationCell[]) {
  const edges = new Set<string>();
  ctx.beginPath();
  for (const { bounds: b } of cells)
    for (const [x1, y1, x2, y2] of [
      [b.left, b.top, b.right, b.top],
      [b.left, b.bottom, b.right, b.bottom],
      [b.left, b.top, b.left, b.bottom],
      [b.right, b.top, b.right, b.bottom]
    ] as const) {
      const key = `${x1},${y1},${x2},${y2}`;
      if (edges.has(key)) continue;
      edges.add(key);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
  ctx.stroke();
}

export function paintAnnotation(
  ctx: CanvasRenderingContext2D,
  layout: AnnotationLayout,
  drawing: DrawingDraft
) {
  const defaults = annotationDefaults(drawing.name);
  const settings = { ...defaults, ...drawing.settings };
  const style = { ...defaults.annotation, ...drawing.settings?.annotation };
  const color = settings?.textColor ?? settings?.color ?? "#f4df30";
  const borderColor = style?.borderColor ?? settings?.color ?? "#2962ff";
  const borderOpacity = style?.borderOpacity ?? settings?.lineOpacity ?? 1;
  const backgroundColor = style?.backgroundColor ?? "#1e2738";
  ctx.save();
  ctx.font = annotationFontCss(layout.font);
  ctx.textBaseline = "top";
  ctx.lineWidth = settings?.width ?? 2;
  ctx.setLineDash(dash(settings?.lineStyle));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = settings?.color ?? "#2962ff";
  ctx.globalAlpha = settings?.lineOpacity ?? 1;
  if (layout.leader && !layout.outline && ctx.lineWidth > 0) {
    ctx.beginPath();
    ctx.moveTo(layout.leader[0].x, layout.leader[0].y);
    ctx.lineTo(layout.leader[1].x, layout.leader[1].y);
    ctx.stroke();
  }
  ctx.lineWidth = style?.borderWidth ?? 1;
  ctx.setLineDash(dash(style?.borderStyle));
  ctx.strokeStyle = borderColor;
  if (layout.body && layout.kind !== "priceNote") {
    const b = layout.body;
    const shaped = layout.outline || layout.kind === "note" || layout.kind === "pin";
    if (layout.background || style?.backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.globalAlpha = style?.backgroundOpacity ?? 0.95;
      if (shaped) {
        bodyPath(ctx, layout);
        ctx.fill();
      } else ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    }
    if (layout.kind !== "table" && (layout.background || style?.borderColor) && ctx.lineWidth > 0) {
      ctx.globalAlpha = borderOpacity;
      if (shaped) {
        bodyPath(ctx, layout);
        ctx.stroke();
      } else ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    }
  }
  if (layout.price) {
    const b = layout.price.bounds;
    ctx.setLineDash(dash(style.borderStyle));
    ctx.globalAlpha = style.backgroundOpacity ?? 1;
    ctx.fillStyle = style.backgroundColor ?? "#2962ff";
    ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    if (ctx.lineWidth > 0) {
      ctx.globalAlpha = borderOpacity;
      ctx.strokeStyle = borderColor;
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    }
    ctx.globalAlpha = 1;
    ctx.font = annotationFontCss(layout.price.font);
    ctx.fillStyle = "#ffffff";
    paintText(ctx, layout.price.text);
    ctx.font = annotationFontCss(layout.font);
  }
  if (layout.marker) {
    ctx.setLineDash([]);
    if (layout.kind === "flag") ctx.lineWidth = 1;
    ctx.globalAlpha = layout.kind === "flag" || layout.kind === "pin" ? 1 : borderOpacity;
    ctx.fillStyle = layout.kind === "flag" || layout.kind === "pin" ? "#2962ff" : borderColor;
    ctx.strokeStyle = ctx.fillStyle;
    markerPath(ctx, layout);
    ctx.fill();
    if (ctx.lineWidth > 0) ctx.stroke();
    if (layout.kind === "pin") {
      const b = layout.marker;
      ctx.beginPath();
      ctx.arc((b.left + b.right) / 2, b.top + (b.right - b.left) / 2, 2.2, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  if (layout.cells.length && ctx.lineWidth > 0) {
    ctx.setLineDash(dash(style.borderStyle));
    ctx.strokeStyle = borderColor;
    ctx.globalAlpha = borderOpacity;
    paintGrid(ctx, layout.cells);
    ctx.setLineDash([]);
  }
  for (const cell of layout.cells) {
    const b = cell.bounds;
    ctx.save();
    clipBounds(ctx, b);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    paintText(ctx, cell.text);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.save();
  if (layout.body && layout.kind !== "priceNote") clipBounds(ctx, layout.body);
  paintText(ctx, layout.text);
  ctx.restore();
  ctx.restore();
}
