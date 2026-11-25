import type { BybitInstrument, BybitQuote } from "./providers/bybit/types.js";
import type { CatalogInstrument, InstrumentKind, MarketRow } from "../model/types.js";
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
export function applyPublicQuote(row: MarketRow, quote: BybitQuote): void {
  if (row.uid !== quote.seriesId || !row.providerRef) return;
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
}
