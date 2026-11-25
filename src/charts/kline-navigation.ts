import { DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";
import type { ChartAdapter } from "./adapter.js";
import { freezeKlinePriceScale, resetKlinePriceScale } from "./kline-price-scale.js";
import { navigationCenter, navigationDistance, zoomSpacing } from "./navigation-controls.js";

type NativeChart = Pick<
  Chart,
  | "getSize"
  | "convertToPixel"
  | "getBarSpace"
  | "zoomAtCoordinate"
  | "scrollByDistance"
  | "setBarSpace"
  | "scrollToRealTime"
  | "getDom"
>;

export function klineNavigation(
  chart: NativeChart,
  count: () => number,
  ready: () => boolean
): Pick<ChartAdapter, "zoom" | "scroll" | "resetView"> {
  function geometry() {
    if (!ready() || !count()) return null;
    const size = chart.getSize("candle_pane", DomPosition.Main),
      points = chart.convertToPixel([{ dataIndex: 0 }, { dataIndex: count() - 1 }], {
        paneId: "candle_pane",
        absolute: true
      });
    if (!size || !Number.isFinite(size.width) || size.width <= 0 || !Array.isArray(points))
      return null;
    const firstX = points[0]?.x,
      lastX = points[1]?.x;
    return firstX != null && Number.isFinite(firstX) && lastX != null && Number.isFinite(lastX)
      ? { ...size, firstX, lastX }
      : null;
  }
  return {
    zoom(direction) {
      const g = geometry();
      if (!g) return;
      const current = chart.getBarSpace(),
        next = zoomSpacing(current, direction, 1, 50);
      if (!Number.isFinite(current) || current <= 0) return;
      chart.zoomAtCoordinate(
        next / current,
        { x: navigationCenter(g.width, g.firstX, g.lastX), y: g.height / 2 },
        0
      );
    },
    scroll(direction) {
      const g = geometry();
      if (!g) return;
      const distance = navigationDistance(direction, g.width, g.firstX, g.lastX);
      if (!distance) return;
      freezeKlinePriceScale(chart);
      chart.scrollByDistance(distance, 0);
    },
    resetView() {
      if (!geometry()) return;
      resetKlinePriceScale(chart);
      chart.setBarSpace(6);
      chart.scrollToRealTime(0);
    }
  };
}
