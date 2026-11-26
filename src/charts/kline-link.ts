import { ActionType, DomPosition } from "klinecharts";
import type { Chart, Coordinate, Point } from "klinecharts";
import type { Candle, Timeframe } from "../model/types.js";
import type { LinkedTimeWindow } from "./adapter.js";
import { inPlot, linkedBarIndex, linkedTimeIndices } from "./layout-link.js";

type NativeChart = Pick<
  Chart,
  "executeAction" | "getSize" | "getBarSpace" | "setBarSpace" | "scrollByDistance"
>;

const paneId = "candle_pane";

export function klineLink(
  chart: NativeChart,
  timeframe: Timeframe,
  toPixel: (point: Partial<Point>) => Partial<Coordinate>
) {
  let linkedCrosshair = false;
  let linkedTimestamp: number | null = null;
  const clearCrosshair = () => {
    if (!linkedCrosshair) return;
    linkedCrosshair = false;
    // 9.8 defaults nullish pane IDs to candle_pane. A non-string ID hides both native axes and lines.
    chart.executeAction(ActionType.OnCrosshairChange, { paneId: false });
  };
  const setCrosshair = (data: readonly Candle[], timestamp: number | null): void => {
    linkedTimestamp = timestamp;
    const dataIndex = timestamp === null ? null : linkedBarIndex(data, timestamp, timeframe);
    if (dataIndex === null) return clearCrosshair();
    const size = chart.getSize(paneId, DomPosition.Main);
    const { x, y } = toPixel({ dataIndex, value: data[dataIndex]!.close });
    // KLine floors X; half a pixel keeps the hover in its own cell even at 1px spacing.
    const hoverX = x == null ? NaN : x + 0.5;
    if (!size || y == null || !inPlot(hoverX, y, size.width, size.height)) return clearCrosshair();
    linkedCrosshair = true;
    chart.executeAction(ActionType.OnCrosshairChange, { x: hoverX, y, paneId });
  };
  return {
    acceptNativeCrosshair() {
      linkedCrosshair = false;
      linkedTimestamp = null;
    },
    setCrosshair,
    setTimeWindow(data: readonly Candle[], window: LinkedTimeWindow): void {
      const target = linkedTimeIndices(data, window, timeframe);
      const width = chart.getSize(paneId, DomPosition.Main)?.width;
      if (!target || !width || width <= 0) return;
      const current = chart.getBarSpace();
      if (target.from !== undefined) {
        // 9.8 ignores setBarSpace outside its native [1, 50] pixel limits.
        const spacing = Math.min(50, Math.max(1, width / (target.to - target.from + 1)));
        if (Math.abs(current - spacing) > 1e-7) chart.setBarSpace(spacing);
      }
      const spacing = chart.getBarSpace();
      const { x } = toPixel({ dataIndex: target.to });
      // Scrolling keeps the user's native real-time offset baseline intact.
      if (x != null && Number.isFinite(x) && spacing > 0) {
        const distance = width - spacing / 2 - x;
        if (Math.abs(distance) > 0.5) chart.scrollByDistance(distance, 0);
      }
      if (linkedTimestamp !== null) setCrosshair(data, linkedTimestamp);
    }
  };
}
