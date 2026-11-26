import type * as Storage from "./storage.js";
import { isNativeIntervalId } from "../model/intervals/registry.js";
import { providerAttributes, validProviderIdentity } from "../model/market-provider.js";
import type {
  Candle,
  Catalog,
  CatalogInstrument,
  HistoryRange,
  HistoryRecord,
  ImageAsset,
  MarketRow,
  Quotation,
  Timeframe
} from "../model/types.js";

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Older local layouts may contain the runtime's empty-selection symbol. */
export function normalizeLocalProfileSelection(value: unknown): unknown {
  const layout = object(value);
  if (
    layout?.symbol !== "" ||
    (layout.instrumentUid !== undefined && layout.instrumentUid !== null) ||
    layout.providerRef !== undefined
  )
    return value;
  const normalized = { ...layout };
  delete normalized.symbol;
  return normalized;
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Неизвестная ошибка.";
}
export function isTimeframe(value: unknown): value is HistoryRecord["timeframe"] {
  return isNativeIntervalId(value);
}
function normaliseQuotation(value: unknown): Quotation | undefined {
  const raw = object(value);
  if (!raw || (typeof raw.units !== "string" && typeof raw.units !== "number")) return undefined;
  return {
    units: raw.units,
    ...(typeof raw.nano === "number" || typeof raw.nano === "string" ? { nano: raw.nano } : {})
  };
}
export function normaliseInstrument(value: unknown): CatalogInstrument | undefined {
  const raw = object(value);
  if (!raw || typeof raw.ticker !== "string" || typeof raw.name !== "string") return undefined;
  if (
    !validProviderIdentity({
      providerRef: raw.providerRef,
      uid: raw.uid ?? raw.instrumentUid,
      symbol: raw.symbol
    })
  )
    return undefined;
  const item: CatalogInstrument = {
    ticker: raw.ticker,
    name: raw.name,
    ...providerAttributes(raw)
  };
  for (const key of [
    "uid",
    "instrumentUid",
    "figi",
    "classCode",
    "exchange",
    "realExchange",
    "currency",
    "expirationDate",
    "first1minCandleDate",
    "first1dayCandleDate",
    "firstTradeDate",
    "instrumentType",
    "instrumentKind"
  ] as const) {
    const value = text(raw[key]);
    if (value !== undefined) item[key] = value;
  }
  if (
    raw.kind === "share" ||
    raw.kind === "future" ||
    raw.kind === "index" ||
    raw.kind === "currency" ||
    raw.kind === "crypto" ||
    raw.kind === "tokenized-stock"
  )
    item.kind = raw.kind;
  const increment = normaliseQuotation(raw.minPriceIncrement);
  if (increment) item.minPriceIncrement = increment;
  const brand = object(raw.brand);
  if (brand) {
    item.brand = {};
    for (const key of ["logoName", "logoBaseColor", "textColor"] as const) {
      const value = text(brand[key]);
      if (value !== undefined) item.brand[key] = value;
    }
  } else if (raw.brand === null) item.brand = null;
  return item;
}
export function normaliseInstruments(value: unknown): CatalogInstrument[] {
  return list(value).flatMap((item) => {
    const instrument = normaliseInstrument(item);
    return instrument ? [instrument] : [];
  });
}
export function normaliseCatalog(value: unknown): Catalog | undefined {
  const raw = object(value);
  if (
    !raw ||
    !finite(raw.at) ||
    !Array.isArray(raw.shares) ||
    !Array.isArray(raw.futures) ||
    !Array.isArray(raw.indicatives)
  )
    return undefined;
  return {
    at: raw.at,
    shares: normaliseInstruments(raw.shares),
    futures: normaliseInstruments(raw.futures),
    indicatives: normaliseInstruments(raw.indicatives),
    ...(Array.isArray(raw.currencies) ? { currencies: normaliseInstruments(raw.currencies) } : {})
  };
}
export function normaliseRows(value: unknown): MarketRow[] {
  return list(value)
    .slice(0, 300)
    .flatMap((value) => {
      const raw = object(value);
      if (!raw || typeof raw.symbol !== "string" || typeof raw.name !== "string") return [];
      if (
        !validProviderIdentity({ providerRef: raw.providerRef, uid: raw.uid, symbol: raw.symbol })
      )
        return [];
      const instrument = normaliseInstrument({ ...raw, ticker: text(raw.ticker) ?? raw.symbol });
      const row: MarketRow = {
        ...providerAttributes(raw),
        symbol: raw.symbol,
        name: raw.name,
        ticker: text(raw.ticker) ?? raw.symbol,
        color: text(raw.color) ?? "#5476bc",
        mark: text(raw.mark) ?? raw.name.slice(0, 1).toUpperCase(),
        uid: text(raw.uid) ?? null,
        figi: text(raw.figi) ?? null,
        currency: text(raw.currency) ?? "rub",
        step: finite(raw.step) ? raw.step : null,
        price: finite(raw.price) ? raw.price : null,
        previousClose: finite(raw.previousClose) ? raw.previousClose : null,
        availability:
          raw.availability === "available" || raw.availability === "unavailable"
            ? raw.availability
            : "pending"
      };
      if (
        raw.type === "future" ||
        raw.type === "index" ||
        raw.type === "currency" ||
        raw.type === "crypto" ||
        raw.type === "tokenized-stock"
      )
        row.type = raw.type;
      if (raw.comparisonBasis === "exchange-day" || raw.comparisonBasis === "rolling-24h")
        row.comparisonBasis = raw.comparisonBasis;
      if (instrument?.brand !== undefined) row.brand = instrument.brand;
      for (const key of [
        "classCode",
        "exchange",
        "realExchange",
        "expirationDate",
        "first1minCandleDate",
        "first1dayCandleDate",
        "firstTradeDate"
      ] as const) {
        const value = text(raw[key]);
        if (value !== undefined) row[key] = value;
      }
      for (const key of ["time", "closeTime", "note", "previousCloseDay"] as const) {
        const value = raw[key];
        if (typeof value === "string" || value === null) row[key] = value;
      }
      if (
        raw.previousCloseSource === "evening" ||
        raw.previousCloseSource === "exchange-day" ||
        raw.previousCloseSource === null
      )
        row.previousCloseSource = raw.previousCloseSource;
      for (const key of ["change", "changePercent"] as const) {
        const value = raw[key];
        if (finite(value) || value === null) row[key] = value;
      }
      return [row];
    });
}
export interface MarketCache {
  rows: MarketRow[];
  at: number;
}
export function normaliseMarket(value: unknown): MarketCache | undefined {
  const raw = object(value);
  return raw && Array.isArray(raw.rows) && finite(raw.at)
    ? { rows: normaliseRows(raw.rows), at: raw.at }
    : undefined;
}
export function normaliseRanges(value: unknown): HistoryRange[] {
  return list(value).flatMap((value) => {
    const raw = object(value);
    return raw && finite(raw.from) && finite(raw.to) && raw.from <= raw.to
      ? [
          {
            from: raw.from,
            to: raw.to,
            ...(finite(raw.fetchedAt) ? { fetchedAt: raw.fetchedAt } : {})
          }
        ]
      : [];
  });
}
export function historyRecord(value: unknown): HistoryRecord | undefined {
  const raw = object(value);
  if (
    !raw ||
    typeof raw.id !== "string" ||
    typeof raw.owner !== "string" ||
    typeof raw.uid !== "string" ||
    !isTimeframe(raw.timeframe) ||
    typeof raw.day !== "string" ||
    !(raw.data instanceof ArrayBuffer)
  )
    return undefined;
  return {
    id: raw.id,
    owner: raw.owner,
    uid: raw.uid,
    timeframe: raw.timeframe,
    day: raw.day,
    data: raw.data,
    ...(finite(raw.updatedAt) ? { updatedAt: raw.updatedAt } : {})
  };
}
export function imageAsset(value: unknown): ImageAsset | undefined {
  const raw = object(value),
    point = object(raw?.point);
  if (
    !raw ||
    typeof raw.id !== "string" ||
    typeof raw.owner !== "string" ||
    typeof raw.symbol !== "string" ||
    !(raw.blob instanceof Blob) ||
    !point ||
    !finite(point.timestamp) ||
    !finite(point.value) ||
    !finite(raw.width)
  )
    return undefined;
  const image: ImageAsset = {
    id: raw.id,
    owner: raw.owner,
    symbol: raw.symbol,
    name: text(raw.name) ?? "",
    blob: raw.blob,
    point: { timestamp: point.timestamp, value: point.value },
    width: raw.width
  };
  if (typeof raw.syncId === "string") image.syncId = raw.syncId;
  for (const key of ["createdAt", "zOrder"] as const) if (finite(raw[key])) image[key] = raw[key];
  for (const key of ["lock", "visible"] as const)
    if (typeof raw[key] === "boolean") image[key] = raw[key];
  return image;
}

export type Cache = Pick<
  typeof Storage,
  | "loadMarket"
  | "saveMarket"
  | "loadCatalog"
  | "saveCatalog"
  | "loadWatchlist"
  | "saveWatchlist"
  | "saveWatchlistSnapshot"
  | "loadHistory"
  | "saveHistory"
  | "loadCoverage"
>;
export type Subscription = { uid: string; timeframe: Timeframe };
export type BankState = "connecting" | "connected" | "error";
export interface BankSnapshot {
  authenticated: boolean;
  accountName: string;
  profileKey: string;
  rows: MarketRow[];
  status: BankState;
  error: string | null;
  updatedAt: string | null;
  transport: "websocket";
}
export interface CandleProgress {
  candles: Candle[];
  cached: boolean;
  completed: number;
  total: number;
}
export interface CandleOptions {
  uid?: string;
  signal?: AbortSignal;
  onProgress?: (progress: CandleProgress) => void;
}
export interface CandleResult {
  symbol: string;
  ticker: string;
  timeframe: Timeframe;
  candles: Candle[];
  source: string;
  cached: boolean;
  requests: number;
}
export interface CandleEvent {
  uid: string;
  interval: string;
  bar: Candle;
}
