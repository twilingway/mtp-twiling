import { chartBackground, chartLabelText, readableChartColor } from "./theme.js";
import type { ChartSettings } from "./types.js";

export const DEFAULT_LAST_PRICE_COLOR = "#c73952";

export function lastPriceStyle(settings: ChartSettings, rising: boolean) {
  const preferred =
    settings.lastPriceColor ??
    (rising ? (settings.upColor ?? "#53b987") : (settings.downColor ?? "#eb4d5c"));
  const color = readableChartColor(preferred, chartBackground(settings), 3);
  return { color, text: chartLabelText(color) };
}
