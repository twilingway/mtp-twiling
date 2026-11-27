import { calendarAxisTicks } from "../model/intervals/axis-ticks.js";
import type { CalendarAxisTick } from "../model/intervals/axis-ticks.js";
import type { Candle, Timeframe } from "../model/types.js";
import type { CalendarAxisDisplay } from "../i18n/calendar-axis.js";

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
    display?: CalendarAxisDisplay;
    ticks?: readonly CalendarAxisTick[] | null;
  }
): number {
  const ticks =
    options.ticks !== undefined ? options.ticks : calendarAxisTicks(data, timeframe, options);
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

/** The same ticks own grid lines and labels, including local day boundaries at DST changes. */
export function paintCalendarAxis(
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
    fontSize: number;
    fontFamily: string;
    display: CalendarAxisDisplay;
    ticks?: readonly CalendarAxisTick[] | null;
  }
): void {
  const ticks =
    options.ticks !== undefined ? options.ticks : calendarAxisTicks(data, timeframe, options);
  if (!ticks?.length) return;
  context.save();
  context.fillStyle = options.color;
  context.font = `${options.fontSize}px ${options.fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const tick of ticks) {
    const halfWidth = context.measureText(tick.text).width / 2;
    const x = Math.max(halfWidth + 2, Math.min(options.width - halfWidth - 2, tick.coord));
    context.fillText(tick.text, x, options.height / 2);
  }
  context.restore();
}
