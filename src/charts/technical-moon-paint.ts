import { lineColor } from "../model/candle-palette.js";
import type { RenderedMoonDecoration } from "./technical-calendar-paint.js";

interface VisibleCandle {
  timestamp: number;
  open: number;
  close: number;
  x: number;
}

interface MoonViewport {
  readonly width: number;
  readonly height: number;
  readonly bodyWidth: number;
  readonly bodyVisible: boolean;
  readonly markerOutline: string;
  readonly firstIndex: number;
  readonly lastIndex: number;
  candle(index: number): VisibleCandle | null;
  x(timestamp: number): number | null;
  y(price: number): number | null;
}

function validCoordinate(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function paintTechnicalMoon(
  ctx: CanvasRenderingContext2D,
  decorations: readonly RenderedMoonDecoration[],
  view: MoonViewport
): void {
  if (!decorations.length || view.width <= 0 || view.height <= 0) return;
  const tints = decorations.filter(
    (item): item is Extract<RenderedMoonDecoration, { kind: "candle-tint" }> =>
      item.kind === "candle-tint"
  );
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.clip();
    ctx.globalAlpha = 1;
    if (view.bodyVisible && tints.length) {
      const firstTime = view.candle(view.firstIndex)?.timestamp;
      const lastTime = view.candle(view.lastIndex)?.timestamp;
      const visibleTints = tints.filter(
        (tint) =>
          (firstTime === undefined || tint.endTimestamp >= firstTime) &&
          (lastTime === undefined || tint.startTimestamp <= lastTime)
      );
      for (let index = view.firstIndex; index <= view.lastIndex; index++) {
        const bar = view.candle(index);
        if (!bar) continue;
        const tint = visibleTints.findLast(
          (item) => item.startTimestamp <= bar.timestamp && item.endTimestamp >= bar.timestamp
        );
        if (!tint) continue;
        const open = view.y(bar.open),
          close = view.y(bar.close);
        if (!validCoordinate(open) || !validCoordinate(close)) continue;
        const top = Math.min(open, close);
        const height = Math.abs(open - close);
        const inset = height >= 5 ? 0.75 : 0;
        ctx.fillStyle = lineColor(tint.color, tint.opacity);
        ctx.fillRect(
          bar.x - view.bodyWidth / 2,
          top + inset,
          view.bodyWidth,
          Math.max(1, height - 2 * inset)
        );
      }
    }
    const stacks = new Map<number, number>();
    ctx.setLineDash([]);
    for (const marker of decorations) {
      if (marker.kind !== "price-circle") continue;
      const x = view.x(marker.timestamp);
      const y = view.y(marker.price);
      const radius = 3 + marker.width;
      if (
        !validCoordinate(x) ||
        !validCoordinate(y) ||
        x < -radius ||
        x > view.width + radius ||
        y < 0 ||
        y > view.height
      )
        continue;
      const slot = stacks.get(marker.timestamp) ?? 0;
      stacks.set(marker.timestamp, slot + 1);
      const offset = slot * (2 * radius + 2);
      const centerX = x + offset > view.width - radius ? x - offset : x + offset;
      const centerY = Math.max(radius + 1, y - radius - 4);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = lineColor(marker.color, marker.opacity);
      ctx.strokeStyle = lineColor(view.markerOutline, marker.opacity);
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}
