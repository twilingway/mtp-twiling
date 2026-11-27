import type { IChartApi, ISeriesPrimitive, Logical, Time } from "lightweight-charts";
import { calendarAxisDisplay } from "../i18n/calendar-axis.js";
import { hasCalendarAxis } from "../model/intervals/axis-ticks.js";
import { CalendarAxisTicksCache } from "../model/intervals/axis-ticks-cache.js";
import { chartPalette } from "../model/theme.js";
import type { Candle } from "../model/types.js";
import type { ChartOptions } from "./adapter.js";
import { paintCalendarAxis, paintCalendarGrid } from "./lightweight-calendar-grid.js";

/** Own the shared axis/grid calculation, not pixels. Call invalidate on setData or time insertion. */
export function lightweightCalendar(
  chart: Pick<IChartApi, "timeScale">,
  options: ChartOptions,
  data: () => readonly Candle[]
) {
  const { timeframe, settings } = options;
  const display = calendarAxisDisplay(timeframe, options);
  const palette = chartPalette(settings);
  const cache = new CalendarAxisTicksCache();
  let revision = 0;
  let disposed = false;
  const frame = (width: number) => {
    if (disposed) return null;
    const scale = chart.timeScale(),
      range = scale.getVisibleLogicalRange();
    if (!range) {
      cache.clear();
      return null;
    }
    const current = data();
    const geometry = {
      from: range.from,
      to: range.to,
      width,
      coordinate: (index: number) => scale.logicalToCoordinate(index as Logical) ?? NaN,
      display,
      revision
    };
    return { data: current, ...geometry, ticks: cache.get(current, timeframe, geometry) };
  };
  const timeAxisPaneViews: NonNullable<ISeriesPrimitive<Time>["timeAxisPaneViews"]> = () =>
    hasCalendarAxis(timeframe)
      ? [
          {
            zOrder: () => "normal",
            renderer: () => ({
              draw: (target) =>
                target.useBitmapCoordinateSpace((scope) => {
                  const {
                    context,
                    horizontalPixelRatio: x,
                    verticalPixelRatio: y,
                    bitmapSize
                  } = scope;
                  const current = frame(bitmapSize.width / x);
                  if (!current) return;
                  context.save();
                  context.scale(x, y);
                  paintCalendarAxis(context, current.data, timeframe, {
                    ...current,
                    height: bitmapSize.height / y,
                    color: palette.muted,
                    fontSize: settings.scaleFontSize ?? 11,
                    fontFamily:
                      '-apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif'
                  });
                  context.restore();
                })
            })
          }
        ]
      : [];
  return {
    timeAxisPaneViews,
    paintGrid(
      context: CanvasRenderingContext2D,
      width: number,
      height: number,
      pixelRatio: number
    ) {
      if (settings.grid === false || !hasCalendarAxis(timeframe)) return;
      const current = frame(width);
      if (current)
        paintCalendarGrid(context, current.data, timeframe, {
          ...current,
          height,
          color: palette.grid,
          pixelRatio
        });
    },
    invalidate() {
      revision++;
      cache.clear();
    },
    dispose() {
      disposed = true;
      cache.clear();
    }
  };
}
