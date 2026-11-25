import type { Catalog } from "../model/types.js";
import { normaliseInstruments } from "./types.js";
import type { Cache } from "./types.js";
import { BankError } from "./tbank-transport.js";

type Request = (service: string, method: string, body?: object) => Promise<Record<string, unknown>>;

/** A missing currencies field means legacy cache or failed optional upgrade, not an empty catalog. */
export async function loadBankCatalog(
  cache: Pick<Cache, "loadCatalog" | "saveCatalog">,
  request: Request,
  now = Date.now()
): Promise<Catalog> {
  const cached = await cache.loadCatalog();
  const stale = !cached || now - cached.at > 86400000;
  const methods = stale
    ? ["Shares", "Futures", "Indicatives", "Currencies"]
    : cached.currencies === undefined
      ? ["Currencies"]
      : [];
  if (!methods.length) return cached!;
  const results = await Promise.allSettled(
    methods.map((method) =>
      request(
        "InstrumentsService",
        method,
        method === "Indicatives"
          ? undefined
          : {
              instrumentStatus:
                method === "Futures" ? "INSTRUMENT_STATUS_BASE" : "INSTRUMENT_STATUS_ALL"
            }
      )
    )
  );
  if (stale && results[0]?.status !== "fulfilled") {
    const shares = results[0];
    throw shares?.status === "rejected"
      ? shares.reason
      : new BankError("Каталог банка недоступен.", "RESPONSE");
  }
  const instruments = (method: string) => {
    const result = results[methods.indexOf(method)];
    if (result?.status !== "fulfilled") return undefined;
    if (method === "Currencies" && !Array.isArray(result.value.instruments)) return undefined;
    return normaliseInstruments(result.value.instruments);
  };
  const catalog: Catalog = stale
    ? {
        at: now,
        shares: instruments("Shares") ?? [],
        futures: instruments("Futures") ?? [],
        indicatives: instruments("Indicatives") ?? [],
        ...(cached?.currencies !== undefined ? { currencies: cached.currencies } : {})
      }
    : { ...cached };
  const currencies = instruments("Currencies");
  if (!stale && currencies === undefined) return cached;
  if (currencies !== undefined) catalog.currencies = currencies;
  await cache.saveCatalog(catalog);
  return catalog;
}
