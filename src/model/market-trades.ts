export interface SpotTrade {
  readonly id: string;
  readonly timestamp: number;
  readonly price: number;
  readonly quantity: number;
}

export interface SpotTradeHistory {
  readonly instrumentKey: string;
  /** Half-open, contiguous range verified by the public source. */
  readonly coverage: { readonly from: number; readonly to: number } | null;
  readonly previous: SpotTrade | null;
  readonly trades: readonly SpotTrade[];
}
