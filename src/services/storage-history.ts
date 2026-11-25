import { encodeCandles, decodeCandles, mergeCandles } from "../model/history-codec.js";
import type { Candle, HistoryRange, HistoryRecord, Timeframe } from "../model/types.js";
import { db, get, track, transaction } from "./storage-db.js";
import { historyRecord, list, normaliseRanges, object } from "./types.js";

export async function loadCoverage(
  owner: string,
  uid: string,
  timeframe: Timeframe
): Promise<HistoryRange[]> {
  return normaliseRanges(object(await get("coverage", `${owner}:${uid}:${timeframe}`))?.ranges);
}
export function loadHistory(
  owner: string,
  uid: string,
  timeframe: Timeframe,
  from: number,
  to: number
): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const bounds = IDBKeyRange.bound(
      [owner, uid, timeframe, new Date(from).toISOString().slice(0, 10)],
      [owner, uid, timeframe, new Date(to).toISOString().slice(0, 10)]
    );
    const request = db
      .transaction("history")
      .objectStore("history")
      .index("seriesDay")
      .getAll(bounds);
    request.onsuccess = () => {
      try {
        const result: unknown = request.result;
        const blocks = list(result).map((value) => {
          const block = historyRecord(value);
          if (!block) throw new Error("Повреждённый блок истории.");
          return decodeCandles(block.data);
        });
        resolve(
          mergeCandles(...blocks).filter((bar) => bar.timestamp >= from && bar.timestamp <= to)
        );
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("IndexedDB operation failed.", { cause: error })
        );
      }
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
export interface HistoryGroup {
  uid: string;
  timeframe: Timeframe;
  bytes: number;
  bars: number;
  blocks: number;
}
export interface HistoryStats {
  bytes: number;
  bars: number;
  blocks: number;
  groups: HistoryGroup[];
}
export function historyStats(owner: string): Promise<HistoryStats> {
  return new Promise((resolve, reject) => {
    const groups = new Map<string, HistoryGroup>();
    let bytes = 0,
      bars = 0,
      blocks = 0;
    const request = db.transaction("history").objectStore("history").openCursor();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ bytes, bars, blocks, groups: [...groups.values()] });
        return;
      }
      const value: unknown = cursor.value,
        block = historyRecord(value);
      if (block?.owner === owner) {
        const size = block.data.byteLength,
          count = size / 48;
        bytes += size;
        bars += count;
        blocks++;
        const id = `${block.uid}:${block.timeframe}`;
        const group = groups.get(id) ?? {
          uid: block.uid,
          timeframe: block.timeframe,
          bytes: 0,
          bars: 0,
          blocks: 0
        };
        group.bytes += size;
        group.bars += count;
        group.blocks++;
        groups.set(id, group);
      }
      cursor.continue();
    };
  });
}
let historyQueue: Promise<void> = Promise.resolve();
export async function clearHistory(
  owner: string,
  { uid = null, timeframe = null }: { uid?: string | null; timeframe?: Timeframe | null } = {}
): Promise<{ blocks: number; bytes: number }> {
  await historyQueue;
  let blocks = 0,
    bytes = 0;
  await transaction(["history", "coverage"], (tx) => {
    for (const name of ["history", "coverage"] as const) {
      const request = tx.objectStore(name).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value: unknown = cursor.value,
          record = object(value);
        if (
          record?.owner === owner &&
          (!uid || record.uid === uid) &&
          (!timeframe || record.timeframe === timeframe)
        ) {
          if (name === "history") {
            blocks++;
            if (record.data instanceof ArrayBuffer) bytes += record.data.byteLength;
          }
          cursor.delete();
        }
        cursor.continue();
      };
    }
  });
  return { blocks, bytes };
}
export function saveHistory(
  owner: string,
  uid: string,
  timeframe: Timeframe,
  bars: readonly Candle[],
  coverage?: HistoryRange
): Promise<void> {
  const operation = async () => {
    const groups = new Map<string, Candle[]>();
    for (const bar of bars) {
      const day = new Date(bar.timestamp).toISOString().slice(0, 10),
        group = groups.get(day) ?? [];
      group.push(bar);
      groups.set(day, group);
    }
    const blocks: HistoryRecord[] = [];
    for (const [day, next] of groups) {
      const id = `${owner}:${uid}:${timeframe}:${day}`;
      const stored = await get("history", id),
        previous = historyRecord(stored);
      if (stored !== undefined && !previous) throw new Error("Повреждённый блок истории.");
      blocks.push({
        id,
        owner,
        uid,
        timeframe,
        day,
        data: encodeCandles(mergeCandles(previous ? decodeCandles(previous.data) : [], next)),
        updatedAt: Date.now()
      });
    }
    let ranges: HistoryRange[] | undefined;
    if (coverage) {
      const old = await loadCoverage(owner, uid, timeframe);
      ranges = [...old, coverage]
        .sort((a, b) => a.from - b.from)
        .reduce<HistoryRange[]>((out, range) => {
          const last = out.at(-1);
          if (last && range.from <= last.to) {
            last.to = Math.max(last.to, range.to);
            last.fetchedAt = Math.max(last.fetchedAt ?? 0, range.fetchedAt ?? 0);
          } else out.push({ ...range });
          return out;
        }, []);
    }
    await transaction(["history", "coverage"], (tx) => {
      for (const block of blocks) tx.objectStore("history").put(block);
      if (ranges)
        tx.objectStore("coverage").put({
          id: `${owner}:${uid}:${timeframe}`,
          owner,
          uid,
          timeframe,
          ranges
        });
    });
  };
  const result = historyQueue.then(operation, operation);
  historyQueue = result.catch(() => {});
  return track(result);
}
