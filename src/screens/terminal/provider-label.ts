import type { MarketProviderRef } from "../../model/market-provider.js";

export function providerLabel(ref: MarketProviderRef): "Bybit" | "OKX" {
  return ref.provider === "okx" ? "OKX" : "Bybit";
}
