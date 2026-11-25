import type { MarketRow } from "../model/types.js";

export interface PriceMetadata {
  owner: string;
  uid: string;
  step: number;
}
export function positivePriceStep(step: unknown): step is number {
  return typeof step === "number" && Number.isFinite(step) && step > 0;
}
/** Decimal and scientific notation both occur for the API's nanounit tick sizes. */
export function chartPriceFormat(row: Pick<MarketRow, "symbol" | "step">): {
  precision: number;
  minMove: number;
} {
  if (!positivePriceStep(row.step)) {
    const precision = row.symbol === "NG" ? 3 : 2;
    return { precision, minMove: 10 ** -precision };
  }
  const [coefficient = "", exponent = "0"] = String(row.step).toLowerCase().split("e"),
    decimals = (coefficient.split(".")[1]?.length ?? 0) - Number(exponent);
  return { precision: Math.max(2, decimals), minMove: row.step };
}
