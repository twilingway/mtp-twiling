import { HistogramSeries, LineSeries } from "lightweight-charts";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../model/types.js";
import type { ChartOptions } from "./adapter.js";
import { movingAverage } from "./adapter.js";
import { lineColor } from "../model/candle-palette.js";

/** Existing VOL/SMA20/EMA50 flags retain their formula, appearance and price-pane placement. */
export function lightweightLegacy(chart: IChartApi, { indicators, settings }: ChartOptions) {
  const volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    lastValueVisible: false,
    priceLineVisible: false
  });
  volume
    .priceScale()
    .applyOptions({ scaleMargins: { top: 0.83, bottom: 0 }, borderVisible: false });
  const average = (key: "ma" | "ema", fallback: string) =>
    chart.addSeries(LineSeries, {
      color: lineColor(
        settings.indicatorOptions?.[key]?.color ?? fallback,
        settings.indicatorOptions?.[key]?.opacity
      ),
      lineWidth: (settings.indicatorOptions?.[key]?.width ?? 1) as 1 | 2 | 3 | 4,
      priceLineVisible: false,
      lastValueVisible: false
    });
  const sma = average("ma", "#ddad56"),
    ema = average("ema", "#7b8fff");
  const time = (bar: Candle) => Math.floor(bar.timestamp / 1000) as UTCTimestamp;
  const volumeValue = (bar: Candle) => ({
    time: time(bar),
    value: bar.volume,
    color: bar.close >= bar.open ? "#08998144" : "#f2364544"
  });
  const averages = (data: Candle[]) => {
    sma.setData(
      indicators.ma
        ? movingAverage(data, 20).map((point) => ({ ...point, time: point.time as UTCTimestamp }))
        : []
    );
    ema.setData(
      indicators.ema
        ? movingAverage(data, 50, true).map((point) => ({
            ...point,
            time: point.time as UTCTimestamp
          }))
        : []
    );
  };
  return {
    setData(data: Candle[]) {
      volume.setData(indicators.volume ? data.map(volumeValue) : []);
      averages(data);
    },
    update(data: Candle[], bar: Candle, historical: boolean) {
      if (indicators.volume) volume.update(volumeValue(bar), historical);
      averages(data);
    }
  };
}
