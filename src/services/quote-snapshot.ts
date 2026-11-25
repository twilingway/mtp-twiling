interface QuoteRequester {
  request(service: string, method: string, body: object): Promise<Record<string, unknown>>;
}

/** Price and prior close are independent; a failed close must not discard a valid price. */
export function quoteSnapshot(client: QuoteRequester, ids: readonly string[]) {
  return Promise.allSettled([
    client.request("MarketDataService", "GetLastPrices", {
      instrumentId: ids,
      lastPriceType: "LAST_PRICE_EXCHANGE"
    }),
    client.request("MarketDataService", "GetClosePrices", {
      instruments: ids.map((instrumentId) => ({ instrumentId }))
    })
  ] as const);
}
