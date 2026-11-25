import { IndicatorSeries, registerIndicator } from "klinecharts";
import type { Chart, Indicator, IndicatorDrawParams } from "klinecharts";
import type { MtpModel } from "../model/mtp.js";
import type { Candle, Timeframe } from "../model/types.js";
import { logicalForTime } from "./adapter.js";
import type { ChartOptions } from "./adapter.js";
import { TIMEFRAMES } from "../model/history-codec.js";

export interface KlineDrawingContext {
  model: MtpModel | null;
  getData: () => readonly Candle[];
  timeframe: Timeframe;
  paint: ChartOptions["paint"] | null;
  disposed: boolean;
}
let registered = false;
function contextOf(indicator: Indicator | undefined): KlineDrawingContext | null {
  const value: unknown = indicator?.extendData;
  return value && typeof value === "object" && "context" in value
    ? (value.context as KlineDrawingContext)
    : null;
}
function drawObjects({ ctx, bounding, xAxis, yAxis, indicator }: IndicatorDrawParams<Indicator>) {
  const context = contextOf(indicator);
  if (!context || context.disposed || !context.paint) return true;
  context.paint(
    ctx,
    bounding.width,
    bounding.height,
    (point) => ({
      x: xAxis.convertToPixel(
        logicalForTime(context.getData(), point.timestamp, TIMEFRAMES[context.timeframe].ms)
      ),
      y: yAxis.convertToPixel(point.value)
    }),
    "back"
  );
  return true;
}
/** Registry callbacks are static and read only the native per-instance extendData argument. */
export function registerKlineDrawingIndicators(): void {
  if (registered) return;
  registered = true;
  registerIndicator({
    name: "MTP_PERSONAL",
    shortName: "",
    series: IndicatorSeries.Price,
    zLevel: -1,
    figures: [
      { key: "mtpLow", title: "", type: "line" },
      { key: "mtpHigh", title: "", type: "line" }
    ],
    calc: (_bars, indicator) => contextOf(indicator)?.model?.bounds ?? [],
    draw: ({ ctx, visibleRange, xAxis, yAxis, indicator }) => {
      const context = contextOf(indicator);
      if (!context || context.disposed) return true;
      context.model?.draw(
        ctx,
        visibleRange.from,
        visibleRange.to,
        (index) => xAxis.convertToPixel(index),
        (price) => (price == null ? null : yAxis.convertToPixel(price))
      );
      return true;
    }
  });
  registerIndicator({
    name: "DRAWINGS_PERSONAL",
    shortName: "",
    series: IndicatorSeries.Price,
    zLevel: -2,
    figures: [],
    calc: () => [],
    draw: drawObjects
  });
}
export function bindKlineDrawingIndicators(chart: Chart, context: KlineDrawingContext): void {
  for (const name of ["MTP_PERSONAL", "DRAWINGS_PERSONAL"])
    chart.overrideIndicator({ name, extendData: { context } }, "candle_pane");
}
export function redrawKlineDrawingIndicator(chart: Chart, context: KlineDrawingContext): void {
  if (!context.disposed)
    chart.overrideIndicator({ name: "DRAWINGS_PERSONAL", extendData: { context } }, "candle_pane");
}
export function disposeKlineDrawingContext(context: KlineDrawingContext): void {
  context.disposed = true;
  context.model = null;
  context.getData = () => [];
  context.paint = null;
}
