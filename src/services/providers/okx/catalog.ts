import type { OkxHttp } from "./http.js";
import type { OkxCategory, OkxInstrument } from "./types.js";
import {
  OkxError,
  okxInstrumentRef,
  okxInstrumentType,
  okxPositiveDecimal,
  okxRecord,
  okxSeriesId,
  okxTimestamp
} from "./types.js";

function coin(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]+$/.test(value);
}

export function normaliseOkxInstrument(
  category: OkxCategory,
  value: unknown
): OkxInstrument | null {
  const row = okxRecord(value);
  if (
    row.instType !== okxInstrumentType(category) ||
    typeof row.instId !== "string" ||
    !row.instId ||
    typeof row.state !== "string" ||
    typeof row.instCategory !== "string"
  )
    throw new OkxError("protocol", "Incomplete OKX instrument metadata");
  if (row.state !== "live" || row.instCategory !== "1") return null;

  const spot = category === "spot";
  if (!spot && (typeof row.settleCcy !== "string" || typeof row.ctType !== "string"))
    throw new OkxError("protocol", "Missing OKX swap settlement or contract type");
  if (!spot && (row.settleCcy !== "USDT" || row.ctType !== "linear")) return null;

  const baseCoin = spot ? row.baseCcy : /^([A-Z0-9]+)-USDT-SWAP$/.exec(row.instId)?.[1];
  const quoteCoin = spot ? row.quoteCcy : "USDT";
  if (!coin(baseCoin) || !coin(quoteCoin))
    throw new OkxError("protocol", "Incomplete OKX currency pair");
  const pair = `${baseCoin}-${quoteCoin}`;
  if (spot ? row.instId !== pair : row.uly !== pair || row.instFamily !== pair)
    throw new OkxError("protocol", "OKX instrument does not match its currency pair");

  return {
    ref: okxInstrumentRef(category, row.instId),
    baseCoin,
    quoteCoin,
    settleCoin: spot ? null : "USDT",
    tickSize: okxPositiveDecimal(row.tickSz),
    launchTime: okxTimestamp(row.listTime)
  };
}

export async function loadOkxCatalog(
  http: Pick<OkxHttp, "get">,
  signal?: AbortSignal
): Promise<readonly OkxInstrument[]> {
  const markets = await Promise.all(
    (["spot", "linear"] as const).map(async (category) => {
      const rows = await http.get(
        "/api/v5/public/instruments",
        { instType: okxInstrumentType(category) },
        signal
      );
      signal?.throwIfAborted();
      const seen = new Set<string>();
      const market: OkxInstrument[] = [];
      for (const row of rows) {
        const item = normaliseOkxInstrument(category, row);
        if (!item) continue;
        const key = okxSeriesId(item.ref);
        if (seen.has(key)) throw new OkxError("protocol", "Duplicate OKX catalog instrument");
        seen.add(key);
        market.push(item);
      }
      if (!market.length) throw new OkxError("protocol", "Incomplete OKX catalog");
      return market;
    })
  );
  signal?.throwIfAborted();
  return markets.flat();
}
