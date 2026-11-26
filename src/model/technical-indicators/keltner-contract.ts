import type { PriceSource } from "./types.js";

export const KELTNER_BANDS_STYLES = ["Average True Range", "True Range", "Range"] as const;
export type KeltnerBandsStyle = (typeof KELTNER_BANDS_STYLES)[number];
export interface KeltnerParameters {
  length: number;
  multiplier: number;
  source: PriceSource;
  useExponentialMa: boolean;
  bandsStyle: KeltnerBandsStyle;
  atrLength: number;
}
export type KeltnerHistoryRequirement =
  | {
      kind: "finite";
      lookbackBars: number;
      seedBars: number;
      seedPolicy: "full-window-sma;tr-fallback-high-low";
      convergence: "exact-after-lookback";
    }
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: number;
      seedPolicy:
        | "first-valid-ema;tr-fallback-high-low"
        | "first-valid-ema;full-window-rma"
        | "full-window-sma;full-window-rma";
      convergence: "full-input-dependent";
    };
