import type { MarketRow } from "./types.js";
import { isInstrumentSymbol } from "./instrument-symbol.js";
import { isWatchlistFlagKey } from "./watchlist-flags.js";

export interface WatchlistSection {
  kind: "section";
  id: string;
  title: string;
  collapsed: boolean;
}
export interface WatchlistInstrumentRef {
  kind: "instrument";
  uid: string | null;
  symbol: string;
  occurrence: number;
}
export type WatchlistEntry = WatchlistSection | WatchlistInstrumentRef;
export interface WatchlistSections {
  version: 1;
  entries: WatchlistEntry[];
}
export const WATCHLIST_SECTION_LIMIT = 200;
export const WATCHLIST_REFERENCE_LIMIT = 10000;
export const WATCHLIST_SECTION_TITLE_LIMIT = 80;

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        keys.includes(key) &&
        !!descriptor &&
        "value" in descriptor &&
        descriptor.enumerable
      );
    })
  );
}
export function isSectionTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= WATCHLIST_SECTION_TITLE_LIMIT &&
    !/[<>]/u.test(value) &&
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
    )
  );
}
export function watchlistEntryKey(entry: WatchlistEntry): string {
  return entry.kind === "section"
    ? `section:${entry.id}`
    : JSON.stringify([entry.uid, entry.symbol, entry.occurrence]);
}
export function isWatchlistSections(value: unknown): value is WatchlistSections {
  if (!record(value, ["version", "entries"]) || value.version !== 1) return false;
  const entries = value.entries;
  if (
    !Array.isArray(entries) ||
    Object.getPrototypeOf(entries) !== Array.prototype ||
    entries.length > WATCHLIST_REFERENCE_LIMIT + WATCHLIST_SECTION_LIMIT ||
    Reflect.ownKeys(entries).length !== entries.length + 1
  )
    return false;
  let sections = 0,
    references = 0;
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!descriptor || !("value" in descriptor)) return false;
    const entry: unknown = descriptor.value;
    if (record(entry, ["kind", "id", "title", "collapsed"])) {
      if (
        entry.kind !== "section" ||
        typeof entry.id !== "string" ||
        !/^section-[a-zA-Z0-9_-]{1,80}$/.test(entry.id) ||
        !isSectionTitle(entry.title) ||
        typeof entry.collapsed !== "boolean" ||
        ++sections > WATCHLIST_SECTION_LIMIT
      )
        return false;
    } else if (record(entry, ["kind", "uid", "symbol", "occurrence"])) {
      if (
        entry.kind !== "instrument" ||
        !isInstrumentSymbol(entry.symbol) ||
        (entry.uid !== null &&
          (typeof entry.uid !== "string" || !isWatchlistFlagKey(`uid:${entry.uid}`))) ||
        !Number.isSafeInteger(entry.occurrence) ||
        Number(entry.occurrence) < 0 ||
        Number(entry.occurrence) >= WATCHLIST_REFERENCE_LIMIT ||
        ++references > WATCHLIST_REFERENCE_LIMIT
      )
        return false;
    } else return false;
    const key = watchlistEntryKey(entry as unknown as WatchlistEntry);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Validate the optional field without invoking an accessor or accepting inherited metadata. */
export function validWatchlistSectionsField(layout: object): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(layout, "watchlistSections");
  return descriptor
    ? !!descriptor.enumerable &&
        "value" in descriptor &&
        (descriptor.value === undefined || isWatchlistSections(descriptor.value))
    : !("watchlistSections" in layout);
}

export function watchlistReferences(rows: readonly MarketRow[]): WatchlistInstrumentRef[] {
  const occurrences = new Map<string, number>();
  return rows.map(({ uid, symbol }) => {
    const identity = JSON.stringify([uid, symbol]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { kind: "instrument", uid, symbol, occurrence };
  });
}
/** Missing/foreign references never create quote rows; newly added instruments join the tail. */
export function reconcileWatchlistSections(
  rows: readonly MarketRow[],
  previous?: WatchlistSections
): WatchlistSections {
  const refs = watchlistReferences(rows),
    live = new Map(refs.map((ref) => [watchlistEntryKey(ref), ref]));
  const entries: WatchlistEntry[] = [];
  if (isWatchlistSections(previous))
    for (const entry of previous.entries) {
      if (entry.kind === "section") entries.push(entry);
      else {
        const key = watchlistEntryKey(entry),
          ref = live.get(key);
        if (ref) {
          entries.push(ref);
          live.delete(key);
        }
      }
    }
  entries.push(...live.values());
  return { version: 1, entries };
}
export function orderedWatchlistRows(
  rows: readonly MarketRow[],
  sections?: WatchlistSections,
  includeCollapsed = true
): MarketRow[] {
  const map = new Map(
    watchlistReferences(rows).map((ref, index) => [watchlistEntryKey(ref), rows[index]!])
  );
  let collapsed = false;
  return reconcileWatchlistSections(rows, sections).entries.flatMap((entry) => {
    if (entry.kind === "section") {
      collapsed = entry.collapsed;
      return [];
    }
    const row = map.get(watchlistEntryKey(entry));
    return row && (includeCollapsed || !collapsed) ? [row] : [];
  });
}

export function watchlistSelectionFallback({
  rows,
  preferences
}: {
  rows: readonly MarketRow[];
  preferences: { watchlistSections?: WatchlistSections };
}): { symbol: string; instrumentUid: string | null } {
  const displayed = orderedWatchlistRows(rows, preferences.watchlistSections);
  const next = displayed.find((row) => row.uid) ?? displayed[0];
  return { symbol: next?.symbol ?? "", instrumentUid: next?.uid ?? null };
}
