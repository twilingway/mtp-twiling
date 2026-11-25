import type { Catalog, CatalogInstrument, InstrumentSearchKind } from "../model/types.js";
import {
  catalogInstrumentKind,
  currencyFallbackQuery,
  matchesCurrencyAlias
} from "../model/currency-search.js";
import { normaliseInstruments } from "./types.js";

export async function searchCatalog(
  catalog: Catalog | undefined,
  query: string,
  type: InstrumentSearchKind,
  find: (query: string, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
): Promise<CatalogInstrument[]> {
  if (signal?.aborted) return [];
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  if (!needle) return [];
  const values: CatalogInstrument[] = [
    ...(catalog?.shares ?? []).map((item) => ({ ...item, kind: "share" as const })),
    ...(catalog?.futures ?? []).map((item) => ({ ...item, kind: "future" as const })),
    ...(catalog?.indicatives ?? []).map((item) => ({ ...item, kind: "index" as const })),
    ...(catalog?.currencies ?? []).map((item) => ({ ...item, kind: "currency" as const }))
  ];
  const matches = (item: CatalogInstrument) =>
    (type === "all" || item.kind === type) &&
    (`${item.ticker} ${item.name}`.toLocaleLowerCase("ru-RU").includes(needle) ||
      matchesCurrencyAlias(item, query));
  let result = values.filter(
    (item) =>
      matches(item) && (!item.expirationDate || Date.parse(item.expirationDate) > Date.now())
  );
  if (!result.length && needle.length >= 2 && navigator.onLine) {
    const instruments = await find(currencyFallbackQuery(query), signal);
    if (signal?.aborted) return [];
    result = normaliseInstruments(instruments)
      .map((item) => ({
        ...item,
        kind: catalogInstrumentKind(item)
      }))
      .filter(matches);
  }
  return result
    .sort((a, b) => {
      const pa = a.ticker.toLowerCase().startsWith(needle) ? 0 : 1,
        pb = b.ticker.toLowerCase().startsWith(needle) ? 0 : 1;
      return (
        pa - pb ||
        (a.expirationDate && b.expirationDate
          ? Date.parse(a.expirationDate) - Date.parse(b.expirationDate)
          : a.ticker.localeCompare(b.ticker))
      );
    })
    .slice(0, 80);
}
