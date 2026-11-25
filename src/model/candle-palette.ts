import type { ChartSettings } from "./types.js";

// Captured from the user's current TradingView candleStyle properties, not inferred from pixels.
export const TRADINGVIEW_CANDLE_STYLE = {
  upColor: "#53b987",
  downColor: "#eb4d5c",
  borderUpColor: "#53b987",
  borderDownColor: "#eb4d5c",
  wickUpColor: "#336854",
  wickDownColor: "#7f323f",
  bodyVisible: true,
  borderVisible: true,
  wickVisible: true,
  candlePaletteVersion: 1
} satisfies ChartSettings;

export function migrateCandlePalette(saved?: ChartSettings): ChartSettings {
  const legacy =
    saved?.candlePaletteVersion !== 1 &&
    ["#1cbea3", "#089981"].includes(saved?.upColor?.toLowerCase() ?? "") &&
    ["#ee586b", "#f23645"].includes(saved?.downColor?.toLowerCase() ?? "");
  return {
    ...TRADINGVIEW_CANDLE_STYLE,
    ...saved,
    ...(legacy
      ? {
          upColor: TRADINGVIEW_CANDLE_STYLE.upColor,
          downColor: TRADINGVIEW_CANDLE_STYLE.downColor
        }
      : {}),
    candlePaletteVersion: 1
  };
}

export function lineColor(color: string, opacity = 1): string {
  if (opacity >= 1) return color;
  const value = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return color;
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)},${Number.parseInt(value.slice(2, 4), 16)},${Number.parseInt(value.slice(4, 6), 16)},${Math.max(0, opacity)})`;
}
