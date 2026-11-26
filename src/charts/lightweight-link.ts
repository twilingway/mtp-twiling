import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import type { Candle, Timeframe } from "../model/types.js";
import type { ChartOptions, LinkedTimeWindow } from "./adapter.js";
import { inPlot, linkedBarIndex, linkedTimeIndices } from "./layout-link.js";
import type { LightweightMainSeries } from "./lightweight-main-series.js";

/** Line/area points only contain time and close; report the original candle in every mode. */
function rawCandleAt(data: readonly Candle[], time: number): Candle | null {
  let low = 0;
  let high = data.length;
  while (low < high) {
    const index = Math.floor((low + high) / 2);
    if (Math.floor(data[index]!.timestamp / 1000) < time) low = index + 1;
    else high = index;
  }
  const bar = data[low];
  return bar && Math.floor(bar.timestamp / 1000) === time ? bar : null;
}

export function lightweightLink(
  chart: Pick<
    IChartApi,
    "timeScale" | "setCrosshairPosition" | "clearCrosshairPosition" | "subscribeCrosshairMove"
  >,
  series: LightweightMainSeries,
  timeframe: Timeframe,
  height: () => number,
  projectionDelta: () => number,
  onCrosshair: ChartOptions["onCrosshair"],
  data: () => readonly Candle[]
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
    const time = event.time ?? event.seriesData.get(series)?.time;
    onCrosshair(typeof time === "number" ? rawCandleAt(data(), time) : null);
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
