import type { MarketRow } from "./types.js";
import { isInstrumentSymbol } from "./instrument-symbol.js";
import { providerRefFromId } from "./market-provider.js";

export const WATCHLIST_FLAG_COLORS = {
  red: "#ff5252",
  blue: "#2962ff",
  green: "#66bb6a",
  yellow: "#ffca28",
  purple: "#ab47bc",
  cyan: "#26c6da",
  pink: "#f48fb1"
} as const;
export type WatchlistFlagColor = keyof typeof WATCHLIST_FLAG_COLORS;
export type WatchlistFlags = Record<string, WatchlistFlagColor>;
export type WatchlistFlagFilter = "all" | WatchlistFlagColor;
export const WATCHLIST_FLAG_LIMIT = 5000;

export function isWatchlistFlagColor(value: unknown): value is WatchlistFlagColor {
  return typeof value === "string" && Object.hasOwn(WATCHLIST_FLAG_COLORS, value);
}
export function isWatchlistFlagFilter(value: unknown): value is WatchlistFlagFilter {
  return value === "all" || isWatchlistFlagColor(value);
}
export function isWatchlistFlagKey(key: string): boolean {
  return (
    key.length <= 200 &&
    (/^uid:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) ||
      (key.startsWith("uid:") && providerRefFromId(key.slice(4)) !== null) ||
      (key.startsWith("legacy:") && isInstrumentSymbol(key.slice(7))))
  );
}
export function isWatchlistFlags(value: unknown): value is WatchlistFlags {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= WATCHLIST_FLAG_LIMIT &&
    entries.every(([key, color]) => isWatchlistFlagKey(key) && isWatchlistFlagColor(color))
  );
}
export function watchlistFlagKey(row: Pick<MarketRow, "uid" | "symbol">): string | null {
  const key = row.uid == null ? `legacy:${row.symbol}` : `uid:${row.uid}`;
  return isWatchlistFlagKey(key) ? key : null;
}
export function watchlistFlag(
  flags: WatchlistFlags | undefined,
  row: Pick<MarketRow, "uid" | "symbol">
): WatchlistFlagColor | undefined {
  const key = watchlistFlagKey(row);
  return key && flags && Object.hasOwn(flags, key) ? flags[key] : undefined;
}
export function updatedWatchlistFlags(
  previous: WatchlistFlags | undefined,
  key: string,
  color: WatchlistFlagColor | null
): WatchlistFlags | null {
  if (!isWatchlistFlagKey(key) || (color !== null && !isWatchlistFlagColor(color))) return null;
  const next = { ...previous };
  if (color === null) delete next[key];
  else next[key] = color;
  return isWatchlistFlags(next) ? next : null;
}
export function matchesWatchlistFlag(
  row: Pick<MarketRow, "uid" | "symbol">,
  flags: WatchlistFlags | undefined,
  filter: WatchlistFlagFilter = "all"
): boolean {
  return filter === "all" || watchlistFlag(flags, row) === filter;
}
/** Count displayed rows so each colored list agrees with its visible row count. */
export function watchlistFlagCounts(rows: readonly MarketRow[], flags: WatchlistFlags | undefined) {
  const counts = Object.fromEntries(
    Object.keys(WATCHLIST_FLAG_COLORS).map((key) => [key, 0])
  ) as Record<WatchlistFlagColor, number>;
  for (const row of rows) {
    const color = watchlistFlag(flags, row);
    if (color) counts[color]++;
  }
  return counts;
}
