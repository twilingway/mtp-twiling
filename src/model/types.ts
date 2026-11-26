import type { DrawingToolbarSettings } from "./drawing-toolbar.js";
import type { IntervalId, NativeIntervalId } from "./intervals/registry.js";
import type { DisplayPreferences } from "../i18n/preferences.js";
import type { WatchlistFlags, WatchlistFlagFilter } from "./watchlist-flags.js";
import type { WatchlistSections } from "./watchlist-sections.js";
import type { TechnicalIndicatorInstance } from "./technical-indicators/types.js";
import type { TechnicalPaneLayout } from "./technical-indicator-layout.js";
import type { MarketProviderRef, ProviderAttributes } from "./market-provider.js";

export type Timeframe = NativeIntervalId;
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface HistoryRange {
  from: number;
  to: number;
  fetchedAt?: number;
}
export type TimeRange = HistoryRange;
export interface Quotation {
  units: string | number;
  nano?: string | number;
}
export interface InstrumentBrand {
  logoName?: string;
  logoBaseColor?: string;
  textColor?: string;
}
export type InstrumentKind =
  "share" | "future" | "index" | "currency" | "crypto" | "tokenized-stock";
export type InstrumentSearchKind = "all" | InstrumentKind;
export interface CatalogInstrument extends ProviderAttributes {
  uid?: string;
  instrumentUid?: string;
  figi?: string;
  ticker: string;
  name: string;
  classCode?: string;
  exchange?: string;
  realExchange?: string;
  currency?: string;
  brand?: InstrumentBrand | null;
  minPriceIncrement?: Quotation;
  expirationDate?: string;
  first1minCandleDate?: string;
  first1dayCandleDate?: string;
  firstTradeDate?: string;
  instrumentType?: string;
  instrumentKind?: string;
  kind?: InstrumentKind;
}
export type Instrument = CatalogInstrument;
export interface Catalog {
  at: number;
  shares: CatalogInstrument[];
  futures: CatalogInstrument[];
  indicatives: CatalogInstrument[];
  currencies?: CatalogInstrument[];
}
export interface MarketRow extends ProviderAttributes {
  symbol: string;
  name: string;
  color: string;
  mark: string;
  ticker: string;
  uid: string | null;
  figi: string | null;
  classCode?: string;
  exchange?: string;
  realExchange?: string;
  currency: string;
  step: number | null;
  brand?: InstrumentBrand | null;
  type?: "index" | "future" | "currency" | "crypto" | "tokenized-stock" | undefined;
  comparisonBasis?: "exchange-day" | "rolling-24h";
  expirationDate?: string | null;
  first1minCandleDate?: string | undefined;
  first1dayCandleDate?: string | undefined;
  firstTradeDate?: string | undefined;
  price: number | null;
  previousClose: number | null;
  previousCloseDay?: string | null;
  previousCloseSource?: "evening" | "exchange-day" | null;
  closeTime?: string | null | undefined;
  time?: string | null;
  change?: number | null;
  changePercent?: number | null;
  availability: "pending" | "available" | "unavailable";
  note?: string | null;
}
export type IndicatorKey = "ma" | "ema" | "volume" | "mtp160" | "mtp440" | "mtp640" | "mtpAll";
export type MtpKey = Extract<IndicatorKey, `mtp${string}`>;
export type IndicatorFlags = Record<Exclude<IndicatorKey, "mtpAll">, boolean> & {
  mtpAll?: boolean;
};
export interface IndicatorStyle {
  opacity?: number;
  color: string;
  width: number;
}
export type IndicatorOptions = Partial<Record<IndicatorKey, IndicatorStyle>>;
export type ChartEngine = "kline" | "tradingview";
export interface DrawingPoint {
  timestamp: number;
  value: number;
}
export interface PixelPoint {
  x: number;
  y: number;
}
export type DrawingTool =
  | "segment"
  | "rayLine"
  | "straightLine"
  | "horizontalStraightLine"
  | "horizontalRayLine"
  | "verticalStraightLine"
  | "rectangle"
  | "fibonacciLine"
  | "fibonacciExtension";
export type LineStyle = "solid" | "dashed" | "dotted";
export interface FibLevelStyle {
  value: number;
  enabled: boolean;
  color: string;
  text?: string;
}
export interface DrawingSettings {
  color?: string;
  width?: number;
  lineStyle?: LineStyle;
  lineOpacity?: number;
  trendLine?: boolean;
  trendColor?: string;
  trendWidth?: number;
  trendStyle?: LineStyle;
  trendOpacity?: number;
  fill?: boolean;
  opacity?: number;
  extendLeft?: boolean;
  extendRight?: boolean;
  reverse?: boolean;
  labels?: boolean;
  prices?: boolean;
  levels?: number[];
  labelSide?: "left" | "center" | "right";
  labelVertical?: "top" | "middle" | "bottom";
  labelFormat?: "value" | "percent";
  fontSize?: number;
  textEnabled?: boolean;
  text?: string;
  textColor?: string | undefined;
  textAlign?: "left" | "center" | "right";
  textVertical?: "top" | "center" | "bottom";
  levelStyles?: FibLevelStyle[];
  oneColor?: boolean;
  extend?: "none" | "left" | "right" | "both";
}
export interface VisibilityRule {
  enabled: boolean;
  from: number;
  to: number;
}
export type DrawingVisibility = Partial<
  Record<"minutes" | "hours" | "days" | "weeks", VisibilityRule>
>;
export interface DrawingBase {
  id: string;
  settings?: DrawingSettings;
  title?: string;
  visible?: boolean;
  lock?: boolean;
  layer?: "front" | "back";
  visibility?: DrawingVisibility;
}
export type DrawingShape =
  | {
      name: "horizontalStraightLine" | "horizontalRayLine" | "verticalStraightLine";
      points: [DrawingPoint];
    }
  | {
      name: "segment" | "rayLine" | "straightLine" | "rectangle" | "fibonacciLine";
      points: [DrawingPoint, DrawingPoint];
    }
  | {
      name: "fibonacciExtension";
      points: [DrawingPoint, DrawingPoint, DrawingPoint];
    };
export type Drawing = DrawingBase & DrawingShape;
export type BackupDrawing = Omit<DrawingBase, "id"> & { id?: string } & DrawingShape;
export interface DrawingDraft extends DrawingBase {
  name: DrawingTool;
  points: DrawingPoint[];
}
export interface DrawingTemplate {
  settings: DrawingSettings;
  visibility?: DrawingVisibility;
}
export interface VolumeAverageSettings {
  enabled: boolean;
  period: number;
}
export interface PriceAxisLabelColors {
  fill?: string;
  text?: string;
}
export interface PriceAxisLabelPalette {
  lastPrice?: PriceAxisLabelColors;
  drawings?: PriceAxisLabelColors;
}
export type PriceAxisLabelThemes = Partial<Record<"light" | "dark", PriceAxisLabelPalette>>;
export interface ChartSettings {
  legendCollapsed?: boolean;
  mtpMenuCollapsed?: boolean;
  mtpAllHidden?: boolean;
  theme?: "dark" | "light";
  drawingTools?: DrawingToolbarSettings;
  removedIndicators?: IndicatorKey[];
  showCandleCountdown?: boolean;
  bodyVisible?: boolean;
  wickUpColor?: string;
  wickDownColor?: string;
  borderUpColor?: string;
  borderDownColor?: string;
  borderVisible?: boolean;
  wickVisible?: boolean;
  candlePaletteVersion?: number;
  grid?: boolean;
  upColor?: string;
  downColor?: string;
  background?: string;
  scaleFontSize?: number;
  showLegend?: boolean;
  priceLine?: boolean;
  lastPriceColor?: string;
  priceAxisLabels?: PriceAxisLabelThemes;
  indicatorOptions?: IndicatorOptions;
  volumeAverage?: VolumeAverageSettings;
  drawingTemplates?: Record<string, DrawingTemplate>;
}
export interface IndicatorPaneLayout {
  volume?: { heightRatio: number };
}
export interface ProfilePreferences extends DisplayPreferences {
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
  symbol?: string;
  instrumentUid?: string | null;
  timeframe?: Timeframe;
  engine?: ChartEngine;
  indicators?: Partial<IndicatorFlags>;
  rangeDays?: number;
  chartSettings?: ChartSettings;
}
export type Preferences = ProfilePreferences;
export interface ChartCamera {
  barSpace: number;
  rightOffsetBars: number;
}
export interface ChartView {
  camera?: ChartCamera;
  /** Visible candle boundaries in Unix seconds, shared by both chart engines. */
  from?: number;
  to?: number;
  barSpace?: number;
  offsetRight?: number;
  anchor?: { timestamp: number; xFraction: number };
}
export interface ImageAsset {
  syncId?: string;
  id: string;
  owner: string;
  symbol: string;
  name: string;
  blob: Blob;
  point: DrawingPoint;
  width: number;
  createdAt?: number;
  zOrder?: number;
  lock?: boolean;
  visible?: boolean;
}
export interface HistoryRecord {
  id: string;
  owner: string;
  uid: string;
  timeframe: Timeframe;
  day: string;
  data: ArrayBuffer;
  updatedAt?: number;
}
export interface BackupImage {
  lock?: boolean;
  visible?: boolean;
  zOrder?: number;
  id?: string;
  symbol: string;
  name?: string;
  type: string;
  point: DrawingPoint;
  width: number;
  data: string;
}
export interface BackupHistory {
  uid: string;
  timeframe: Timeframe;
  day: string;
  data: string;
}
export type BackupMarketRow = Pick<MarketRow, "symbol" | "name"> & {
  uid: string | null;
} & Partial<Omit<MarketRow, "symbol" | "name" | "uid">>;
export interface Backup {
  application: "personal-terminal";
  schemaVersion: 1 | 2;
  requiredProviders?: ["okx"];
  exportedAt?: string;
  layout?: ProfilePreferences;
  watchlist?: BackupMarketRow[];
  drawings: { symbol: string; items: BackupDrawing[] }[];
  images: BackupImage[];
  views?: { key: string; value: ChartView }[];
  history?: BackupHistory[];
}
