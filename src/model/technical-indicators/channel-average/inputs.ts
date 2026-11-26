import type { NumericSeries, NumericValue, PriceSource, TechnicalBar } from "../types.js";

const arrayInput = (value: unknown): boolean => Array.isArray(value);
export const MAX_CHANNEL_AVERAGE_BARS = 1_000_000;
export const MAX_DIRECT_WINDOW_OPERATIONS = 50_000_000;
export function period(value: number, minimum = 1): void {
  if (!Number.isInteger(value) || value < minimum || value > 10000)
    throw new RangeError("Length outside local supported bounds");
}
export function bounded(value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RangeError("Parameter outside local supported bounds");
}
export function integer(value: number, min: number, max: number): void {
  bounded(value, min, max);
  if (!Number.isInteger(value)) throw new RangeError("Expected integer parameter");
}
export const finite = (value: number): NumericValue => (Number.isFinite(value) ? value : null);
/** Preserve finite a+b*c when b*c alone overflows before cancellation. */
export function addScaled(base: number, value: number, multiplier: number): NumericValue {
  const product = value * multiplier;
  if (Number.isFinite(product)) return finite(base + product);
  const scale = Math.max(Math.abs(base), Math.abs(value));
  return finite((base / scale + (value / scale) * multiplier) * scale);
}
/** Finite-safe convex combination, including equal subnormal values. */
export function convex(a: number, b: number, weight: number): number {
  if (a === b) return a;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 0;
  const unit = (a / scale) * (1 - weight) + (b / scale) * weight;
  return Math.min(1, Math.max(-1, unit)) * scale;
}
export function seriesInput(source: NumericSeries): void {
  if (!Array.isArray(source) || source.length > MAX_CHANNEL_AVERAGE_BARS)
    throw new RangeError("Invalid series or resource cap exceeded");
  for (const value of source)
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value)))
      throw new RangeError("Dense finite or null series required");
}
export function directBudget(size: number, length: number): void {
  if (Math.max(0, size - length + 1) * length > MAX_DIRECT_WINDOW_OPERATIONS)
    throw new RangeError("Direct convolution operation cap exceeded");
}
const sourceFields: Record<PriceSource, readonly (keyof TechnicalBar)[]> = {
  open: ["open"],
  high: ["high"],
  low: ["low"],
  close: ["close"],
  volume: ["volume"],
  hl2: ["high", "low"],
  hlc3: ["high", "low", "close"],
  ohlc4: ["open", "high", "low", "close"]
};
export function barsInput(
  bars: readonly TechnicalBar[],
  source?: PriceSource,
  needsClose = true
): void {
  if (!arrayInput(bars) || bars.length > MAX_CHANNEL_AVERAGE_BARS)
    throw new RangeError("Invalid bars or resource cap exceeded");
  if (source !== undefined && !Object.hasOwn(sourceFields, source))
    throw new RangeError("Unknown price source");
  const fields = new Set<keyof TechnicalBar>(["timestamp", "high", "low"]);
  if (needsClose) fields.add("close");
  if (source !== undefined) sourceFields[source].forEach((field) => fields.add(field));
  for (const bar of bars) {
    if (bar === null || typeof bar !== "object") throw new RangeError("Sparse bars");
    for (const field of fields) {
      const value = bar[field];
      if (value === null && field !== "timestamp") continue;
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new RangeError("Consumed fields must be finite or null");
    }
    if (bar.high !== null && bar.low !== null && bar.high < bar.low)
      throw new RangeError("High below low");
    if (
      fields.has("close") &&
      bar.close !== null &&
      ((bar.high !== null && bar.close > bar.high) || (bar.low !== null && bar.close < bar.low))
    )
      throw new RangeError("Close outside range");
  }
}
export function prices(bars: readonly TechnicalBar[], source: PriceSource): NumericValue[] {
  return bars.map((bar) => {
    const fields = sourceFields[source];
    let value: NumericValue = null;
    for (let i = 0; i < fields.length; i++) {
      const current = bar[fields[i]!]!;
      if (current === null) return null;
      value = value === null ? current : convex(value, current, 1 / (i + 1));
    }
    return value;
  });
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
