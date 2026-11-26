import { HistogramSeries, LineSeries } from "lightweight-charts";
import type { IChartApi, PriceFormat, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../model/types.js";
import type { ChartOptions } from "./adapter.js";
import { movingAverage } from "./adapter.js";
import { lineColor } from "../model/candle-palette.js";
import { volumeAverageSettings, volumeSma } from "../model/volume-average.js";

/** Existing VOL/SMA20/EMA50 flags retain their formula, appearance and price-pane placement. */
export function lightweightLegacy(
  chart: IChartApi,
  { indicators, settings }: ChartOptions,
  priceFormat?: PriceFormat
) {
  const volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    lastValueVisible: false,
    priceLineVisible: false
  });
  volume
    .priceScale()
    .applyOptions({ scaleMargins: { top: 0.83, bottom: 0 }, borderVisible: false });
  const volumeAverage = volumeAverageSettings(settings),
    volumeStyle = settings.indicatorOptions?.volume,
    volumeLine =
      indicators.volume && volumeAverage.enabled
        ? chart.addSeries(LineSeries, {
            color: lineColor(volumeStyle?.color ?? "#7b8fff", volumeStyle?.opacity),
            lineWidth: (volumeStyle?.width ?? 1) as 1 | 2 | 3 | 4,
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
            lastValueVisible: false,
            priceLineVisible: false
          })
        : null;
  const average = (key: "ma" | "ema", fallback: string) =>
    chart.addSeries(LineSeries, {
      color: lineColor(
        settings.indicatorOptions?.[key]?.color ?? fallback,
        settings.indicatorOptions?.[key]?.opacity
      ),
      ...(priceFormat && { priceFormat }),
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
  const setVolumeAverage = (data: Candle[]) => {
    if (volumeLine) {
      volumeLine.setData(
        volumeSma(data, volumeAverage.period).map((value, index) => ({
          time: time(data[index]!),
          ...(value !== null ? { value } : {})
        }))
      );
    }
  };
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
    setPriceFormat(format: PriceFormat) {
      // These series precede candles and can supply the right-axis formatter even when empty.
      sma.applyOptions({ priceFormat: format });
      ema.applyOptions({ priceFormat: format });
    },
    setData(data: Candle[]) {
      volume.setData(indicators.volume ? data.map(volumeValue) : []);
      setVolumeAverage(data);
      averages(data);
    },
    update(data: Candle[], bar: Candle, historical: boolean) {
      if (indicators.volume) volume.update(volumeValue(bar), historical);
      if (historical) setVolumeAverage(data);
      else if (volumeLine) {
        const value = volumeSma(data.slice(-volumeAverage.period), volumeAverage.period).at(-1);
        volumeLine.update({ time: time(bar), ...(value != null ? { value } : {}) });
      }
      averages(data);
    }
  };
}
