import { searchInstrumentUid } from "./instrument-search-identity.js";
import type { CatalogInstrument } from "./types.js";

export const INSTRUMENT_SEARCH_ORDERS = ["relevance", "ticker", "source"] as const;
export type InstrumentSearchOrder = (typeof INSTRUMENT_SEARCH_ORDERS)[number];

export function instrumentSearchSource(item: CatalogInstrument): string {
  return item.providerRef?.provider === "okx"
    ? "OKX"
    : item.providerRef?.provider === "bybit"
      ? "Bybit"
      : "Т‑Банк";
}

export function instrumentSearchVenue(item: CatalogInstrument): string | undefined {
  if (item.providerRef) return undefined;
  const exchange = item.exchange?.trim();
  const real = item.realExchange?.trim();
  if (exchange === "moex_close") return "MOEX · данные закрытия";
  if (/^dealer(?:$|[_-])/i.test(exchange ?? "") || real === "REAL_EXCHANGE_DEALER")
    return "Дилер · внебиржевой";
  if (/^(moex|forts)(?:$|[_-])/i.test(exchange ?? "") || real === "REAL_EXCHANGE_MOEX")
    return "MOEX";
  if (exchange && !/^(unknown|unspecified)$/i.test(exchange)) return exchange;
  if (real && !/^(?:REAL_EXCHANGE_)?(?:UNKNOWN|UNSPECIFIED)$/i.test(real))
    return real.replace(/^REAL_EXCHANGE_/, "");
  return item.classCode?.toUpperCase() === "TQBR" ? "MOEX" : undefined;
}

const searchText = (value: string) => value.trim().toLocaleLowerCase("ru-RU");

function relevance(ticker: string, name: string, needle: string): number {
  if (ticker === needle) return 0;
  if (ticker.startsWith(needle)) return 1;
  if (ticker.includes(needle)) return 2;
  if (name === needle) return 3;
  if (name.startsWith(needle)) return 4;
  return name.includes(needle) ? 5 : 6;
}

export function sortInstrumentSearch(
  items: readonly CatalogInstrument[],
  query: string,
  order: InstrumentSearchOrder = "relevance",
  locale = "ru"
): CatalogInstrument[] {
  const needle = searchText(query);
  const { compare } = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const ranked = items.map((item) => {
    const expiration = item.expirationDate ? Date.parse(item.expirationDate) : NaN;
    const classCode = item.classCode?.toUpperCase() ?? "";
    return {
      item,
      ticker: searchText(item.ticker),
      classCode,
      primary: !item.providerRef && classCode === "TQBR" ? 0 : 1,
      source: instrumentSearchSource(item),
      venue: instrumentSearchVenue(item) ?? "",
      mode: item.providerRef?.category ?? "",
      expiration: Number.isFinite(expiration) ? expiration : Infinity,
      rank: relevance(searchText(item.ticker), searchText(item.name), needle),
      id: searchInstrumentUid(item) ?? item.figi ?? ""
    };
  });
  return ranked
    .sort((a, b) => {
      const ticker = compare(a.ticker, b.ticker);
      const source = compare(a.source, b.source) || compare(a.venue, b.venue);
      const maturity = a.expiration - b.expiration;
      const rank = a.rank - b.rank;
      const primary = a.primary - b.primary;
      const head =
        order === "source"
          ? source || ticker || primary || rank
          : order === "ticker"
            ? ticker || primary || rank || source
            : rank || primary || maturity || ticker || source;
      return (
        head ||
        compare(a.classCode, b.classCode) ||
        compare(a.mode, b.mode) ||
        maturity ||
        compare(a.id, b.id) ||
        compare(a.item.name, b.item.name)
      );
    })
    .map(({ item }) => item);
}

/** Odd segments are literal matches. React renders them as plain text, including punctuation. */
export function instrumentSearchHighlight(text: string, query: string): string[] {
  const needle = query.trim();
  if (!needle) return [text];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped})`, "iu"));
}
