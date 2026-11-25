import type {
  Candle,
  ChartEngine,
  ChartSettings,
  Drawing,
  DrawingDraft,
  DrawingTool,
  ImageAsset,
  IndicatorFlags,
  IndicatorKey,
  MarketRow,
  Timeframe
} from "../../model/types.js";
export const DEFAULT_INDICATORS: IndicatorFlags = {
  ma: false,
  ema: false,
  volume: true,
  mtp160: true,
  mtp440: true,
  mtp640: false
};
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  grid: true,
  upColor: "#53b987",
  downColor: "#eb4d5c",
  wickUpColor: "#336854",
  wickDownColor: "#7f323f",
  borderUpColor: "#53b987",
  borderDownColor: "#eb4d5c",
  borderVisible: true,
  bodyVisible: true,
  wickVisible: true,
  candlePaletteVersion: 1,
  scaleFontSize: 11,
  showLegend: true,
  priceLine: true,
  showCandleCountdown: true
};
export const INDICATOR_NAMES: Record<IndicatorKey, string> = {
  volume: "Объём",
  mtp640: "MTP160+440+640",
  mtp440: "MTP160+440",
  mtp160: "MTP160",
  ma: "SMA 20",
  ema: "EMA 50"
};
export const PERIOD_LABELS: Record<Timeframe, string> = {
  "1m": "1м",
  "5m": "5м",
  "15m": "15м",
  "30m": "30м",
  "1h": "1ч",
  "1d": "1Д",
  "1w": "1Н"
};
export interface TerminalPreferences {
  rightPanelCollapsed?: boolean;
  rightPanelTab?: "watchlist" | "objects";
  sidebarWidth?: number;
  symbol: string;
  instrumentUid?: string | null;
  timeframe: Timeframe;
  engine: ChartEngine;
  indicators: IndicatorFlags;
  rangeDays: number;
  chartSettings: ChartSettings;
}
export type TerminalDialog =
  | null
  | "delete-object"
  | "account"
  | "instruments"
  | "chart-settings"
  | "drawing-settings"
  | "indicator-settings";
export type ContextTarget =
  | { kind: "drawing"; id: string }
  | { kind: "image"; id: string }
  | { kind: "indicator"; key: IndicatorKey }
  | { kind: "chart" };
export interface ContextMenu {
  x: number;
  y: number;
  target: ContextTarget;
}
export interface TerminalState {
  mobilePanelOpen?: boolean;
  chartRevision: number;
  ready: boolean;
  owner: string;
  name: string;
  authenticated: boolean;
  status: string;
  error: string | null;
  rows: MarketRow[];
  pricesDirection: ReadonlyMap<string, "positive" | "negative">;
  preferences: TerminalPreferences;
  candles: Candle[];
  drawings: Drawing[];
  images: ImageAsset[];
  loading: boolean;
  historyHelp: string;
  activeTool: DrawingTool | null;
  preview: DrawingDraft | null;
  selectedObject: string | null;
  dialog: TerminalDialog;
  contextMenu: ContextMenu | null;
  objectPanel: boolean;
  toast: string;
  editingIndicator: IndicatorKey;
  crosshairBar: Candle | null;
}
export function number(value: number | null | undefined, digits = 2, signed = false): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: signed ? "exceptZero" : "auto"
      }).format(value);
}
export function signClass(value: number | null | undefined): string {
  return value == null || value === 0 ? "" : value > 0 ? "positive" : "negative";
}
export function timeLabel(value: string | number | null | undefined): string {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date(value))
    : "—";
}
export function logoUrl(row: MarketRow): string | null {
  const name = row.brand?.logoName;
  return typeof name === "string" && /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(name)
    ? "https://invest-brands.cdn-tinkoff.ru/" + name.replace(/\.(png|jpg|jpeg|webp)$/i, "x160.$1")
    : null;
}
