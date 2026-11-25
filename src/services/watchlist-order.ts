import type { MarketRow } from "../model/types.js";
import type { Cache } from "./types.js";

export interface WatchlistPosition {
  index: number;
  uid: string | null;
  symbol: string;
}
export interface WatchlistMove {
  source: WatchlistPosition;
  target: WatchlistPosition;
  placement: "before" | "after";
}

/** Indices address duplicate imported UIDs; identity guards reject stale positions. */
export function moveWatchlistRow(
  rows: readonly MarketRow[],
  move: WatchlistMove
): MarketRow[] | null {
  const matches = (position: WatchlistPosition) => {
    const row = rows[position.index];
    return (
      Number.isInteger(position.index) &&
      row !== undefined &&
      row.uid === position.uid &&
      row.symbol === position.symbol
    );
  };
  const { source, target, placement } = move;
  if (!matches(source) || !matches(target) || source.index === target.index) return null;
  const insertion = target.index + (placement === "after" ? 1 : 0);
  const destination = insertion - (source.index < insertion ? 1 : 0);
  const result = [...rows];
  const [row] = result.splice(source.index, 1);
  if (!row) return null;
  result.splice(destination, 0, row);
  return result;
}

export async function persistWatchlistMove(
  client: { rows: MarketRow[]; owner: string },
  cache: Cache,
  notify: () => void,
  move: WatchlistMove
): Promise<boolean> {
  const rows = moveWatchlistRow(client.rows, move);
  if (!rows) return false;
  await cache.saveWatchlistSnapshot(client.owner, rows);
  client.rows = rows;
  notify();
  return true;
}
