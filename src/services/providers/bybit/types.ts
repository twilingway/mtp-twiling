export type BybitCategory = "spot" | "linear";
export interface InstrumentRef {
  readonly provider: "bybit";
  readonly category: BybitCategory;
  readonly symbol: string;
}
export type AssetClass =
  "crypto" | "stock" | "etf" | "forex" | "commodity" | "tokenized-stock" | "unknown";
export interface BybitInstrument {
  ref: InstrumentRef;
  seriesId: string;
  displayTicker: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin: string | null;
  fullName: string | null;
  symbolType: string;
  contractType: string | null;
  status: string;
  assetClass: AssetClass;
  cryptoEligible: boolean;
  marketRegion: string | null;
  underlyingTicker: string | null;
  tickSize: number | null;
  quantityStep: number | null;
  launchTime: number | null;
  xstockMultiplier: number | null;
}
export interface BybitCatalog {
  complete: true;
  observedAt: number;
  instruments: readonly BybitInstrument[];
}
export interface BybitCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  baseVolume: number;
  quoteTurnover: number;
  /** REST cannot prove whether the latest returned candle is closed. */
  confirmed: boolean | null;
}
export interface BybitQuote {
  ref: InstrumentRef;
  seriesId: string;
  timestamp: number;
  lastPrice: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  previousPrice24h: number | null;
  changePercent24h: number | null;
  comparisonBasis: "rolling-24h";
  baseVolume24h: number | null;
  quoteTurnover24h: number | null;
}
export type BybitErrorKind =
  "forbidden" | "rate-limit" | "network" | "timeout" | "http" | "api" | "protocol" | "pagination";
export class BybitError extends Error {
  constructor(
    public readonly kind: BybitErrorKind,
    message: string,
    public readonly status: number | null = null,
    public readonly apiCode: number | null = null,
    public readonly retryAfter: string | null = null
  ) {
    super(message);
    this.name = "BybitError";
  }
}
export function instrumentRef(category: BybitCategory, symbol: string): InstrumentRef {
  if (!["spot", "linear"].includes(category) || !/^[A-Z0-9][A-Z0-9_-]{0,99}$/.test(symbol))
    throw new BybitError("protocol", "Invalid Bybit category or native symbol");
  return { provider: "bybit", category, symbol };
}
export function seriesId(ref: InstrumentRef): string {
  if (ref.provider !== "bybit") throw new BybitError("protocol", "Invalid Bybit provider");
  instrumentRef(ref.category, ref.symbol);
  return `bybit:${ref.category}:${ref.symbol}`;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BybitError("protocol", "Expected Bybit object");
  return value as Record<string, unknown>;
}
export function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value)
    throw new BybitError("protocol", "Expected nonempty Bybit string");
  return value;
}
export function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
/** Prices/quantities are decimal strings, never permissive Number(unknown). */
export function decimal(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function epochMs(value: unknown): number | null {
  const result = typeof value === "number" ? value : decimal(value);
  return result !== null && Number.isSafeInteger(result) && result > 0 ? result : null;
}
