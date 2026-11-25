import type { Candle, ChartSettings } from "./types.js";
import { TRADINGVIEW_CANDLE_STYLE } from "./candle-palette.js";
import { chartPalette } from "./theme.js";

export type OhlcDirection = "up" | "down" | "neutral";
export interface OhlcLegendModel {
  values: Record<"open" | "high" | "low" | "close", number | null>;
  change: number | null;
  percent: number | null;
  direction: OhlcDirection;
  color: string;
  labelColor: string;
}

const finite = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) ? value : null;

export function createOhlcLegend(
  bar?: Candle,
  previousClose?: number,
  settings: ChartSettings = {}
): OhlcLegendModel {
  const values = {
    open: finite(bar?.open),
    high: finite(bar?.high),
    low: finite(bar?.low),
    close: finite(bar?.close)
  };
  const previous = finite(previousClose);
  const change =
    values.close !== null && previous !== null ? finite(values.close - previous) : null;
  const percent =
    change !== null && previous !== null && previous !== 0
      ? finite((change / previous) * 100)
      : null;
  // Use the preceding close, matching the displayed change; the first bar has only its body.
  const comparison = previous ?? values.open;
  const movement = values.close !== null && comparison !== null ? values.close - comparison : 0;
  const direction = movement > 0 ? "up" : movement < 0 ? "down" : "neutral";
  const labelColor = chartPalette(settings).muted;
  const color =
    direction === "up"
      ? (settings.upColor ?? TRADINGVIEW_CANDLE_STYLE.upColor)
      : direction === "down"
        ? (settings.downColor ?? TRADINGVIEW_CANDLE_STYLE.downColor)
        : labelColor;
  return { values, change, percent, direction, color, labelColor };
}

export function formatOhlcValue(value: number | null, digits: number, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const precision = Number.isFinite(digits) ? Math.min(20, Math.max(0, Math.floor(digits))) : 2;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    signDisplay: signed ? "exceptZero" : "auto"
  }).format(Object.is(value, -0) ? 0 : value);
}
