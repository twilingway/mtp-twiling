import type { MarketRow } from "../model/types.js";
import type { PriceFormat } from "lightweight-charts";

export interface PriceMetadata {
  owner: string;
  uid: string;
  step: number | null;
  priceHint?: number | null;
}
export interface ChartPriceFormat {
  precision: number;
  /** Null means the exchange tick is unknown, not a guessed decimal increment. */
  minMove: number | null;
}
export function positivePriceStep(step: unknown): step is number {
  return typeof step === "number" && Number.isFinite(step) && step > 0;
}
/** Decimal and scientific notation both occur for the API's nanounit tick sizes. */
export function chartPriceFormat(
  row: Pick<MarketRow, "symbol" | "step"> & { price?: number | null | undefined },
  previous?: ChartPriceFormat
): ChartPriceFormat {
  if (!positivePriceStep(row.step)) {
    if (previous?.minMove) return previous;
    const quoted =
      typeof row.price === "number" && Number.isFinite(row.price)
        ? (row.price.toFixed(9).replace(/0+$/, "").split(".")[1]?.length ?? 0)
        : 0;
    return {
      precision: Math.max(row.symbol === "NG" ? 3 : 2, previous?.precision ?? 0, quoted),
      minMove: null
    };
  }
  const [coefficient = "", exponent = "0"] = String(row.step).toLowerCase().split("e"),
    decimals = (coefficient.split(".")[1]?.length ?? 0) - Number(exponent);
  return { precision: Math.min(9, Math.max(2, decimals)), minMove: row.step };
}
export function lightweightPriceFormat(format: ChartPriceFormat): PriceFormat {
  return format.minMove !== null
    ? { type: "price", precision: format.precision, minMove: format.minMove }
    : {
        type: "custom",
        formatter: (price) => price.toFixed(format.precision),
        // Native renderer requires a quantum. This is API nanounit resolution, not an exchange tick.
        minMove: 1e-9
      };
}
