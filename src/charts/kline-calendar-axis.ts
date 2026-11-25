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
  const source = {
    getData,
    coordinate: (index: number) => {
      const point = chart.convertToPixel({ dataIndex: index }, { paneId: "candle_pane" });
      return !Array.isArray(point) && typeof point.x === "number" ? point.x : NaN;
    }
  };
  const name = "personal-calendar-boundaries";
  registerXAxis({
    name,
    createTicks: ({ bounding, defaultTicks }) => {
      const range = chart.getVisibleRange();
      return (
        calendarAxisTicks(source.getData(), timeframe, {
          from: range.realFrom,
          to: range.realTo,
          width: bounding.width,
          coordinate: source.coordinate,
          ...(display ? { display } : {})
        }) ?? defaultTicks
      );
    }
  });
  chart.setPaneOptions({ id: "x_axis_pane", axisOptions: { name } });
  return () => {
    source.getData = () => [];
    source.coordinate = () => NaN;
  };
}
