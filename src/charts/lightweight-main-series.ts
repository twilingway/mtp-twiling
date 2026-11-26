import { AreaSeries, BarSeries, CandlestickSeries, LineSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { NATIVE_CHART_LINE, resolveNativeChartType } from "../model/native-chart-type.js";
import type { Candle, ChartSettings } from "../model/types.js";
import { lightweightPriceFormat } from "./price-format.js";
import type { ChartPriceFormat } from "./price-format.js";

export type LightweightMainSeries = ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area">;

export const lightweightBarTime = (bar: Candle): UTCTimestamp =>
  Math.floor(bar.timestamp / 1000) as UTCTimestamp;

export function lightweightMainSeries(
  chart: IChartApi,
  settings: ChartSettings,
  format: ChartPriceFormat
) {
  const type = resolveNativeChartType(settings),
    color = NATIVE_CHART_LINE;
  const common = {
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: lightweightPriceFormat(format)
  };
  let series: LightweightMainSeries;
  if (type === "bars")
    series = chart.addSeries(BarSeries, {
      ...common,
      openVisible: true,
      thinBars: true,
      upColor: settings.upColor ?? "#53b987",
      downColor: settings.downColor ?? "#eb4d5c"
    });
  else if (type === "line")
    series = chart.addSeries(LineSeries, {
      ...common,
      color: color.color,
      lineWidth: color.width,
      lineVisible: true,
      pointMarkersVisible: false
    });
  else if (type === "area")
    series = chart.addSeries(AreaSeries, {
      ...common,
      lineColor: color.color,
      lineWidth: color.width,
      topColor: color.top,
      bottomColor: color.bottom,
      pointMarkersVisible: false
    });
  else
    series = chart.addSeries(CandlestickSeries, {
      ...common,
      upColor: settings.bodyVisible === false ? "transparent" : (settings.upColor ?? "#53b987"),
      downColor: settings.bodyVisible === false ? "transparent" : (settings.downColor ?? "#eb4d5c"),
      wickUpColor: settings.wickUpColor ?? "#336854",
      wickDownColor: settings.wickDownColor ?? "#7f323f",
      borderUpColor: settings.borderUpColor ?? "#53b987",
      borderDownColor: settings.borderDownColor ?? "#eb4d5c",
      borderVisible: settings.borderVisible !== false,
      wickVisible: settings.wickVisible !== false
    });
  const row = (bar: Candle) => {
    const time = lightweightBarTime(bar);
    return type === "line" || type === "area"
      ? { time, value: bar.close }
      : { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
  };
  return {
    series,
    setData: (bars: readonly Candle[]) => series.setData(bars.map(row)),
    update: (bar: Candle, historical: boolean) => series.update(row(bar), historical)
  };
}
