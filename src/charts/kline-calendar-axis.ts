import { registerXAxis } from "klinecharts";
import type { Chart } from "klinecharts";
import { calendarAxisTicks } from "../model/intervals/axis-ticks.js";
import type { Timeframe, Candle } from "../model/types.js";
import type { CalendarAxisDisplay } from "../i18n/calendar-axis.js";

/** Only XAxis tick selection changes; crosshair and tooltip date formatters stay intact. */
export function attachCalendarXAxis(
  chart: Chart,
  getData: () => readonly Candle[],
  timeframe: Timeframe,
  display?: CalendarAxisDisplay
): () => void {
  const source = { chart: chart as Chart | null, getData, timeframe, display };
  const name = "personal-calendar-boundaries";
  registerXAxis({ name, createTicks: calendarTicks(new WeakRef(source)) });
  chart.setPaneOptions({ id: "x_axis_pane", axisOptions: { name } });
  return () => {
    source.chart = null;
    source.getData = () => [];
  };
}
/** v9 axis callbacks have no extendData argument. A weak context keeps old callbacks owner-isolated. */
function calendarTicks(
  weak: WeakRef<{
    chart: Chart | null;
    getData: () => readonly Candle[];
    timeframe: Timeframe;
    display: CalendarAxisDisplay | undefined;
  }>
): Parameters<typeof registerXAxis>[0]["createTicks"] {
  return ({ bounding, defaultTicks }) => {
    const source = weak.deref(),
      chart = source?.chart;
    if (!source || !chart) return defaultTicks;
    const range = chart.getVisibleRange();
    return (
      calendarAxisTicks(source.getData(), source.timeframe, {
        from: range.realFrom,
        to: range.realTo,
        width: bounding.width,
        coordinate: (index) => {
          const point = chart.convertToPixel({ dataIndex: index }, { paneId: "candle_pane" });
          return !Array.isArray(point) && typeof point.x === "number" ? point.x : NaN;
        },
        ...(source.display ? { display: source.display } : {})
      }) ?? defaultTicks
    );
  };
}
