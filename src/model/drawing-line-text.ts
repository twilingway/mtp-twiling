import { visibleSegment } from "./drawing-screen-geometry.js";
import type { ResolvedDrawingStyle } from "./drawing-model.js";
import type { PixelPoint } from "./types.js";

function outlineColor(color: string): string {
  const number = Number.parseInt(color.slice(1), 16);
  const luminance = (number >> 16) * 0.299 + ((number >> 8) & 255) * 0.587 + (number & 255) * 0.114;
  return luminance >= 136 ? "#000000" : "#ffffff";
}

export function paintLineText(
  context: CanvasRenderingContext2D,
  line: [PixelPoint, PixelPoint],
  style: ResolvedDrawingStyle,
  width: number,
  height: number
) {
  const { text, textAlign, textVertical, fontSize, color } = style;
  if (!style.textEnabled || !text.trim() || width <= 8 || height < fontSize) return;
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
  const xOffset = textAlign === "left" ? 4 : textAlign === "right" ? -4 : 0;
  const maxWidth = width - 8;
  const textWidth = Math.min(maxWidth, context.measureText(text).width);
  const before = textAlign === "right" ? textWidth : textAlign === "center" ? textWidth / 2 : 0;
  const x = Math.max(4 + before, Math.min(width - 4 - (textWidth - before), anchor.x + xOffset));
  const yOffset = textVertical === "top" ? -4 : textVertical === "bottom" ? 4 : 0;
  const minimum = textVertical === "top" ? fontSize : textVertical === "center" ? fontSize / 2 : 0;
  const maximum = minimum + height - fontSize;
  const y = Math.max(minimum, Math.min(maximum, anchor.y + yOffset));
  context.save();
  context.globalAlpha = 1;
  context.textAlign = textAlign;
  context.textBaseline =
    textVertical === "top" ? "bottom" : textVertical === "bottom" ? "top" : "middle";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.setLineDash([]);
  context.strokeStyle = outlineColor(color);
  context.strokeText(text, x, y, maxWidth);
  context.fillStyle = color;
  context.fillText(text, x, y, maxWidth);
  context.restore();
}
