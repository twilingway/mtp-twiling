import { providerRefFromId } from "../model/market-provider.js";
import { BybitHttp } from "./providers/bybit/http.js";
import { loadQuotes } from "./providers/bybit/market.js";
import { OkxHttp } from "./providers/okx/http.js";
import { normaliseOkxQuote } from "./providers/okx/market.js";

let bybit: BybitHttp | undefined;
let okx: OkxHttp | undefined;

export async function loadPublicSearchPrices(
  ids: readonly string[],
  signal: AbortSignal
): Promise<Map<string, number>> {
  const pending = ids.flatMap((id) => {
    const ref = providerRefFromId(id);
    return ref ? [{ id, ref }] : [];
  });
  const prices = new Map<string, number>();
  // Per-symbol REST only: no full-market snapshot or stream for a search result.
  const worker = async () => {
    while (pending.length) {
      signal.throwIfAborted();
      const item = pending.shift();
      if (!item) return;
      try {
        const { ref, id } = item;
        let price: number | null | undefined;
        if (ref.provider === "bybit") {
          bybit ??= new BybitHttp();
          const quotes = await loadQuotes(bybit, ref.category, ref.symbol, signal);
          price = quotes.find((quote) => quote.seriesId === id)?.lastPrice;
        } else {
          okx ??= new OkxHttp();
          const rows = await okx.get("/api/v5/market/ticker", { instId: ref.symbol }, signal);
          if (rows.length === 1) price = normaliseOkxQuote(ref, rows[0]).lastPrice;
        }
        signal.throwIfAborted();
        if (price != null && Number.isFinite(price) && price > 0) prices.set(id, price);
      } catch {
        signal.throwIfAborted();
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return prices;
}
