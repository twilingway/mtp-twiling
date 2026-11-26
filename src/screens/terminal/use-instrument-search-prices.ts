import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogInstrument, MarketRow } from "../../model/types.js";
import { searchWatchlistRow } from "../../model/instrument-search-identity.js";
import {
  bankSearchQuoteUid,
  INSTRUMENT_SEARCH_PRICE_LIMIT,
  loadInstrumentSearchPrices
} from "../../services/instrument-search-prices.js";
import type { MarketClient } from "../../services/market-client.js";

interface Results {
  scope: object;
  prices: Map<string, number>;
  checked: Set<string>;
}

const emptyPrices = new Map<string, number>();
const searchPriceDelay = 150;

export function useInstrumentSearchPrices(
  client: MarketClient | null,
  owner: string,
  revision: number,
  items: readonly CatalogInstrument[],
  rows: readonly MarketRow[]
) {
  const list = useRef<HTMLDivElement>(null);
  const scope = useMemo(() => ({ client, owner, revision }), [client, owner, revision]);
  const [seen, setSeen] = useState<{ scope: object; ids: string[] }>();
  const [saved, setSaved] = useState<Results>();
  const current = saved?.scope === scope ? saved : undefined;
  useEffect(() => {
    const root = list.current;
    if (!client || !root || typeof IntersectionObserver !== "function") return;
    const visible = new Set<string>();
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active) return;
        for (const entry of entries) {
          const uid = (entry.target as HTMLElement).dataset.searchQuoteUid;
          if (!uid) continue;
          if (entry.isIntersecting) visible.add(uid);
          else visible.delete(uid);
        }
        setSeen({ scope, ids: [...visible] });
      },
      { root }
    );
    for (const row of root.querySelectorAll("[data-search-quote-uid]")) observer.observe(row);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [client, items, scope]);

  const visible = new Set(seen?.scope === scope ? seen.ids : []);
  const needed = items.flatMap((item) => {
    const uid = bankSearchQuoteUid(item);
    if (!uid || !visible.has(uid) || current?.checked.has(uid)) return [];
    const price = searchWatchlistRow(rows, item)?.price;
    return price != null && Number.isFinite(price) && price > 0 ? [] : [uid];
  });
  // UID values are exact identities. This stable batch key is unaffected by unrelated quote ticks.
  const batch = JSON.stringify([...new Set(needed)].sort().slice(0, INSTRUMENT_SEARCH_PRICE_LIMIT));
  useEffect(() => {
    if (!client || batch === "[]") return;
    const abort = new AbortController();
    const ids = JSON.parse(batch) as string[];
    const complete = (prices: ReadonlyMap<string, number>) => {
      if (abort.signal.aborted) return;
      setSaved((previous) => {
        const active = previous?.scope === scope ? previous : undefined;
        return {
          scope,
          prices: new Map([...(active?.prices ?? []), ...prices]),
          checked: new Set([...(active?.checked ?? []), ...ids])
        };
      });
    };
    const timer = setTimeout(() => {
      void loadInstrumentSearchPrices(client, ids, abort.signal)
        .then(complete)
        .catch(() => complete(emptyPrices));
    }, searchPriceDelay);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [batch, client, scope]);
  return { list, prices: current?.prices ?? emptyPrices };
}
