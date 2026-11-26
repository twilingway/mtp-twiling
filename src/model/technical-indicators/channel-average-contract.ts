import type { PriceSource } from "./types.js";

/** Registration subset only; KC/DC retain their separate input/presentation gates. */
export type ChannelPriceId = "alma" | "lsma" | "chandelier-exit";
export interface ChannelPriceParameters {
  alma: { length: number; offset: number; sigma: number };
  lsma: { length: number; offset: number; source: PriceSource };
  "chandelier-exit": { length: number; atrLength: number; multiplier: number };
}
export type ChannelPriceHistoryRequirement = {
  kind: "recursive";
  lookbackBars: null;
  seedBars: number;
  seedPolicy: "available-extrema;tr-fallback;full-window-atr-rma";
  convergence: "full-input-dependent";
};
