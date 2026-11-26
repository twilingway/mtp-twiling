import type { NumericValue, PriceSource, TechnicalBar } from "../types.js";
import { add, number, scalar, times } from "./numeric.js";

export const MAX_RELATIVE_BARS = 1_000_000;
export const MAX_RELATIVE_VISITS = 80_000_000;
const arrayInput = (value: unknown): boolean => Array.isArray(value);
export function period(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 10000)
    throw new RangeError("Length outside local 1..10000 bounds");
}
export function bounded(value: number, min: number, max: number, integer = false): void {
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new RangeError("Parameter outside supported bounds");
}
export function budget(size: number, visitsPerBar: number): void {
  if (size * visitsPerBar > MAX_RELATIVE_VISITS)
    throw new RangeError("Relative oscillator operation cap exceeded");
}
export const treeVisits = (length: number): number => 3 * Math.ceil(Math.log2(length)) + 1;
export function optionsInput(options: object, keys: readonly string[]): void {
  if (options === null || typeof options !== "object" || Array.isArray(options))
    throw new RangeError("Options object required");
  if (Object.keys(options).some((key) => !keys.includes(key)))
    throw new RangeError("Unknown oscillator option");
}
const fields: Record<PriceSource, readonly (keyof TechnicalBar)[]> = {
  open: ["open"],
  high: ["high"],
  low: ["low"],
  close: ["close"],
  volume: ["volume"],
  hl2: ["high", "low"],
  hlc3: ["high", "low", "close"],
  ohlc4: ["open", "high", "low", "close"]
};
export function sourceFields(source: PriceSource): readonly (keyof TechnicalBar)[] {
  if (!Object.hasOwn(fields, source)) throw new RangeError("Unknown price source");
  return fields[source];
}
export function input(
  bars: readonly TechnicalBar[],
  consumed: readonly (keyof TechnicalBar)[]
): void {
  if (!arrayInput(bars) || bars.length > MAX_RELATIVE_BARS)
    throw new RangeError("Invalid bars or local bar cap exceeded");
  const checkedFields = new Set<keyof TechnicalBar>(["timestamp", ...consumed]);
  for (const bar of bars) {
    if (bar === null || typeof bar !== "object") throw new RangeError("Dense bars required");
    for (const field of checkedFields) {
      const value = bar[field];
      if (value === null && field !== "timestamp") continue;
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new RangeError("Consumed fields must be finite or null");
      if (field === "volume" && value < 0) throw new RangeError("Negative volume");
    }
    if (
      consumed.includes("high") &&
      consumed.includes("low") &&
      bar.high !== null &&
      bar.low !== null
    ) {
      if (bar.high < bar.low) throw new RangeError("High below low");
      for (const field of ["open", "close"] as const)
        if (
          consumed.includes(field) &&
          bar[field] !== null &&
          (bar[field] < bar.low || bar[field] > bar.high)
        )
          throw new RangeError("Consumed open/close outside high-low range");
    }
  }
}
export function prices(bars: readonly TechnicalBar[], source: PriceSource): NumericValue[] {
  const consumed = sourceFields(source);
  return bars.map((bar) => {
    let sum = scalar(0);
    for (const field of consumed) {
      const value = bar[field];
      if (value === null) return null;
      sum = add(sum, scalar(value));
    }
    return number(times(sum, 1 / consumed.length));
  });
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
