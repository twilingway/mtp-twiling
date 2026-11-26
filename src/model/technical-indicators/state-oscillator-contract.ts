/** Reviewed integration-only history union; existing indicator seed contracts stay unchanged. */
export type StateOscillatorId = "tsi" | "kst" | "fisher-transform";
export type StateOscillatorHistoryRequirement =
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: 2;
      seedPolicy: "first-known-ema-chain";
      convergence: "full-input-dependent";
    }
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: 2 | null;
      seedPolicy: "partial-extrema-explicit-previous-state-nz";
      convergence: "full-input-dependent";
    }
  | {
      kind: "finite";
      lookbackBars: number;
      seedPolicy: "known-observation-window";
      convergence: "exact-after-dense-lookback";
    };
