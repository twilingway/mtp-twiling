import { assertSeries, finiteOrNull } from "../primitives.js";
import type { NumericValue, TechnicalBar } from "../types.js";

/** Validate only consumed fields; unrelated OHLC fields and timestamps remain caller-owned. */
export function assertBars(
  bars: readonly TechnicalBar[],
  fields: readonly ("high" | "low" | "close" | "volume")[]
): void {
  for (const bar of bars) {
    if (bar == null) throw new RangeError("Indicator bars must not contain holes");
    for (const field of fields) {
      const value = bar[field];
      assertSeries([value]);
      if (field === "volume" && value !== null && value < 0)
        throw new RangeError("Volume must be nonnegative");
    }
    if (
      fields.includes("high") &&
      fields.includes("low") &&
      bar.high !== null &&
      bar.low !== null &&
      bar.high < bar.low
    )
      throw new RangeError("High must not be below low");
  }
}

export function typicalPrice(bar: TechnicalBar): NumericValue {
  if (bar.high === null || bar.low === null || bar.close === null) return null;
  const scale = Math.max(Math.abs(bar.high), Math.abs(bar.low), Math.abs(bar.close));
  return scale === 0
    ? 0
    : finiteOrNull(((bar.high / scale + bar.low / scale + bar.close / scale) / 3) * scale);
}

/** Avoid a spurious subtraction overflow when the relative change is representable. */
export function relativeChange(current: number, previous: number): NumericValue {
  if (previous === 0) return null;
  const difference = current - previous;
  return finiteOrNull(Number.isFinite(difference) ? difference / previous : current / previous - 1);
}

/** Internal zero is an accumulation origin, never a replacement for an absent contribution. */
export function cumulative(contributions: readonly NumericValue[]): NumericValue[] {
  let total = 0,
    correction = 0,
    overflow = false;
  return contributions.map((value) => {
    if (value === null || overflow) return null;
    const adjusted = value - correction,
      next = total + adjusted;
    correction = next - total - adjusted;
    total = next;
    if (!Number.isFinite(next)) overflow = true;
    return finiteOrNull(next);
  });
}
