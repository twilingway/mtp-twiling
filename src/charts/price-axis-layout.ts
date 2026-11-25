import { intlLocale } from "../i18n/preferences.js";
import type { MarketRow } from "../model/types.js";
import { precision } from "./adapter.js";

/** Reserve the same axis space with or without the native crosshair label. */
export function stablePriceAxisWidth(
  row: MarketRow,
  fontSize: number,
  containerWidth: number
): number {
  const reference = Math.max(1, Math.abs(row.price ?? 0), Math.abs(row.previousClose ?? 0)) * 10;
  const digits = precision(row);
  const label = reference.toLocaleString(intlLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true
  });
  const width = Math.max(72, Math.ceil((label.length + 1) * fontSize * 0.65 + 20));
  // Large imported fonts must still leave a usable plot on small screens.
  return Math.min(width, Math.max(48, Math.floor(containerWidth * 0.45)));
}
