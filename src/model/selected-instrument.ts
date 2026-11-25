import type { MarketRow } from "./types.js";

export interface InstrumentSelection {
  symbol: string;
  instrumentUid?: string | null | undefined;
}

/** Only older preferences without a UID use the legacy symbol lookup. */
export function selectedMarketRow(
  rows: readonly MarketRow[],
  selection: InstrumentSelection
): MarketRow | undefined {
  if (selection.instrumentUid !== undefined)
    return rows.find((row) =>
      selection.instrumentUid === null
        ? row.uid === null && row.symbol === selection.symbol
        : row.uid === selection.instrumentUid && row.symbol === selection.symbol
    );
  return rows.find((row) => row.symbol === selection.symbol);
}

export function pinSelectedInstrument<T extends InstrumentSelection>(
  rows: readonly MarketRow[],
  preferences: T
): T {
  if (preferences.instrumentUid !== undefined) return preferences;
  const row = selectedMarketRow(rows, preferences);
  return row ? { ...preferences, instrumentUid: row.uid } : preferences;
}
