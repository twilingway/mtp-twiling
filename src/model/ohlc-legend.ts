import { intlLocale } from "../i18n/preferences.js";
import type { Candle, ChartSettings } from "./types.js";
import { TRADINGVIEW_CANDLE_STYLE } from "./candle-palette.js";
import { chartPalette, readableChartColor } from "./theme.js";

export const ohlcDisplayMode = (settings?: ChartSettings) => settings?.ohlcDisplay ?? "candle";

export function ohlcCandleIndex(candles: readonly Candle[], timestamp: number): number {
  if (!Number.isFinite(timestamp)) return -1;
  let left = 0,
    right = candles.length - 1;
  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const { timestamp: barTime } = candles[middle]!;
    if (barTime === timestamp) return middle;
    if (barTime < timestamp) left = middle + 1;
    else right = middle - 1;
  }
  return -1;
}

interface OhlcBox {
  width: number;
  height: number;
}

export function placeOhlcCard(
  anchor: { x: number; y: number },
  plot: OhlcBox & { top: number },
  card: OhlcBox
) {
  const gap = 8;
  const right = Math.max(0, plot.width - card.width);
  const bottom = Math.max(plot.top, plot.height - card.height);
  return {
    x: Math.min(
      right,
      Math.max(0, anchor.x + gap <= right ? anchor.x + gap : anchor.x - gap - card.width)
    ),
    y: Math.min(
      bottom,
      Math.max(
        plot.top,
        anchor.y - gap - card.height >= plot.top ? anchor.y - gap - card.height : anchor.y + gap
      )
    )
  };
}

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
  const { background, muted: labelColor } = chartPalette(settings);
  const color =
    direction === "up"
      ? (settings.upColor ?? TRADINGVIEW_CANDLE_STYLE.upColor)
      : direction === "down"
        ? (settings.downColor ?? TRADINGVIEW_CANDLE_STYLE.downColor)
        : labelColor;
  return {
    values,
    change,
    percent,
    direction,
    color: readableChartColor(color, background, 4.5),
    labelColor
  };
}

export function formatOhlcValue(value: number | null, digits: number, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const precision = Number.isFinite(digits) ? Math.min(20, Math.max(0, Math.floor(digits))) : 2;
  return new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    signDisplay: signed ? "exceptZero" : "auto"
  }).format(Object.is(value, -0) ? 0 : value);
}
