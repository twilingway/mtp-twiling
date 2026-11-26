import type { PriceFormat } from "lightweight-charts";
import { nativePriceStep, positivePriceStep } from "../model/market-price-step.js";
import type { MarketTickSource } from "../model/market-price-step.js";

export { nativePriceStep } from "../model/market-price-step.js";

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
/** Decimal and scientific notation both occur for the API's nanounit tick sizes. */
export function priceStepDecimals(step: number): number {
  const [coefficient = "", exponent = "0"] = String(step).split("e");
  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent));
}

export function roundPriceToStep(price: number, step: number | null): number {
  if (!Number.isFinite(price) || !positivePriceStep(step)) return price;
  const ticks = Math.abs(price) / step;
  if (ticks > Number.MAX_SAFE_INTEGER) return price;

  // Recover decimal midpoints that division put just below half a tick.
  const tolerance = Math.min(1e-7, ticks * Number.EPSILON);
  const rounded = Math.round(ticks + tolerance) * step;
  if (!Number.isFinite(rounded)) return price;
  const decimals = priceStepDecimals(step);
  const absolute = decimals <= 100 ? Number(rounded.toFixed(decimals)) : rounded;
  return absolute === 0 ? 0 : Math.sign(price) * absolute;
}

export function chartPriceFormat(
  row: MarketTickSource & { symbol: string; price?: number | null | undefined },
  previous?: ChartPriceFormat
): ChartPriceFormat {
  const step = nativePriceStep(row);
  if (step === null) {
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
  return { precision: Math.min(100, priceStepDecimals(step)), minMove: step };
}

/** The native tick builder requires an integer reciprocal divisible only by 2 and 5. */
function supportedNativeBase(step: number): boolean {
  const reciprocal = 1 / step;
  let base = Math.round(reciprocal);
  if (
    base < 1 ||
    !Number.isSafeInteger(base) ||
    Math.abs(reciprocal - base) > reciprocal * Number.EPSILON
  )
    return false;
  for (const divisor of [2, 5]) while (base % divisor === 0) base /= divisor;
  return base === 1;
}

export function lightweightPriceFormat(format: ChartPriceFormat): PriceFormat {
  return format.minMove !== null && supportedNativeBase(format.minMove)
    ? { type: "price", precision: format.precision, minMove: format.minMove }
    : {
        type: "custom",
        formatter: (price) => price.toFixed(format.precision),
        // Axis graduation can use a safe decimal base independently of the order-entry tick.
        ...(format.minMove === null ? {} : { base: 10 ** Math.min(12, format.precision) }),
        minMove: format.minMove ?? 1e-9
      };
}
