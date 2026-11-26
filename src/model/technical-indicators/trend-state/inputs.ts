import type { NumericSeries, NumericValue, TechnicalBar } from "../types.js";

export const MAX_TREND_STATE_BARS = 1_000_000;
export const arrayInput = (value: unknown): boolean => Array.isArray(value);
export function period(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 10000)
    throw new RangeError("Trend-state length must be an integer in 1..10000");
}
export function bounded(value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RangeError("Trend-state parameter outside local bounds");
}
export const finite = (value: number): NumericValue => (Number.isFinite(value) ? value : null);
type Field = "high" | "low" | "close" | "open";
export function validate(bars: readonly TechnicalBar[], fields: readonly Field[]): void {
  if (!arrayInput(bars) || bars.length > MAX_TREND_STATE_BARS)
    throw new RangeError("Invalid trend-state bars or resource cap exceeded");
  for (const bar of bars) {
    if (bar === null || typeof bar !== "object") throw new RangeError("Sparse trend-state bars");
    for (const field of fields) {
      const value = bar[field];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value)))
        throw new RangeError("Consumed fields must be finite numbers or null");
    }
    if (fields.includes("high") && fields.includes("low")) {
      if (bar.high !== null && bar.low !== null && bar.high < bar.low)
        throw new RangeError("High below low");
      for (const field of ["open", "close"] as const)
        if (
          fields.includes(field) &&
          bar[field] !== null &&
          ((bar.high !== null && bar[field] > bar.high) ||
            (bar.low !== null && bar[field] < bar.low))
        )
          throw new RangeError("Consumed price outside candle range");
    }
  }
}
export const complete = (bar: TechnicalBar): boolean =>
  bar.high !== null && bar.low !== null && bar.close !== null;
/** Split additions avoid overflow of high+low when its midpoint is representable. */
export const midpoint = (a: NumericValue, b: NumericValue): NumericValue =>
  a === null || b === null ? null : finite(a / 2 + b / 2);
export function changes(source: NumericSeries): NumericValue[] {
  return source.map((value, i) =>
    value === null || source[i - 1] == null ? null : finite(value - source[i - 1]!)
  );
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
