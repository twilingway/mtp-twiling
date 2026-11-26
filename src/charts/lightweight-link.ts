import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Candle, Timeframe } from "../model/types.js";
import type { ChartOptions, LinkedTimeWindow } from "./adapter.js";
import { inPlot, linkedBarIndex, linkedTimeIndices } from "./layout-link.js";

export function lightweightLink(
  chart: Pick<
    IChartApi,
    "timeScale" | "setCrosshairPosition" | "clearCrosshairPosition" | "subscribeCrosshairMove"
  >,
  series: ISeriesApi<"Candlestick">,
  timeframe: Timeframe,
  height: () => number,
  projectionDelta: () => number,
  onCrosshair: ChartOptions["onCrosshair"]
) {
  let linkedCrosshair = false;
  let linkedTimestamp: number | null = null;
  let refreshFrame: number | null = null;
  const clearCrosshair = () => {
    if (!linkedCrosshair) return;
    linkedCrosshair = false;
    chart.clearCrosshairPosition();
  };
  const setCrosshair = (data: readonly Candle[], timestamp: number | null): void => {
    linkedTimestamp = timestamp;
    const index = timestamp === null ? null : linkedBarIndex(data, timestamp, timeframe);
    if (index === null) return clearCrosshair();
    const bar = data[index]!;
    const time = Math.floor(bar.timestamp / 1000) as UTCTimestamp;
    const scale = chart.timeScale();
    const x = scale.timeToCoordinate(time);
    const y = series.priceToCoordinate(bar.close);
    if (x === null || y === null || !inPlot(x, y, scale.width(), height())) return clearCrosshair();
    linkedCrosshair = true;
    chart.setCrosshairPosition(bar.close, time, series);
  };
  chart.subscribeCrosshairMove((event) => {
    // LW recalculates the synthetic position on redraw without a source pointer event.
    if (!event.sourceEvent && (linkedCrosshair || event.point)) return;
    linkedCrosshair = false;
    linkedTimestamp = null;
    const bar = event.seriesData.get(series);
    onCrosshair(
      bar && "open" in bar && typeof bar.time === "number"
        ? {
            timestamp: bar.time * 1000,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: 0
          }
        : null
    );
  });
  return {
    setCrosshair,
    setTimeWindow(data: readonly Candle[], window: LinkedTimeWindow): void {
      const target = linkedTimeIndices(data, window, timeframe);
      const scale = chart.timeScale();
      if (!target || scale.width() <= 0 || !scale.getVisibleLogicalRange()) return;
      if (target.from === undefined) {
        const offset = target.to - (data.length - 1) - projectionDelta();
        if (Math.abs(scale.scrollPosition() - offset) > 1e-7) scale.scrollToPosition(offset, false);
      } else {
        scale.setVisibleLogicalRange({ from: target.from, to: target.to });
      }
      if (linkedTimestamp !== null && refreshFrame === null) {
        // The public time scale commits its viewport on a chart frame first.
        refreshFrame = requestAnimationFrame(() => {
          refreshFrame = null;
          if (linkedTimestamp !== null) setCrosshair(data, linkedTimestamp);
        });
      }
    },
    dispose() {
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
    }
  };
}
