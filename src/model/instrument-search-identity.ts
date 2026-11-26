import { providerSeriesId } from "./market-provider.js";
import type { CatalogInstrument, MarketRow } from "./types.js";

export function searchInstrumentUid(item: CatalogInstrument): string | undefined {
  return item.providerRef ? providerSeriesId(item.providerRef) : (item.uid ?? item.instrumentUid);
}

export function searchWatchlistRow(
  rows: readonly MarketRow[],
  item: CatalogInstrument
): MarketRow | undefined {
  const uid = searchInstrumentUid(item);
  if (item.providerRef)
    return rows.find((row) => row.providerRef && providerSeriesId(row.providerRef) === uid);

  const bankRows = rows.filter((row) => !row.providerRef);
  if (uid) {
    const match = bankRows.find((row) => row.uid === uid);
    if (match) return match;
  }
  if (!item.figi) return undefined;
  const alternatives = bankRows.filter(
    (row) => row.figi === item.figi && (!uid || row.uid === null)
  );
  return alternatives.length === 1 ? alternatives[0] : undefined;
}
