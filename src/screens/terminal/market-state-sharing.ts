import type { MarketRow } from "../../model/types.js";
import { shallowEqual } from "./snapshot-selector.js";
import type { TerminalState } from "./state.js";

const rowKey = (row: MarketRow) => JSON.stringify([row.uid, row.symbol, row.classCode]);

/** Market clients mutate quote rows; keep detached snapshots and reuse unchanged instruments. */
export function shareMarketRows(state: TerminalState, latest: readonly MarketRow[]) {
  const before = new Map(state.rows.map((row) => [rowKey(row), row]));
  let directions: Map<string, "positive" | "negative"> | undefined;
  const rows = latest.map((row) => {
    const previous = before.get(rowKey(row));
    if (previous?.price != null && row.price != null && previous.price !== row.price) {
      const direction = row.price > previous.price ? "positive" : "negative";
      if ((directions ?? state.pricesDirection).get(row.symbol) !== direction) {
        directions ??= new Map(state.pricesDirection);
        directions.set(row.symbol, direction);
      }
    }
    return previous && shallowEqual(previous, row) ? previous : { ...row };
  });
  return {
    rows:
      rows.length === state.rows.length && rows.every((row, index) => row === state.rows[index])
        ? state.rows
        : rows,
    pricesDirection: directions ?? state.pricesDirection
  };
}
