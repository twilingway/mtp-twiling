import type { PriceSource } from "./types.js";

export type RelativeRegisteredId = "stochastic-rsi" | "coppock-curve";
export interface RelativeRegisteredParameters {
  "stochastic-rsi": {
    rsiLength: number;
    stochasticLength: number;
    smoothK: number;
    smoothD: number;
    source: PriceSource;
  };
  "coppock-curve": { wmaLength: number; longRocLength: number; shortRocLength: number };
}
export type RelativeRegisteredHistory =
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: number;
      seedPolicy: "adjacent-change-rma;canonical-zero-na;partial-positional-stoch;sma-known-k-d";
      convergence: "full-input-dependent";
      firstPossibleIndex: { k: number | null; d: number | null };
    }
  | {
      kind: "finite-observation-window";
      lookbackBars: null;
      denseLookbackBars: number;
      lagBars: readonly [number, number];
      knownObservations: number;
      seedPolicy: "exact-index-roc;wma-last-known";
      convergence: "sparse-full-input-dependent";
      firstPossibleIndex: { value: number };
    };
