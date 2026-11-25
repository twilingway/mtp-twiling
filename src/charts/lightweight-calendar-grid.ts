import { calendarAxisTicks } from "../model/intervals/axis-ticks.js";
import type { Candle, Timeframe } from "../model/types.js";

/** LW's empty tick labels still produce grid lines. Draw calendar lines as an actual bottom layer. */
export function paintCalendarGrid(
  context: CanvasRenderingContext2D,
  data: readonly Candle[],
  timeframe: Timeframe,
  options: {
    from: number;
    to: number;
    width: number;
    height: number;
    coordinate: (index: number) => number;
    color: string;
    pixelRatio?: number;
  }
): number {
  const ticks = calendarAxisTicks(data, timeframe, options);
  if (!ticks?.length) return 0;
  const ratio = Math.max(1, options.pixelRatio ?? 1);
  context.save();
  context.strokeStyle = options.color;
  context.lineWidth = 1 / ratio;
  context.setLineDash([]);
  context.beginPath();
  for (const tick of ticks) {
    const x = (Math.round(tick.coord * ratio) + 0.5) / ratio;
    context.moveTo(x, 0);
    context.lineTo(x, options.height);
  }
  context.stroke();
  context.restore();
  return ticks.length;
}
