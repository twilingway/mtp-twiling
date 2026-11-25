import { registerXAxis } from "klinecharts";
import type { Chart } from "klinecharts";
import { calendarAxisTicks } from "../model/intervals/axis-ticks.js";
import type { Timeframe, Candle } from "../model/types.js";

/** Only XAxis tick selection changes; crosshair and tooltip date formatters stay intact. */
export function attachCalendarXAxis(
  chart: Chart,
  getData: () => readonly Candle[],
  timeframe: Timeframe
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
    createTicks: ({ range, bounding, defaultTicks }) =>
      calendarAxisTicks(source.getData(), timeframe, {
        from: range.from,
        to: range.to,
        width: bounding.width,
        coordinate: source.coordinate
      }) ?? defaultTicks
  });
  chart.setPaneOptions({ id: "x_axis_pane", axisOptions: { name } });
  return () => {
    source.getData = () => [];
    source.coordinate = () => NaN;
  };
}
