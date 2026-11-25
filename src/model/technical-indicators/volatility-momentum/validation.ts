import type { NumericValue, TechnicalBar } from "../types.js";

export function assertBarFields(
  bars: readonly TechnicalBar[],
  fields: readonly (keyof Omit<TechnicalBar, "timestamp">)[]
): void {
  for (const bar of bars) {
    if (bar == null) throw new RangeError("Bars must not contain holes");
    for (const field of fields) {
      const value = bar[field];
      if (value !== null && !Number.isFinite(value))
        throw new RangeError("Fields must be finite or null");
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

export function assertMultiplier(multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier < 0.001 || multiplier > 50)
    throw new RangeError("Bollinger multiplier must be between 0.001 and 50");
}

export function positiveLog(value: NumericValue): NumericValue {
  return value !== null && value > 0 ? Math.log(value) : null;
}

/** A positive-price log return, without avoidable ratio overflow or near-one cancellation. */
export function logReturn(current: NumericValue, previous: NumericValue | undefined): NumericValue {
  if (current === null || previous == null || current <= 0 || previous <= 0) return null;
  const relative = (current - previous) / previous;
  if (Number.isFinite(relative) && Math.abs(relative) < 0.5) return Math.log1p(relative);
  const ratio = current / previous;
  return ratio > 0 && Number.isFinite(ratio)
    ? Math.log(ratio)
    : Math.log(current) - Math.log(previous);
}
