import { LineType } from "klinecharts";
import type { Chart } from "klinecharts";
import type { ChartOptions } from "./adapter.js";
import { lineColor } from "../model/candle-palette.js";
import { activeMtpPeriods } from "../model/mtp.js";
import { drawingToolbarSettings } from "../model/drawing-toolbar.js";

/** Flags/styles are fixed for the adapter's lifetime by chartRenderConfigKey. */
export function initializeKlineIndicators(
  chart: Chart,
  options: Pick<ChartOptions, "indicators" | "settings">,
  volumeHeight: number
): void {
  const { indicators, settings } = options;
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
  if (indicators.volume)
    chart.createIndicator("VOL", false, {
      id: "volume_pane",
      height: volumeHeight,
      dragEnabled: !drawingToolbarSettings(settings).indicatorsLocked
    });
  if (activeMtpPeriods(indicators).length)
    chart.createIndicator("MTP_PERSONAL", true, { id: "candle_pane" });
  chart.createIndicator("DRAWINGS_PERSONAL", true, { id: "candle_pane" });
}
