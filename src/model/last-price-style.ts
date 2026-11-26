import { chartBackground, chartLabelText, readableChartColor, terminalTheme } from "./theme.js";
import type { TerminalTheme } from "./theme.js";
import type { ChartSettings, PriceAxisLabelColors, PriceAxisLabelPalette } from "./types.js";

export const DEFAULT_LAST_PRICE_COLOR = "#c73952";

export function lastPriceLabelColors(settings: ChartSettings): PriceAxisLabelColors | null {
  return settings.priceAxisLabels?.[terminalTheme(settings)]?.lastPrice ?? null;
}

export function lastPriceStyle(
  settings: ChartSettings,
  rising: boolean,
  custom: PriceAxisLabelColors | null = lastPriceLabelColors(settings)
) {
  const preferred =
    settings.lastPriceColor ??
    (rising ? (settings.upColor ?? "#53b987") : (settings.downColor ?? "#eb4d5c"));
  const color = readableChartColor(preferred, chartBackground(settings), 3);
  const fill = custom?.fill ?? color;
  return { color, fill, text: custom?.text ?? chartLabelText(fill) };
}

export function drawingPriceLabelStyle(settings: ChartSettings, drawingColor: string) {
  const color = readableChartColor(drawingColor, chartBackground(settings), 3);
  const custom = settings.priceAxisLabels?.[terminalTheme(settings)]?.drawings;
  const fill = custom?.fill ?? color;
  return { color, fill, text: custom?.text ?? chartLabelText(fill) };
}

export function updatePriceAxisLabelColor(
  settings: ChartSettings,
  theme: TerminalTheme,
  label: keyof PriceAxisLabelPalette,
  field: keyof PriceAxisLabelColors,
  color: string | undefined
): ChartSettings {
  const next = { ...settings };
  const themes = { ...settings.priceAxisLabels };
  const palette = { ...themes[theme] };
  const colors = { ...palette[label] };
  if (color === undefined) delete colors[field];
  else colors[field] = color;
  if (Object.keys(colors).length) palette[label] = colors;
  else delete palette[label];
  if (Object.keys(palette).length) themes[theme] = palette;
  else delete themes[theme];
  if (Object.keys(themes).length) next.priceAxisLabels = themes;
  else delete next.priceAxisLabels;
  return next;
}
