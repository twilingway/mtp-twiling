import { searchCatalog } from "./providers/bybit/index.js";
import type { BybitCatalog, BybitInstrument } from "./providers/bybit/types.js";
import type { OkxInstrument } from "./providers/okx/types.js";
import { providerSeriesId } from "../model/market-provider.js";
import type { OkxProviderRef } from "../model/market-provider.js";
import type {
  CatalogInstrument,
  InstrumentKind,
  InstrumentSearchKind,
  MarketRow
} from "../model/types.js";

export interface PublicQuote {
  seriesId: string;
  timestamp: number;
  lastPrice: number | null;
  previousPrice24h: number | null;
  changePercent24h: number | null;
}

export function publicSearchKey(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s/_:-]+/g, "");
}

export function okxMatches(item: OkxInstrument, query: string): boolean {
  return [item.ref.symbol, item.baseCoin, item.quoteCoin].some((part) =>
    publicSearchKey(part).includes(query)
  );
}

export function marketTuple(item: BybitInstrument | OkxInstrument): string {
  return JSON.stringify([
    item.ref.category,
    item.baseCoin.toUpperCase(),
    item.quoteCoin.toUpperCase(),
    item.settleCoin?.toUpperCase() ?? null
  ]);
}

export function okxRefs(rows: readonly MarketRow[]): OkxProviderRef[] {
  return rows.flatMap((row) => (row.providerRef?.provider === "okx" ? [row.providerRef] : []));
}

export function supportedBybitInstrument(item: BybitInstrument): boolean {
  return (
    item.status === "Trading" &&
    (item.ref.category === "spot" ||
      (item.contractType === "LinearPerpetual" && item.settleCoin === "USDT"))
  );
}

export function knownBybitMarkets(catalog: BybitCatalog): Set<string> {
  const categories = new Set(catalog.instruments.map((item) => item.ref.category));
  if (!catalog.complete || !categories.has("spot") || !categories.has("linear"))
    throw new Error("Полный каталог Bybit не подтверждён.");
  return new Set(catalog.instruments.filter(supportedBybitInstrument).map(marketTuple));
}

export function searchBybit(catalog: BybitCatalog, query: string, kind: InstrumentSearchKind) {
  return searchCatalog(catalog, query, { cryptoOnly: false, limit: 300 })
    .filter((item) => supportedBybitInstrument(item) && item.assetClass !== "unknown")
    .map(publicCatalogInstrument)
    .filter((item) => kind === "all" || item.kind === kind);
}

export function publicCatalogInstrument(item: BybitInstrument): CatalogInstrument {
  const kind: InstrumentKind =
    item.assetClass === "crypto"
      ? "crypto"
      : item.assetClass === "tokenized-stock"
        ? "tokenized-stock"
        : "future";
  const label =
    item.assetClass === "tokenized-stock"
      ? "токенизированная акция"
      : item.ref.category === "spot"
        ? "спот"
        : item.assetClass === "stock" || item.assetClass === "etf"
          ? "контракт на акцию/ETF"
          : "бессрочный USDT-контракт";
  return {
    uid: item.seriesId,
    providerRef: item.ref,
    ticker: item.ref.symbol,
    name: `${item.fullName ?? item.baseCoin} · ${label}`,
    kind,
    currency: item.quoteCoin,
    exchange: "Bybit",
    assetClass: item.assetClass,
    productKind: item.ref.category === "spot" ? "spot" : "perpetual",
    baseCoin: item.baseCoin,
    quoteCoin: item.quoteCoin,
    ...(item.settleCoin ? { settleCoin: item.settleCoin } : {}),
    ...(item.marketRegion ? { marketRegion: item.marketRegion } : {}),
    ...(item.underlyingTicker ? { underlyingTicker: item.underlyingTicker } : {}),
    symbolType: item.symbolType,
    ...(item.tickSize !== null ? { nativePriceStep: item.tickSize } : {}),
    ...(item.launchTime ? { firstTradeDate: new Date(item.launchTime).toISOString() } : {})
  };
}
export function okxCatalogInstrument(item: OkxInstrument): CatalogInstrument {
  const spot = item.ref.category === "spot";
  return {
    uid: providerSeriesId(item.ref),
    providerRef: item.ref,
    ticker: item.ref.symbol,
    name: `${item.baseCoin} · ${spot ? "спот" : "бессрочный USDT-контракт"}`,
    kind: "crypto",
    currency: item.quoteCoin,
    exchange: "OKX",
    assetClass: "crypto",
    productKind: spot ? "spot" : "perpetual",
    baseCoin: item.baseCoin,
    quoteCoin: item.quoteCoin,
    ...(item.settleCoin ? { settleCoin: item.settleCoin } : {}),
    ...(item.tickSize !== null ? { nativePriceStep: item.tickSize } : {}),
    ...(item.launchTime !== null ? { firstTradeDate: new Date(item.launchTime).toISOString() } : {})
  };
}
export function publicMarketRow(item: CatalogInstrument): MarketRow {
  if (!item.providerRef || !item.uid) throw new Error("Публичный инструмент не имеет источника.");
  const increment = item.minPriceIncrement;
  const step =
    item.nativePriceStep ??
    (increment ? Number(increment.units) + Number(increment.nano ?? 0) / 1e9 : null);
  return {
    ...item,
    symbol: item.uid,
    ticker: item.ticker,
    uid: item.uid,
    figi: null,
    name: item.name,
    color: "#f5a623",
    mark: item.baseCoin?.slice(0, 1) ?? item.ticker.slice(0, 1),
    currency: item.currency ?? "USDT",
    step,
    type:
      item.kind === "tokenized-stock"
        ? "tokenized-stock"
        : item.kind === "crypto"
          ? "crypto"
          : "future",
    comparisonBasis: "rolling-24h",
    price: null,
    previousClose: null,
    change: null,
    changePercent: null,
    availability: "pending"
  };
}
export function applyPublicQuote(row: MarketRow, quote: PublicQuote): boolean {
  if (row.uid !== quote.seriesId || !row.providerRef) return false;
  if (row.providerRef.provider === "okx" && quote.timestamp < Date.parse(row.time ?? ""))
    return false;
  row.price = quote.lastPrice;
  row.previousClose = null;
  delete row.previousCloseSource;
  delete row.previousCloseDay;
  row.change =
    quote.lastPrice !== null && quote.previousPrice24h !== null
      ? quote.lastPrice - quote.previousPrice24h
      : null;
  row.changePercent = quote.changePercent24h;
  row.comparisonBasis = "rolling-24h";
  row.time = new Date(quote.timestamp).toISOString();
  row.availability = quote.lastPrice === null ? "pending" : "available";
  return true;
}
