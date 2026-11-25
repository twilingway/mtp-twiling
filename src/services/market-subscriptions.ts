export function lastPriceSubscription(action: "subscribe" | "unsubscribe", ids: readonly string[]) {
  return {
    subscribeLastPriceRequest: {
      subscriptionAction:
        action === "subscribe"
          ? "SUBSCRIPTION_ACTION_SUBSCRIBE"
          : "SUBSCRIPTION_ACTION_UNSUBSCRIBE",
      instruments: ids.map((instrumentId) => ({ instrumentId }))
    }
  };
}
