import * as legacy from "./storage.js";
import { all } from "./storage-db.js";
import { imageAsset, historyRecord } from "./types.js";
import { mergeCandles, encodeCandles, decodeCandles } from "../model/history-codec.js";
import { toBase64, fromBase64 } from "../model/backup-format.js";
import { providerRefFromId } from "../model/market-provider.js";
import { physicalOwner, prepareProfileV2 } from "./storage-v2-migration.js";
import type {
  Backup,
  ChartView,
  Drawing,
  ImageAsset,
  MarketRow,
  ProfilePreferences,
  Timeframe,
  HistoryRange,
  Candle
} from "../model/types.js";
import type { BackupImportOptions } from "../model/backup-import.js";
import type { MarketCache } from "./types.js";
export {
  restoreSession,
  saveSession,
  clearSession,
  lastProfile,
  deviceKey,
  flush,
  usage,
  loadCatalog,
  saveCatalog
} from "./storage.js";
export { prepareProfileV2, copyPublicProfile, PUBLIC_OWNER } from "./storage-v2-migration.js";
export type { HistoryStats, HistoryGroup } from "./storage.js";
const prepared = async (owner: string) => {
  await prepareProfileV2(owner);
  return physicalOwner(owner);
};
export async function migrateLegacy(owner: string, name?: string) {
  await prepareProfileV2(owner);
  return legacy.migrateLegacy(physicalOwner(owner), name);
}
export async function loadPreferences(owner = "public") {
  return legacy.loadPreferences(await prepared(owner));
}
export async function savePreferences(owner: string, value: ProfilePreferences) {
  return legacy.savePreferences(await prepared(owner), value);
}
export async function loadWatchlist(owner: string) {
  return legacy.loadWatchlist(await prepared(owner));
}
export async function saveWatchlist(owner: string, rows: readonly MarketRow[]) {
  return legacy.saveWatchlist(await prepared(owner), rows);
}
export async function saveWatchlistSnapshot(owner: string, rows: readonly MarketRow[]) {
  return legacy.saveWatchlistSnapshot(await prepared(owner), rows);
}
export async function loadMarket(owner: string) {
  return legacy.loadMarket(await prepared(owner));
}
export async function saveMarket(owner: string, value: MarketCache) {
  return legacy.saveMarket(await prepared(owner), value);
}
export async function loadDrawings(owner: string, symbol: string) {
  return legacy.loadDrawings(await prepared(owner), symbol);
}
export async function saveDrawings(owner: string, symbol: string, items: readonly Drawing[]) {
  return legacy.saveDrawings(await prepared(owner), symbol, items);
}
export async function loadImages(owner: string, symbol: string) {
  return (await legacy.loadImages(await prepared(owner), symbol)).map((image) => ({
    ...image,
    owner
  }));
}
export async function saveImage(image: ImageAsset) {
  return legacy.saveImage({ ...image, owner: await prepared(image.owner) });
}
export const deleteImage = legacy.deleteImage;
export async function saveAnnotationDocument(
  owner: string,
  symbol: string,
  drawings: readonly Drawing[],
  images: readonly ImageAsset[]
) {
  if (images.some((image) => image.owner !== owner))
    throw new Error("Изображение принадлежит другому профилю.");
  const target = await prepared(owner);
  return legacy.saveAnnotationDocument(
    target,
    symbol,
    drawings,
    images.map((image) => ({ ...image, owner: target }))
  );
}
export async function loadView(owner: string, key: string) {
  return legacy.loadView(await prepared(owner), key);
}
export async function saveView(owner: string, key: string, value: ChartView) {
  return legacy.saveView(await prepared(owner), key, value);
}
export async function loadHistory(
  owner: string,
  uid: string,
  timeframe: Timeframe,
  from: number,
  to: number
): Promise<Candle[]> {
  const modern = await legacy.loadHistory(await prepared(owner), uid, timeframe, from, to);
  if (providerRefFromId(uid)) return modern;
  return mergeCandles(await legacy.loadHistory(owner, uid, timeframe, from, to), modern);
}
export async function loadCoverage(owner: string, uid: string, timeframe: Timeframe) {
  const modern = await legacy.loadCoverage(await prepared(owner), uid, timeframe);
  return providerRefFromId(uid)
    ? modern
    : [...(await legacy.loadCoverage(owner, uid, timeframe)), ...modern];
}
export async function saveHistory(
  owner: string,
  uid: string,
  timeframe: Timeframe,
  bars: readonly Candle[],
  coverage?: HistoryRange
) {
  return legacy.saveHistory(await prepared(owner), uid, timeframe, bars, coverage);
}
export async function historyStats(owner: string) {
  const [old, modern] = await Promise.all([
    legacy.historyStats(owner),
    legacy.historyStats(await prepared(owner))
  ]);
  const groups = new Map<string, legacy.HistoryGroup>();
  for (const item of [...old.groups, ...modern.groups]) {
    const key = `${item.uid}:${item.timeframe}`,
      previous = groups.get(key);
    groups.set(
      key,
      previous
        ? {
            ...item,
            bars: previous.bars + item.bars,
            bytes: previous.bytes + item.bytes,
            blocks: previous.blocks + item.blocks
          }
        : item
    );
  }
  return {
    bytes: old.bytes + modern.bytes,
    bars: old.bars + modern.bars,
    blocks: old.blocks + modern.blocks,
    groups: [...groups.values()]
  };
}
export async function clearHistory(
  owner: string,
  options: { uid?: string | null; timeframe?: Timeframe | null } = {}
) {
  const modern = await legacy.clearHistory(await prepared(owner), options);
  const old =
    options.uid && providerRefFromId(options.uid)
      ? { blocks: 0, bytes: 0 }
      : await legacy.clearHistory(owner, options);
  return { blocks: modern.blocks + old.blocks, bytes: modern.bytes + old.bytes };
}
export async function createBackup(
  owner: string,
  options: { includeHistory?: boolean } = {}
): Promise<Backup> {
  const backup = await legacy.createBackup(await prepared(owner), options);
  if (options.includeHistory)
    for (const value of await all("history")) {
      const block = historyRecord(value);
      if (block?.owner === owner && !providerRefFromId(block.uid)) {
        const existing = backup.history?.find(
          (item) =>
            item.uid === block.uid && item.timeframe === block.timeframe && item.day === block.day
        );
        if (existing)
          existing.data = toBase64(
            encodeCandles(
              mergeCandles(decodeCandles(block.data), decodeCandles(fromBase64(existing.data)))
            )
          );
        else
          backup.history?.push({
            uid: block.uid,
            timeframe: block.timeframe,
            day: block.day,
            data: toBase64(block.data)
          });
      }
    }
  return { ...backup, schemaVersion: 2 };
}
export async function importBackup(
  owner: string,
  input: unknown,
  options: BackupImportOptions = {}
) {
  return legacy.importBackup(await prepared(owner), input, options);
}
/** Test/inspection helper: physical records are never exposed as a different logical owner. */
export function logicalImage(value: unknown, owner: string): ImageAsset | undefined {
  const image = imageAsset(value);
  return image?.owner === physicalOwner(owner) ? { ...image, owner } : undefined;
}
