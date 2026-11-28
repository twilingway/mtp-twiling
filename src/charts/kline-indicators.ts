import { LineType } from "klinecharts";
import type { Chart } from "klinecharts";
import type { ChartOptions } from "./adapter.js";
import { lineColor } from "../model/candle-palette.js";
import { activeMtpPeriods } from "../model/mtp.js";
import { drawingToolbarSettings } from "../model/drawing-toolbar.js";
import { volumeAverageSettings, volumeSma } from "../model/volume-average.js";
import { initializeKlineHollowCandles } from "./kline-hollow-candles.js";

/** Flags/styles are fixed for the adapter's lifetime by chartRenderConfigKey. */
export function initializeKlineIndicators(
  chart: Chart,
  options: Pick<ChartOptions, "indicators" | "settings">,
  volumeHeight: number
): void {
  const { indicators, settings } = options;
  initializeKlineHollowCandles(chart, settings);
  for (const [key, name, period, color] of [
    ["ma", "MA", 20, "#ddad56"],
    ["ema", "EMA", 50, "#7b8fff"]
  ] as const) {
    if (!indicators[key]) continue;
    const style = settings.indicatorOptions?.[key];
    chart.createIndicator(
      {
        name,
        calcParams: [period],
        zLevel: -1,
        styles: {
          lines: [
            {
              color: lineColor(style?.color ?? color, style?.opacity),
              size: style?.width ?? 1,
              style: LineType.Solid,
              dashedValue: [],
              smooth: false
            }
          ]
        }
      },
      true,
      { id: "candle_pane" }
    );
  }
  if (indicators.volume) {
    const average = volumeAverageSettings(settings),
      style = settings.indicatorOptions?.volume;
    chart.createIndicator(
      {
        name: "VOL",
        calcParams: average.enabled ? [average.period] : [],
        styles: {
          lines: [
            {
              color: lineColor(style?.color ?? "#7b8fff", style?.opacity),
              size: style?.width ?? 1,
              style: LineType.Solid,
              dashedValue: [],
              smooth: false
            }
          ]
        },
        ...(average.enabled
          ? {
              calc(data) {
                const values = volumeSma(data, average.period);
                return data.map((bar, index) => ({
                  volume: bar.volume,
                  ma1: values[index] ?? undefined
                }));
              }
            }
          : {})
      },
      false,
      {
        id: "volume_pane",
        height: volumeHeight,
        dragEnabled: !drawingToolbarSettings(settings).indicatorsLocked
      }
    );
  }
  if (activeMtpPeriods(indicators).length)
    chart.createIndicator("MTP_PERSONAL", true, { id: "candle_pane" });
  chart.createIndicator("DRAWINGS_PERSONAL", true, { id: "candle_pane" });
}
