import { visibleSegment } from "./drawing-screen-geometry.js";
import type { DrawingRectangle } from "./drawing-screen-geometry.js";
import type { ResolvedDrawingStyle } from "./drawing-model.js";
import type { PixelPoint } from "./types.js";

const padding = 4;
type Baseline = "top" | "middle" | "bottom";

function outlineColor(color: string): string {
  const number = Number.parseInt(color.slice(1), 16);
  const luminance = (number >> 16) * 0.299 + ((number >> 8) & 255) * 0.587 + (number & 255) * 0.114;
  return luminance >= 136 ? "#000000" : "#ffffff";
}

function paintLabel(
  context: CanvasRenderingContext2D,
  anchor: PixelPoint,
  baseline: Baseline,
  style: ResolvedDrawingStyle,
  width: number,
  height: number
) {
  const { text, textAlign, fontSize } = style;
  if (!style.textEnabled || !text.trim() || width <= padding * 2 || height < fontSize) return;
  const color = style.textColor ?? style.color;
  const maxWidth = width - padding * 2;
  const textWidth = Math.min(maxWidth, context.measureText(text).width);
  const before = textAlign === "right" ? textWidth : textAlign === "center" ? textWidth / 2 : 0;
  const left = padding + before;
  const right = width - padding - (textWidth - before);
  const x = Math.max(left, Math.min(right, anchor.x));
  const minimum = baseline === "bottom" ? fontSize : baseline === "middle" ? fontSize / 2 : 0;
  const maximum = minimum + height - fontSize;
  const y = Math.max(minimum, Math.min(maximum, anchor.y));
  context.save();
  context.globalAlpha = 1;
  context.textAlign = textAlign;
  context.textBaseline = baseline;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.setLineDash([]);
  context.strokeStyle = outlineColor(color);
  context.strokeText(text, x, y, maxWidth);
  context.fillStyle = color;
  context.fillText(text, x, y, maxWidth);
  context.restore();
}

export function paintLineText(
  context: CanvasRenderingContext2D,
  line: [PixelPoint, PixelPoint],
  style: ResolvedDrawingStyle,
  width: number,
  height: number
) {
  const { text, textAlign, textVertical } = style;
  if (!style.textEnabled || !text.trim()) return;
  const segment = visibleSegment(line, width, height);
  if (!segment) return;
  const [a, b] = segment;
  const [left, right] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a];
  const anchor =
    textAlign === "left"
      ? left
      : textAlign === "right"
        ? right
        : { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const xOffset = textAlign === "left" ? padding : textAlign === "right" ? -padding : 0;
  const yOffset = textVertical === "top" ? -padding : textVertical === "bottom" ? padding : 0;
  const baseline = textVertical === "top" ? "bottom" : textVertical === "bottom" ? "top" : "middle";
  paintLabel(
    context,
    { x: anchor.x + xOffset, y: anchor.y + yOffset },
    baseline,
    style,
    width,
    height
  );
}

export function paintAreaText(
  context: CanvasRenderingContext2D,
  bounds: DrawingRectangle,
  style: ResolvedDrawingStyle,
  width: number,
  height: number
) {
  if (!style.textEnabled || !style.text.trim()) return;
  const left = Math.max(0, bounds.left);
  const right = Math.min(width, bounds.right);
  const top = Math.max(0, bounds.top);
  const bottom = Math.min(height, bounds.bottom);
  if (left > right || top > bottom) return;
  const { textAlign, textVertical } = style;
  const insetX = Math.min(padding, (right - left) / 2);
  const insetY = Math.min(padding, (bottom - top) / 2);
  const x =
    textAlign === "left"
      ? left + insetX
      : textAlign === "right"
        ? right - insetX
        : (left + right) / 2;
  const y =
    textVertical === "top"
      ? top + insetY
      : textVertical === "bottom"
        ? bottom - insetY
        : (top + bottom) / 2;
  paintLabel(
    context,
    { x, y },
    textVertical === "center" ? "middle" : textVertical,
    style,
    width,
    height
  );
}
