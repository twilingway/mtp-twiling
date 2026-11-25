import { isSectionTitle, isWatchlistSections, watchlistEntryKey } from "./watchlist-sections.js";
import type { WatchlistEntry, WatchlistSection, WatchlistSections } from "./watchlist-sections.js";

export type WatchlistSectionChange =
  | { kind: "insert"; header: WatchlistSection; before: string | null }
  | { kind: "rename"; id: string; title: string }
  | { kind: "collapse"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "move"; source: string; target: string; placement: "before" | "after" }
  | { kind: "step"; source: string; direction: -1 | 1 }
  | { kind: "assign"; source: string; section: string | null };

function blockEnd(entries: readonly WatchlistEntry[], start: number): number {
  let end = start + 1;
  if (entries[start]?.kind === "section")
    while (end < entries.length && entries[end]?.kind !== "section") end++;
  return end;
}
/** Header moves carry their members. Instrument moves cross boundaries one entry at a time. */
export function changeWatchlistSections(
  previous: WatchlistSections,
  change: WatchlistSectionChange
): WatchlistSections | null {
  const entries = [...previous.entries];
  const find = (key: string) => entries.findIndex((entry) => watchlistEntryKey(entry) === key);
  if (change.kind === "insert") {
    const index = change.before === null ? entries.length : find(change.before);
    if (index < 0) return null;
    entries.splice(index, 0, change.header);
  } else if (change.kind === "rename" || change.kind === "collapse" || change.kind === "delete") {
    const index = entries.findIndex((entry) => entry.kind === "section" && entry.id === change.id);
    const header = entries[index];
    if (index < 0 || header?.kind !== "section") return null;
    if (change.kind === "rename") {
      if (!isSectionTitle(change.title)) return null;
      entries[index] = { ...header, title: change.title };
    } else if (change.kind === "collapse")
      entries[index] = { ...header, collapsed: !header.collapsed };
    else {
      const members = entries.splice(index, blockEnd(entries, index) - index).slice(1);
      const firstHeader = entries.findIndex((entry) => entry.kind === "section");
      entries.splice(firstHeader < 0 ? entries.length : firstHeader, 0, ...members);
    }
  } else {
    const source = find(change.source);
    if (source < 0) return null;
    const end = blockEnd(entries, source);
    let insertion: number;
    if (change.kind === "move") {
      const target = find(change.target);
      if (target < 0 || (target >= source && target < end)) return null;
      // A header cannot be nested in another section; place its whole block around the target block.
      if (entries[source]?.kind === "section") {
        let start = target;
        while (start > 0 && entries[start]?.kind !== "section") start--;
        // Top-level rows must remain a prefix, so a section cannot capture them by being moved above.
        if (entries[start]?.kind !== "section") {
          const firstHeader = entries.findIndex((entry) => entry.kind === "section");
          insertion = firstHeader < 0 ? entries.length : firstHeader;
        } else insertion = change.placement === "before" ? start : blockEnd(entries, start);
      } else insertion = target + (change.placement === "after" ? 1 : 0);
    } else if (change.kind === "assign") {
      if (entries[source]?.kind !== "instrument") return null;
      if (change.section === null) {
        const firstHeader = entries.findIndex((entry) => entry.kind === "section");
        insertion = firstHeader < 0 ? entries.length : firstHeader;
      } else {
        const target = entries.findIndex(
          (entry) => entry.kind === "section" && entry.id === change.section
        );
        if (target < 0) return null;
        insertion = blockEnd(entries, target);
      }
    } else {
      if (change.direction === -1) {
        if (source === 0) return null;
        insertion = source - 1;
        if (entries[source]?.kind === "section")
          while (insertion > 0 && entries[insertion]?.kind !== "section") insertion--;
        if (entries[source]?.kind === "section" && entries[insertion]?.kind !== "section")
          return null;
      } else {
        if (end === entries.length) return null;
        insertion = entries[source]?.kind === "section" ? blockEnd(entries, end) : end + 1;
      }
    }
    if (insertion >= source && insertion <= end) return null;
    const block = entries.splice(source, end - source);
    entries.splice(insertion - (source < insertion ? block.length : 0), 0, ...block);
  }
  const result: WatchlistSections = { version: 1, entries };
  return isWatchlistSections(result) ? result : null;
}
