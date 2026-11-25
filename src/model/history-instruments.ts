import type { MarketRow } from "./types.js";
import type { HistoryGroup } from "../services/storage-history.js";
import { NATIVE_TIMEFRAMES } from "./intervals/native-timeframes.js";

export interface HistoryInstrument {
  uid: string;
  name: string;
  ticker: string;
  bars: number;
  bytes: number;
  groups: HistoryGroup[];
}
const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");

/** UID preserves distinct trading instruments even when names or tickers coincide. */
export function historyInstruments(
  groups: readonly HistoryGroup[],
  rows: readonly MarketRow[],
  query: string,
  locale: string
): HistoryInstrument[] {
  const instruments = new Map<string, HistoryInstrument>();
  const rowByUid = new Map(rows.filter((row) => row.uid).map((row) => [row.uid, row]));
  for (const group of groups) {
    let item = instruments.get(group.uid);
    if (!item) {
      const row = rowByUid.get(group.uid);
      item = {
        uid: group.uid,
        name: row?.name ?? group.uid,
        ticker: row?.ticker || row?.symbol || "",
        bars: 0,
        bytes: 0,
        groups: []
      };
      instruments.set(group.uid, item);
    }
    item.bars += group.bars;
    item.bytes += group.bytes;
    item.groups.push(group);
  }
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const compare = new Intl.Collator(locale, { numeric: true, sensitivity: "base" }).compare;
  return [...instruments.values()]
    .filter((item) => {
      const text = normalize(`${item.name} ${item.ticker} ${item.uid}`);
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => compare(a.name, b.name) || compare(a.ticker, b.ticker) || compare(a.uid, b.uid))
    .map((item) => ({
      ...item,
      groups: item.groups.sort(
        (a, b) => NATIVE_TIMEFRAMES.indexOf(a.timeframe) - NATIVE_TIMEFRAMES.indexOf(b.timeframe)
      )
    }));
}
