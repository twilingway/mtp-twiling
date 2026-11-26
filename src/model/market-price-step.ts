import { isBankIdentity } from "./market-provider.js";
import type { MarketRow } from "./types.js";

export type MarketTickSource = Pick<MarketRow, "step"> &
  Partial<
    Pick<
      MarketRow,
      | "nativePriceStep"
      | "symbol"
      | "ticker"
      | "providerRef"
      | "uid"
      | "type"
      | "exchange"
      | "realExchange"
      | "classCode"
    >
  >;

export function positivePriceStep(step: unknown): step is number {
  return typeof step === "number" && Number.isFinite(step) && step > 0;
}

export function nativePriceStep(row: MarketTickSource | undefined): number | null {
  if (!row) return null;
  if (positivePriceStep(row.step)) return row.step;
  if (positivePriceStep(row.nativePriceStep)) return row.nativePriceStep;

  // Public MOEX contract specification for old profiles before tick metadata becomes available.
  // https://www.moex.com/ru/derivatives/perpetual-futures/cnyrubf
  const moexDerivative =
    /^(?:forts|moex)(?:$|[_-])/i.test(row.exchange ?? "") ||
    row.classCode === "SPBFUT" ||
    (row.type === "future" && row.realExchange === "REAL_EXCHANGE_MOEX");
  return isBankIdentity(row) &&
    (row.type === "future" || row.type === undefined) &&
    moexDerivative &&
    (row.ticker || row.symbol)?.toUpperCase() === "CNYRUBF"
    ? 0.001
    : null;
}
