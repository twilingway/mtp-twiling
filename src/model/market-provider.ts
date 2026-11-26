interface ProviderReference {
  readonly category: "spot" | "linear";
  readonly symbol: string;
}
export interface BybitProviderRef extends ProviderReference {
  readonly provider: "bybit";
}
export interface OkxProviderRef extends ProviderReference {
  readonly provider: "okx";
}
export type MarketProviderRef = BybitProviderRef | OkxProviderRef;
export type MarketAssetClass =
  "crypto" | "stock" | "etf" | "forex" | "commodity" | "tokenized-stock" | "unknown";
export interface ProviderAttributes {
  nativePriceStep?: number;
  providerRef?: MarketProviderRef;
  assetClass?: MarketAssetClass;
  productKind?: "spot" | "perpetual" | "future";
  baseCoin?: string;
  quoteCoin?: string;
  settleCoin?: string;
  marketRegion?: string;
  underlyingTicker?: string;
  symbolType?: string;
}
export function isProviderRef(value: unknown): value is MarketProviderRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (
    (raw.category !== "spot" && raw.category !== "linear") ||
    typeof raw.symbol !== "string" ||
    !Object.keys(raw).every((key) => ["provider", "category", "symbol"].includes(key))
  )
    return false;
  if (raw.provider === "bybit") return /^[A-Z0-9][A-Z0-9_-]{0,99}$/.test(raw.symbol);
  if (raw.provider !== "okx" || `okx:${raw.category}:${raw.symbol}`.length > 100) return false;
  return raw.category === "spot"
    ? /^[A-Z0-9]+-[A-Z0-9]+$/.test(raw.symbol)
    : /^[A-Z0-9]+-USDT-SWAP$/.test(raw.symbol);
}
export function isMarketProvider(value: unknown): value is MarketProviderRef["provider"] {
  return value === "bybit" || value === "okx";
}
/** Keep even malformed public IDs out of bank transport and legacy storage. */
export function isReservedProviderId(value: unknown): boolean {
  return typeof value === "string" && /^(?:bybit|okx):/i.test(value.trimStart());
}
export function providerSeriesId(ref: MarketProviderRef): string {
  if (!isProviderRef(ref)) throw new Error("Некорректный источник инструмента.");
  return `${ref.provider}:${ref.category}:${ref.symbol}`;
}
export function providerRefFromId(value: unknown): MarketProviderRef | null {
  if (typeof value !== "string") return null;
  const match = /^(bybit|okx):(spot|linear):([^:]+)$/.exec(value);
  if (!match) return null;
  const ref = { provider: match[1], category: match[2], symbol: match[3] };
  return isProviderRef(ref) ? ref : null;
}
export function providerRefFromViewKey(value: unknown): MarketProviderRef | null {
  return typeof value === "string"
    ? providerRefFromId(value.split(":").slice(0, -3).join(":"))
    : null;
}
export function isBankIdentity(value: {
  providerRef?: unknown;
  uid?: unknown;
  symbol?: unknown;
}): boolean {
  return (
    value.providerRef === undefined &&
    !isReservedProviderId(value.uid) &&
    !isReservedProviderId(value.symbol)
  );
}
export function validProviderIdentity(value: {
  providerRef?: unknown;
  uid?: unknown;
  symbol?: unknown;
}): boolean {
  if (value.providerRef === undefined) return isBankIdentity(value);
  return (
    isProviderRef(value.providerRef) &&
    value.uid === providerSeriesId(value.providerRef) &&
    (value.symbol === undefined || value.symbol === value.uid)
  );
}
export function isMarketAssetClass(value: unknown): value is MarketAssetClass {
  return (
    typeof value === "string" &&
    ["crypto", "stock", "etf", "forex", "commodity", "tokenized-stock", "unknown"].includes(value)
  );
}
export function providerAttributes(value: Record<string, unknown>): ProviderAttributes {
  const result: ProviderAttributes = {};
  if (
    typeof value.nativePriceStep === "number" &&
    Number.isFinite(value.nativePriceStep) &&
    value.nativePriceStep > 0
  )
    result.nativePriceStep = value.nativePriceStep;
  if (isProviderRef(value.providerRef)) result.providerRef = { ...value.providerRef };
  if (isMarketAssetClass(value.assetClass)) result.assetClass = value.assetClass;
  if (
    value.productKind === "spot" ||
    value.productKind === "perpetual" ||
    value.productKind === "future"
  )
    result.productKind = value.productKind;
  for (const key of [
    "baseCoin",
    "quoteCoin",
    "settleCoin",
    "marketRegion",
    "underlyingTicker",
    "symbolType"
  ] as const)
    if (typeof value[key] === "string") result[key] = value[key];
  return result;
}
