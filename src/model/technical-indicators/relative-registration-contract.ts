import type { PriceSource } from "./types.js";
import type { VolatilityMaType } from "./relative-oscillators/volatility.js";

export type RelativeRegisteredId = keyof RelativeRegisteredParameters;
export interface RelativeRegisteredParameters {
  "stochastic-rsi": {
    rsiLength: number;
    stochasticLength: number;
    smoothK: number;
    smoothD: number;
    source: PriceSource;
  };
  "coppock-curve": { wmaLength: number; longRocLength: number; shortRocLength: number };
  "relative-vigor-index": { length: number };
  "relative-volatility-index": {
    length: number;
    maType: VolatilityMaType;
    maLength: number;
    bbMultiplier: number;
  };
  "bull-bear-power": { length: number };
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
    }
  | {
      kind: "finite-observation-window";
      lookbackBars: null;
      denseLookbackBars: number;
      seedPolicy: "swma-four-positional;rolling-last-known;same-index-ratio";
      convergence: "sparse-full-input-dependent";
      firstPossibleIndex: { value: number; signal: number };
    }
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: number;
      seedPolicy: "directional-deviation;first-known-ema";
      convergence: "full-input-dependent";
      firstPossibleIndex: { value: number | null; smoothing: number | null };
    };
