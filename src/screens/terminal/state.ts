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
  IndicatorPaneLayout,
  MarketRow,
  Timeframe
} from "../../model/types.js";
import { NATIVE_PERIOD_LABELS } from "../../model/intervals/native-timeframes.js";
import type { IntervalId } from "../../model/intervals/registry.js";
import type { DisplayPreferences } from "../../i18n/preferences.js";
import type { TechnicalIndicatorInstance } from "../../model/technical-indicators/types.js";
import type { TechnicalPaneLayout } from "../../model/technical-indicator-layout.js";
import type { WatchlistFlags, WatchlistFlagFilter } from "../../model/watchlist-flags.js";
import type { WatchlistSections } from "../../model/watchlist-sections.js";
import type { MarketProviderRef } from "../../model/market-provider.js";
import { formatClock, formatNumber } from "../../i18n/format.js";
import type { DrawingSettingsPreview } from "./drawing-settings-preview.js";
export const DEFAULT_INDICATORS: IndicatorFlags = {
  ma: false,
  ema: false,
  volume: true,
  mtp160: true,
  mtp440: true,
  mtp640: false,
  mtpAll: false
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
  mtpAll: "MTP 0–640",
  mtp640: "MTP 440–640",
  mtp440: "MTP 160–440",
  mtp160: "MTP 0–160",
  ma: "SMA 20",
  ema: "EMA 50"
};
export const PERIOD_LABELS: Record<Timeframe, string> = NATIVE_PERIOD_LABELS;
export interface TerminalPreferences extends DisplayPreferences {
  technicalIndicators?: TechnicalIndicatorInstance[];
  technicalPaneLayout?: TechnicalPaneLayout;
  providerRef?: MarketProviderRef | undefined;
  watchlistFlags?: WatchlistFlags;
  watchlistSections?: WatchlistSections;
  watchlistFlagFilter?: WatchlistFlagFilter;
  indicatorPaneLayout?: IndicatorPaneLayout;
  favoriteIntervals?: IntervalId[];
  rightPanelCollapsed?: boolean;
  rightPanelTab?: "watchlist" | "objects";
  sidebarWidth?: number;
  rightDetailsHeightRatio?: number;
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
  | "welcome"
  | "delete-object"
  | "account"
  | "instruments"
  | "chart-settings"
  | "drawing-settings"
  | "indicator-library"
  | "technical-settings"
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
  editingTechnicalIndicator?: string;
  drawingSettingsPreview?: DrawingSettingsPreview | null;
  marketReady?: boolean;
  profileTransition?: boolean;
  pendingPublicSource?: string | null;
  /** An auxiliary chart cannot replace a document before its objects have been loaded. */
  annotationReady?: boolean;
  importingBackup?: boolean;
  importRecoveryRequired?: boolean;
  backupBusy?: boolean;
  /** False while restoring a saved viewport whose data is not covered yet. */
  historyViewReady?: boolean;
  /** The available candles can be shown, but the saved camera is outside their history. */
  historyViewFallback?: boolean;
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
  initialAccountSection?: "drive" | undefined;
  contextMenu: ContextMenu | null;
  objectPanel: boolean;
  toast: string;
  editingIndicator: IndicatorKey;
  crosshairBar: Candle | null;
}
export function number(value: number | null | undefined, digits = 2, signed = false): string {
  return formatNumber(value, digits, signed);
}
export function signClass(value: number | null | undefined): string {
  return value == null || value === 0 ? "" : value > 0 ? "positive" : "negative";
}
export function timeLabel(value: string | number | null | undefined): string {
  return value ? formatClock(new Date(value).getTime()) : "—";
}
export function logoUrl(row: MarketRow): string | null {
  const name = row.brand?.logoName;
  return typeof name === "string" && /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(name)
    ? "https://invest-brands.cdn-tinkoff.ru/" + name.replace(/\.(png|jpg|jpeg|webp)$/i, "x160.$1")
    : null;
}
