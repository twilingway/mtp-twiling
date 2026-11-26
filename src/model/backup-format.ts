import { TOOL_NAMES } from "./drawing-model.js";
import { isInstrumentSymbol, isInstrumentViewKey } from "./instrument-symbol.js";
import { validBackupProviders, validLayoutProvider, validRowProvider } from "./backup-provider.js";
import { isProviderRef, isMarketAssetClass } from "./market-provider.js";
import { isLocale, isTimeZone } from "../i18n/preferences.js";
import { isDrawingToolbarSettings } from "./drawing-toolbar.js";
import { isNativeIntervalId } from "./intervals/registry.js";
import { isIntervalFavorites } from "./intervals/favorites.js";
import { isIndicatorPaneLayout } from "./indicator-layout.js";
import { isWatchlistFlags, isWatchlistFlagFilter } from "./watchlist-flags.js";
import { isWatchlistSections, validWatchlistSectionsField } from "./watchlist-sections.js";
import { isTechnicalIndicatorInstanceList } from "./technical-indicators/instances.js";
import { isTechnicalPaneLayout } from "./technical-indicator-layout.js";
import { isVolumeAveragePeriod } from "./volume-average.js";
import type {
  Backup,
  BackupDrawing,
  BackupHistory,
  BackupImage,
  BackupMarketRow,
  ChartSettings,
  ChartView,
  Drawing,
  DrawingPoint,
  DrawingSettings,
  DrawingVisibility,
  FibLevelStyle,
  ProfilePreferences,
  Timeframe
} from "./types.js";

type Validator = (value: unknown) => boolean;
type UnknownRecord = Record<string, unknown>;
const colorPattern = /^#[0-9a-f]{6}$/i;
const forbidden = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "token",
  "apiToken",
  "authorization",
  "vault"
]);
export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const string = (value: unknown): value is string => typeof value === "string";
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const color = (value: unknown): boolean => string(value) && colorPattern.test(value);
const nullable =
  (check: Validator): Validator =>
  (value) =>
    value === null || check(value);
const numberBetween =
  (from: number, to: number): Validator =>
  (value) =>
    finite(value) && value >= from && value <= to;
const member =
  (values: readonly unknown[]): Validator =>
  (value) =>
    values.includes(value);
const list =
  (check: Validator, max = Infinity): Validator =>
  (value) =>
    Array.isArray(value) && value.length <= max && value.every(check);
function fields(value: UnknownRecord, checks: Record<string, Validator>): boolean {
  return Object.entries(checks).every(
    ([key, check]) => value[key] === undefined || check(value[key])
  );
}
function plain(value: unknown, depth = 0): void {
  if (depth > 30) throw new Error("Слишком сложный файл.");
  if (value && typeof value === "object")
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (forbidden.has(key)) throw new Error("Файл содержит запрещённые поля.");
      if (!("value" in descriptor)) throw new Error("Файл содержит вычисляемые поля.");
      plain(descriptor.value, depth + 1);
    }
}
export function isTimeframe(value: unknown): value is Timeframe {
  return isNativeIntervalId(value);
}
export function isDrawingPoint(value: unknown): value is DrawingPoint {
  return isRecord(value) && finite(value.timestamp) && value.timestamp >= 0 && finite(value.value);
}
function isFibLevel(value: unknown): value is FibLevelStyle {
  return (
    isRecord(value) &&
    finite(value.value) &&
    Math.abs(value.value) <= 100 &&
    boolean(value.enabled) &&
    color(value.color) &&
    fields(value, { text: string })
  );
}
const lineStyle = member(["solid", "dashed", "dotted"]);
export function isDrawingSettings(value: unknown): value is DrawingSettings {
  return (
    isRecord(value) &&
    fields(value, {
      color,
      width: numberBetween(1, 5),
      lineStyle,
      lineOpacity: numberBetween(0, 1),
      trendLine: boolean,
      trendColor: color,
      trendWidth: numberBetween(1, 5),
      trendStyle: lineStyle,
      trendOpacity: numberBetween(0, 1),
      fill: boolean,
      opacity: numberBetween(0, 1),
      extendLeft: boolean,
      extendRight: boolean,
      reverse: boolean,
      labels: boolean,
      prices: boolean,
      levels: list((value) => finite(value) && Math.abs(value) <= 100, 40),
      labelSide: member(["left", "center", "right"]),
      labelVertical: member(["top", "middle", "bottom"]),
      labelFormat: member(["value", "percent"]),
      fontSize: numberBetween(1, 100),
      textEnabled: boolean,
      text: string,
      textColor: color,
      textAlign: member(["left", "center", "right"]),
      textVertical: member(["top", "center", "bottom"]),
      levelStyles: list(isFibLevel, 40),
      oneColor: boolean,
      extend: member(["none", "left", "right", "both"])
    })
  );
}
export function isDrawingVisibility(value: unknown): value is DrawingVisibility {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, rule]) =>
        ["minutes", "hours", "days", "weeks"].includes(key) &&
        isRecord(rule) &&
        boolean(rule.enabled) &&
        finite(rule.from) &&
        finite(rule.to) &&
        rule.from >= 1 &&
        rule.from <= rule.to
    )
  );
}
export function isBackupDrawing(value: unknown): value is BackupDrawing {
  if (
    !isRecord(value) ||
    !string(value.name) ||
    !Object.hasOwn(TOOL_NAMES, value.name) ||
    !Array.isArray(value.points)
  )
    return false;
  const count = ["horizontalStraightLine", "horizontalRayLine", "verticalStraightLine"].includes(
    value.name
  )
    ? 1
    : value.name === "fibonacciExtension"
      ? 3
      : 2;
  return (
    value.points.length === count &&
    value.points.every(isDrawingPoint) &&
    fields(value, {
      id: string,
      settings: isDrawingSettings,
      title: string,
      visible: boolean,
      lock: boolean,
      layer: member(["front", "back"]),
      visibility: isDrawingVisibility
    })
  );
}
export function isDrawing(value: unknown): value is Drawing {
  return isBackupDrawing(value) && typeof value.id === "string";
}
function isIndicatorOptions(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, style]) =>
        ["ma", "ema", "volume", "mtp160", "mtp440", "mtp640", "mtpAll"].includes(key) &&
        isRecord(style) &&
        color(style.color) &&
        numberBetween(1, 5)(style.width) &&
        fields(style, { opacity: numberBetween(0, 1) })
    )
  );
}
export function isChartSettings(value: unknown): value is ChartSettings {
  return (
    isRecord(value) &&
    fields(value, {
      theme: member(["dark", "light"]),
      drawingTools: isDrawingToolbarSettings,
      removedIndicators: (value) =>
        Array.isArray(value) &&
        value.length <= 7 &&
        value.every(member(["ma", "ema", "volume", "mtp160", "mtp440", "mtp640", "mtpAll"])),
      grid: boolean,
      upColor: color,
      downColor: color,
      wickUpColor: color,
      wickDownColor: color,
      borderUpColor: color,
      borderDownColor: color,
      borderVisible: boolean,
      bodyVisible: boolean,
      wickVisible: boolean,
      candlePaletteVersion: numberBetween(1, 1),
      background: color,
      scaleFontSize: numberBetween(1, 100),
      showLegend: boolean,
      ohlcDisplay: member(["candle", "corner", "icon", "hidden"]),
      ohlcOnHold: boolean,
      legendCollapsed: boolean,
      mtpMenuCollapsed: boolean,
      priceLine: boolean,
      lastPriceColor: color,
      showCandleCountdown: boolean,
      indicatorOptions: isIndicatorOptions,
      volumeAverage: (value) =>
        isRecord(value) && boolean(value.enabled) && isVolumeAveragePeriod(value.period),
      drawingTemplates: (value) =>
        isRecord(value) &&
        Object.values(value).every(
          (template) =>
            isRecord(template) &&
            isDrawingSettings(template.settings) &&
            fields(template, { visibility: isDrawingVisibility })
        )
    })
  );
}
export function isProfilePreferences(value: unknown): value is ProfilePreferences {
  return (
    isRecord(value) &&
    validWatchlistSectionsField(value) &&
    validLayoutProvider(value) &&
    fields(value, {
      technicalIndicators: isTechnicalIndicatorInstanceList,
      technicalPaneLayout: isTechnicalPaneLayout,
      providerRef: isProviderRef,
      watchlistFlags: isWatchlistFlags,
      watchlistSections: isWatchlistSections,
      watchlistFlagFilter: isWatchlistFlagFilter,
      locale: isLocale,
      timeZone: isTimeZone,
      rightPanelCollapsed: boolean,
      rightPanelTab: member(["watchlist", "objects"]),
      symbol: isInstrumentSymbol,
      instrumentUid: nullable((value) => string(value) && value.length > 0 && value.length <= 200),
      timeframe: isTimeframe,
      favoriteIntervals: isIntervalFavorites,
      indicatorPaneLayout: isIndicatorPaneLayout,
      engine: member(["kline", "tradingview"]),
      rangeDays: numberBetween(1, 3650),
      sidebarWidth: numberBetween(240, 720),
      rightDetailsHeightRatio: numberBetween(0.15, 0.85),
      chartSettings: isChartSettings,
      indicators: (value) =>
        isRecord(value) &&
        fields(value, {
          ma: boolean,
          ema: boolean,
          volume: boolean,
          mtp160: boolean,
          mtp440: boolean,
          mtp640: boolean,
          mtpAll: boolean
        })
    })
  );
}
export function isChartView(value: unknown): value is ChartView {
  return (
    isRecord(value) &&
    fields(value, {
      camera: (value) =>
        isRecord(value) &&
        finite(value.barSpace) &&
        value.barSpace > 0 &&
        finite(value.rightOffsetBars),
      from: finite,
      to: finite,
      barSpace: finite,
      offsetRight: finite,
      anchor: (value) => isRecord(value) && finite(value.timestamp) && finite(value.xFraction)
    })
  );
}
function isBackupMarketRow(value: unknown): value is BackupMarketRow {
  return (
    isRecord(value) &&
    validRowProvider(value) &&
    (value.uid === null || (string(value.uid) && value.uid.length <= 200)) &&
    isInstrumentSymbol(value.symbol) &&
    string(value.name) &&
    value.name.length <= 300 &&
    fields(value, {
      providerRef: isProviderRef,
      assetClass: isMarketAssetClass,
      nativePriceStep: (value) => finite(value) && value > 0,
      productKind: member(["spot", "perpetual", "future"]),
      baseCoin: string,
      quoteCoin: string,
      settleCoin: string,
      marketRegion: string,
      underlyingTicker: string,
      symbolType: string,
      comparisonBasis: member(["exchange-day", "rolling-24h"]),
      color: string,
      mark: string,
      ticker: string,
      figi: nullable(string),
      classCode: string,
      exchange: string,
      realExchange: string,
      currency: string,
      step: nullable(finite),
      brand: nullable(
        (value) =>
          isRecord(value) &&
          fields(value, {
            logoName: string,
            logoBaseColor: string,
            textColor: string
          })
      ),
      type: member(["index", "future", "currency", "crypto", "tokenized-stock"]),
      expirationDate: nullable(string),
      first1minCandleDate: string,
      first1dayCandleDate: string,
      firstTradeDate: string,
      price: nullable(finite),
      previousClose: nullable(finite),
      previousCloseDay: nullable(string),
      previousCloseSource: nullable(member(["evening", "exchange-day"])),
      closeTime: nullable(string),
      time: nullable(string),
      change: nullable(finite),
      changePercent: nullable(finite),
      availability: member(["pending", "available", "unavailable"]),
      note: nullable(string)
    })
  );
}
function isBackupImage(value: unknown): value is BackupImage {
  return (
    isRecord(value) &&
    isInstrumentSymbol(value.symbol) &&
    member(["image/png", "image/jpeg", "image/webp", "image/gif"])(value.type) &&
    string(value.data) &&
    value.data.length <= 28 * 1024 * 1024 &&
    numberBetween(10, 2000)(value.width) &&
    isDrawingPoint(value.point) &&
    fields(value, { id: string, name: string, lock: boolean, visible: boolean, zOrder: finite })
  );
}
function isBackupHistory(value: unknown): value is BackupHistory {
  return (
    isRecord(value) &&
    string(value.uid) &&
    isTimeframe(value.timeframe) &&
    string(value.day) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.day) &&
    string(value.data)
  );
}
function isBackup(value: unknown): value is Backup {
  return (
    isRecord(value) &&
    value.application === "personal-terminal" &&
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    validBackupProviders(value) &&
    list(
      (document) =>
        isRecord(document) &&
        isInstrumentSymbol(document.symbol) &&
        list(isBackupDrawing, 10000)(document.items),
      10000
    )(value.drawings) &&
    list(isBackupImage, 1000)(value.images) &&
    fields(value, {
      exportedAt: string,
      requiredProviders: (value) =>
        Array.isArray(value) && value.length === 1 && value[0] === "okx",
      layout: isProfilePreferences,
      watchlist: list(isBackupMarketRow, 300),
      history: list(isBackupHistory),
      views: list(
        (view) => isRecord(view) && isInstrumentViewKey(view.key) && isChartView(view.value)
      )
    })
  );
}
export function validateBackup(input: unknown): Backup {
  if (
    !isRecord(input) ||
    input.application !== "personal-terminal" ||
    (input.schemaVersion !== 1 && input.schemaVersion !== 2)
  )
    throw new Error("Это не поддерживаемый файл настроек терминала.");
  plain(input);
  if (!isBackup(input)) throw new Error("Некорректная структура или настройки файла.");
  return input;
}
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let value = "";
  for (let i = 0; i < bytes.length; i += 32768)
    value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
export function fromBase64(value: string): ArrayBuffer {
  const text = atob(value),
    bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
