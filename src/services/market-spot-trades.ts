import { providerSeriesId } from "../model/market-provider.js";
import type { MarketRow } from "../model/types.js";

export function okxSpotTradeSource(
  row: Pick<MarketRow, "providerRef" | "uid" | "baseCoin" | "assetClass"> | undefined
) {
  if (!row) return null;
  const ref = row.providerRef;
  if (
    ref?.provider !== "okx" ||
    ref.category !== "spot" ||
    !row.baseCoin ||
    row.assetClass !== "crypto" ||
    row.uid !== providerSeriesId(ref)
  )
    return null;
  return { ref, uid: row.uid, currency: row.baseCoin };
}
