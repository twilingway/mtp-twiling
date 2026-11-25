export type IndicatorLibraryCategory = "scripts" | "technicals";

export interface IndicatorLibraryEntry<Id extends string = string> {
  id: Id;
  label: string;
  aliases?: readonly string[];
  description?: string;
  category: IndicatorLibraryCategory;
  available: boolean;
  reason?: string;
}

export function filterIndicatorLibrary<Id extends string>(
  entries: readonly IndicatorLibraryEntry<Id>[],
  category: IndicatorLibraryCategory,
  query: string
): IndicatorLibraryEntry<Id>[] {
  const term = query.normalize("NFKC").trim().toLowerCase();
  return entries.filter(
    (entry) =>
      entry.category === category &&
      (!term ||
        [entry.label, ...(entry.aliases ?? [])].some((label) =>
          label.normalize("NFKC").toLowerCase().includes(term)
        ))
  );
}

/** onAdd enables/adds an entry; it never means toggle. Active entries remain selectable. */
export function addIndicatorLibraryEntry<Id extends string>(
  entry: IndicatorLibraryEntry<Id>,
  onAdd: (id: Id) => void
): boolean {
  if (!entry.available) return false;
  onAdd(entry.id);
  return true;
}

export function indicatorLibraryFocusIndex(
  key: string,
  current: number,
  count: number
): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current + count - 1) % count;
  return null;
}
