/** Integration-only literals for the two reviewed price recurrences. */
export type TrendPriceId = "parabolic-sar" | "supertrend";
export type TrendPriceHistoryRequirement =
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: 2;
      seedPolicy: "two-adjacent-bars-close-direction";
      convergence: "full-input-dependent";
    }
  | {
      kind: "recursive";
      lookbackBars: null;
      seedBars: number;
      seedPolicy: "contiguous-true-range-wilder-and-trailing-bands";
      convergence: "full-input-dependent";
    };
