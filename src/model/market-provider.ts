export interface MarketProviderRef {
  readonly provider: "bybit";
  readonly category: "spot" | "linear";
  readonly symbol: string;
}
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
  return (
    raw.provider === "bybit" &&
    (raw.category === "spot" || raw.category === "linear") &&
    typeof raw.symbol === "string" &&
    /^[A-Z0-9][A-Z0-9_-]{0,99}$/.test(raw.symbol) &&
    Object.keys(raw).every((key) => ["provider", "category", "symbol"].includes(key))
  );
}
export function providerSeriesId(ref: MarketProviderRef): string {
  if (!isProviderRef(ref)) throw new Error("Некорректный источник инструмента.");
  return `bybit:${ref.category}:${ref.symbol}`;
}
export function providerRefFromId(value: unknown): MarketProviderRef | null {
  if (typeof value !== "string") return null;
  const match = /^bybit:(spot|linear):([A-Z0-9][A-Z0-9_-]{0,99})$/.exec(value);
  return match
    ? { provider: "bybit", category: match[1] as "spot" | "linear", symbol: match[2] ?? "" }
    : null;
}
export function isBankIdentity(value: {
  providerRef?: unknown;
  uid?: unknown;
  symbol?: unknown;
}): boolean {
  return (
    value.providerRef === undefined &&
    !(typeof value.uid === "string" && value.uid.startsWith("bybit:")) &&
    !(typeof value.symbol === "string" && value.symbol.startsWith("bybit:"))
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
