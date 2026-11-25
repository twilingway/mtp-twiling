import type { CatalogInstrument, InstrumentKind } from "./types.js";

const compact = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/[\s/_-]+/g, "");
const currencyAliases: readonly {
  queries: readonly string[];
  tickers: readonly string[];
  fallback: string;
}[] = [
  {
    queries: ["usdrubtom", "usdrub", "usd000utstom", "долларрубль", "долларсшарубль"],
    tickers: ["usd000utstom", "usdrub"],
    fallback: "USD000UTSTOM"
  },
  {
    queries: ["eurrubtom", "eurrub", "еврорубль"],
    tickers: ["eurrubtom", "eurrub"],
    fallback: "EUR_RUB__TOM"
  }
];
const alias = (query: string) =>
  currencyAliases.find((item) => item.queries.includes(compact(query)));

/** Aliases affect lookup only; never write them into ticker, symbol, UID or history keys. */
export function matchesCurrencyAlias(item: CatalogInstrument, query: string): boolean {
  return item.kind === "currency" && !!alias(query)?.tickers.includes(compact(item.ticker));
}
export function currencyFallbackQuery(query: string): string {
  return alias(query)?.fallback ?? query.trim();
}
export function catalogInstrumentKind(item: CatalogInstrument): InstrumentKind {
  if (item.kind) return item.kind;
  if (item.instrumentType === "currency" || item.instrumentKind === "INSTRUMENT_TYPE_CURRENCY")
    return "currency";
  if (
    item.instrumentType === "futures" ||
    item.instrumentType === "future" ||
    item.instrumentKind === "INSTRUMENT_TYPE_FUTURES"
  )
    return "future";
  if (item.instrumentType === "share" || item.instrumentKind === "INSTRUMENT_TYPE_SHARE")
    return "share";
  return "index";
}
