import type { NumericSeries } from "./types.js";
import type { IndexedRun } from "./presentation-types.js";

/** Inclusive index runs; preserves original adjacency even when native SDK data filters nulls. */
export function presentationRuns(
  values: NumericSeries,
  paired?: NumericSeries,
  first = 0,
  last = values.length - 1
): readonly IndexedRun[] {
  if (
    (paired && paired.length !== values.length) ||
    !Number.isInteger(first) ||
    !Number.isInteger(last)
  )
    throw new RangeError("Invalid TA presentation run bounds");
  const result: IndexedRun[] = [];
  let start: number | null = null;
  const end = Math.min(values.length - 1, last);
  for (let i = Math.max(0, first); i <= end; i++) {
    const known = Number.isFinite(values[i]) && (!paired || Number.isFinite(paired[i]));
    if (known && start === null) start = i;
    if (!known && start !== null) {
      result.push({ first: start, last: i - 1 });
      start = null;
    }
  }
  if (start !== null) result.push({ first: start, last: end });
  return result;
}
