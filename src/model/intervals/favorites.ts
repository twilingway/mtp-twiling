import { isIntervalId } from "./registry.js";
import type { IntervalId } from "./registry.js";
export const DEFAULT_INTERVAL_FAVORITES: readonly IntervalId[] = ["1m", "5m", "15m", "1h", "1d"];
export function toggleIntervalFavorite(
  current: readonly IntervalId[],
  id: IntervalId
): IntervalId[] {
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}
export function isIntervalFavorites(value: unknown): value is IntervalId[] {
  return (
    Array.isArray(value) &&
    value.length <= 18 &&
    value.every(isIntervalId) &&
    new Set(value).size === value.length
  );
}
