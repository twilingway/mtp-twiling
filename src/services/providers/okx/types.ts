export type OkxCategory = "spot" | "linear";
export interface OkxProviderRef {
  readonly provider: "okx";
  readonly category: OkxCategory;
  readonly symbol: string;
}

export interface OkxInstrument {
  ref: OkxProviderRef;
  baseCoin: string;
  quoteCoin: string;
  settleCoin: string | null;
  tickSize: number | null;
  launchTime: number | null;
}

export interface OkxQuote {
  ref: OkxProviderRef;
  seriesId: string;
  timestamp: number;
  lastPrice: number | null;
  previousPrice24h: number | null;
  changePercent24h: number | null;
}

export interface OkxCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  baseVolume: number;
  quoteTurnover: number;
  confirmed: boolean;
}

export type OkxErrorKind =
  "forbidden" | "rate-limit" | "network" | "timeout" | "http" | "api" | "protocol" | "pagination";

export class OkxError extends Error {
  constructor(
    public readonly kind: OkxErrorKind,
    message: string,
    public readonly status: number | null = null,
    public readonly apiCode: string | null = null,
    public readonly retryAfter: string | null = null
  ) {
    super(message);
    this.name = "OkxError";
  }
}

export function okxInstrumentType(category: OkxCategory): "SPOT" | "SWAP" {
  if (category === "spot") return "SPOT";
  if (category === "linear") return "SWAP";
  throw new OkxError("protocol", "Invalid OKX instrument category");
}

export function isOkxSymbol(category: OkxCategory, symbol: unknown): symbol is string {
  const native = okxInstrumentType(category);
  const format = native === "SPOT" ? /^[A-Z0-9]+-[A-Z0-9]+$/ : /^[A-Z0-9]+-USDT-SWAP$/;
  return typeof symbol === "string" && symbol.length <= 100 && format.test(symbol);
}

export function okxInstrumentRef(category: OkxCategory, symbol: string): OkxProviderRef {
  if (!isOkxSymbol(category, symbol)) throw new OkxError("protocol", "Invalid OKX instrument ID");
  return { provider: "okx", category, symbol };
}

export function okxSeriesId(ref: OkxProviderRef): string {
  if (ref.provider !== "okx") throw new OkxError("protocol", "Invalid OKX provider");
  okxInstrumentRef(ref.category, ref.symbol);
  return `okx:${ref.category}:${ref.symbol}`;
}

export function okxRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OkxError("protocol", "Expected an OKX record");
  return value as Record<string, unknown>;
}

export function okxDecimal(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function okxPositiveDecimal(value: unknown): number | null {
  const parsed = okxDecimal(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function okxTimestamp(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= 8_640_000_000_000_000
    ? parsed
    : null;
}
