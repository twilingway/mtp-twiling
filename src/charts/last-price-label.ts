import type { Candle } from "../model/types.js";

/** Tied to one candle so a delayed calendar response cannot label its successor. */
export interface CandleCountdownLabel {
  timestamp: number;
  text: string;
}

export function matchingCountdown(
  countdown: CandleCountdownLabel | null,
  bar: Candle | undefined
): string | null {
  return bar && countdown?.timestamp === bar.timestamp && countdown.text ? countdown.text : null;
}

export interface LastPriceLabelPaint {
  y: number;
  width: number;
  height: number;
  price: string;
  countdown: string;
  fill: string;
  text: string;
  fontSize: number;
}

export const PRICE_LABEL_FONT =
  '-apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif';

/** Both rows share one background and one native price-axis coordinate. */
export function paintLastPriceLabel(
  ctx: CanvasRenderingContext2D,
  label: LastPriceLabelPaint
): void {
  if (!Number.isFinite(label.y) || label.y < 0 || label.y > label.height || label.width <= 0)
    return;
  const rowHeight = label.fontSize + 6;
  const top = Math.round(label.y - rowHeight / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, label.width, label.height);
  ctx.clip();
  ctx.font = `${label.fontSize}px ${PRICE_LABEL_FONT}`;
  const width = Math.min(
    label.width,
    Math.max(38, ctx.measureText(label.price).width + 8, ctx.measureText(label.countdown).width + 8)
  );
  ctx.fillStyle = label.fill;
  ctx.fillRect(0, top, width, rowHeight * 2);
  ctx.fillStyle = label.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.price, width / 2, label.y, width - 8);
  ctx.fillText(label.countdown, width / 2, label.y + rowHeight, width - 8);
  ctx.restore();
}
