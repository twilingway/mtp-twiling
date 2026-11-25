import type { MarketRow } from "./types.js";
import {
  reconcileWatchlistSections,
  watchlistEntryKey,
  watchlistReferences
} from "./watchlist-sections.js";
import type {
  WatchlistInstrumentRef,
  WatchlistSection,
  WatchlistSections
} from "./watchlist-sections.js";
import type { WatchlistPosition } from "../services/watchlist-order.js";

export type WatchlistSortKey = "symbol" | "price" | "change" | "changePercent";
export interface WatchlistDisplayRow {
  row: MarketRow;
  position: WatchlistPosition;
  reference: WatchlistInstrumentRef;
  key: string;
}
export interface WatchlistGroup {
  section: WatchlistSection | null;
  rows: WatchlistDisplayRow[];
}
/** Filtering/sorting never mutates the persisted ledger or mixes instruments between sections. */
export function watchlistGroups(
  rows: readonly MarketRow[],
  sections: WatchlistSections | undefined,
  visible: (row: MarketRow) => boolean = () => true,
  sort: WatchlistSortKey | null = null,
  direction = -1
): WatchlistGroup[] {
  const refs = watchlistReferences(rows);
  const byKey = new Map(
    refs.map((reference, index) => {
      const row = rows[index]!;
      return [
        watchlistEntryKey(reference),
        {
          row,
          reference,
          key: watchlistEntryKey(reference),
          position: { index, uid: row.uid, symbol: row.symbol }
        }
      ];
    })
  );
  const groups: WatchlistGroup[] = [{ section: null, rows: [] }];
  for (const entry of reconcileWatchlistSections(rows, sections).entries) {
    if (entry.kind === "section") groups.push({ section: entry, rows: [] });
    else {
      const display = byKey.get(watchlistEntryKey(entry));
      if (display && visible(display.row)) groups[groups.length - 1]!.rows.push(display);
    }
  }
  if (sort)
    for (const group of groups)
      group.rows.sort((a, b) => {
        const x = a.row[sort],
          y = b.row[sort];
        if (x == null) return y == null ? 0 : 1;
        if (y == null) return -1;
        return (
          direction *
          (typeof x === "string" && typeof y === "string"
            ? x.localeCompare(y)
            : Number(x) - Number(y))
        );
      });
  return groups;
}
