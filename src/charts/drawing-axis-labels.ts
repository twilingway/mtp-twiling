import type { DrawingPoint, PixelPoint } from "../model/types.js";
import { drawingPriceLabelPosition } from "../model/drawing-price-labels.js";
import { PRICE_LABEL_FONT } from "./last-price-label.js";

export interface DrawingAxisLabels {
  prices: readonly {
    point: DrawingPoint;
    anchor: "always" | "visible" | "ray";
    text: string;
    color: string;
    fill: string;
    textColor: string;
  }[];
  times: readonly { timestamp: number; text: string }[];
  timeStyle: { fill: string; textColor: string };
}

export interface DrawingAxisFrame {
  labels: DrawingAxisLabels | null;
  project: (point: DrawingPoint) => PixelPoint | null;
  projectTime: (timestamp: number) => number | null;
  plotWidth: number;
  plotHeight: number;
  occupied: readonly number[];
  fontSize: number;
}

export function drawingPriceLabels(frame: DrawingAxisFrame) {
  const occupied = [...frame.occupied];
  const seen = new Set<string>();
  return (frame.labels?.prices ?? []).flatMap((label) => {
    const pixel = frame.project(label.point);
    if (
      !pixel ||
      !Number.isFinite(pixel.y) ||
      !Number.isFinite(pixel.x) ||
      (label.anchor !== "always" && pixel.x > frame.plotWidth) ||
      (label.anchor === "visible" && pixel.x < 0) ||
      seen.has(label.text)
    )
      return [];
    const y = drawingPriceLabelPosition(pixel.y, frame.plotHeight, occupied, frame.fontSize + 5);
    if (y === null) return [];
    seen.add(label.text);
    occupied.push(y);
    return [{ ...label, y, trueY: pixel.y }];
  });
}

export function paintDrawingPriceLabels(
  ctx: CanvasRenderingContext2D,
  frame: DrawingAxisFrame,
  width: number
): void {
  ctx.save();
  ctx.font = `${frame.fontSize}px ${PRICE_LABEL_FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const height = frame.fontSize + 5;
  for (const label of drawingPriceLabels(frame)) {
    ctx.fillStyle = label.fill;
    ctx.fillRect(0, Math.round(label.y - height / 2), width, height);
    ctx.fillStyle = label.textColor;
    ctx.fillText(label.text, width - 3, Math.round(label.y), Math.max(1, width - 6));
  }
  ctx.restore();
}

export function paintDrawingPriceTicks(
  ctx: CanvasRenderingContext2D,
  frame: DrawingAxisFrame
): void {
  ctx.save();
  for (const label of drawingPriceLabels(frame)) {
    ctx.fillStyle = label.color;
    ctx.fillRect(frame.plotWidth - 5, Math.round(label.trueY), 5, 1);
  }
  ctx.restore();
}

export function paintDrawingTimeLabels(
  ctx: CanvasRenderingContext2D,
  frame: DrawingAxisFrame,
  width: number,
  height: number
): void {
  if (!frame.labels) return;
  ctx.save();
  ctx.font = `${frame.fontSize}px ${PRICE_LABEL_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of frame.labels.times) {
    const x = frame.projectTime(label.timestamp);
    if (x === null || !Number.isFinite(x) || x < 0 || x > width) continue;
    const labelWidth = Math.min(width, ctx.measureText(label.text).width + 14);
    const left = Math.max(0, Math.min(width - labelWidth, x - labelWidth / 2));
    ctx.fillStyle = frame.labels.timeStyle.fill;
    ctx.fillRect(Math.round(left), 0, labelWidth, height);
    ctx.fillStyle = frame.labels.timeStyle.textColor;
    ctx.fillText(label.text, left + labelWidth / 2, height / 2, Math.max(1, labelWidth - 8));
  }
  ctx.restore();
}
