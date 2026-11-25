import { sanitizeDriveBackup } from "./drive/backup.js";
import { imageAsset, historyRecord, object, isTimeframe } from "./types.js";
import { decodeCandles } from "../model/history-codec.js";
import { isChartView, isDrawing, toBase64 } from "../model/backup-format.js";
import { isInstrumentSymbol } from "../model/instrument-symbol.js";
import type { Backup, ImageAsset, HistoryRecord } from "../model/types.js";
import { GUEST_SOURCE, GUEST_TARGET } from "./storage-guest-records.js";
import type { GuestRecords } from "./storage-guest-records.js";

const invalid = () => new Error("Повреждены прежние локальные данные.");
function own(value: unknown): Record<string, unknown> {
  const record = object(value);
  if (record?.owner !== GUEST_SOURCE) throw invalid();
  return record;
}
export interface GuestProjection {
  backup: Backup;
  images: ImageAsset[];
  history: HistoryRecord[];
  coverage: Record<string, unknown>[];
  cameras: Record<string, unknown>[];
  available: boolean;
}
/** Reuses the existing deep portable allowlist. Unknown auth/local fields never enter a copy/export. */
export function projectGuest(records: GuestRecords): GuestProjection {
  const layout = records.layout === undefined ? undefined : own(records.layout).value;
  const market = records.market === undefined ? undefined : object(own(records.market).value);
  if (records.market !== undefined && (!market || !Array.isArray(market.rows))) throw invalid();
  const watchlist =
    records.watchlist === undefined ? (market?.rows ?? []) : own(records.watchlist).value;
  const drawings = records.drawings.map((value) => {
    const raw = own(value);
    if (!Array.isArray(raw.items) || !raw.items.every(isDrawing)) throw invalid();
    return { symbol: raw.symbol, items: raw.items };
  });
  const views = records.views.map((value) => {
    const raw = own(value);
    return { key: raw.viewKey, value: raw.value };
  });
  const images = records.images.map((value) => {
    own(value);
    const image = imageAsset(value);
    if (!image) throw invalid();
    return image;
  });
  const backup = sanitizeDriveBackup({
    application: "personal-terminal",
    schemaVersion: 2,
    ...(layout !== undefined ? { layout } : {}),
    watchlist,
    drawings,
    views,
    images: images.map((image) => ({
      id: image.syncId ?? image.id,
      symbol: image.symbol,
      name: image.name,
      type: image.blob.type,
      point: image.point,
      width: image.width,
      data: "",
      ...(image.lock !== undefined ? { lock: image.lock } : {}),
      ...(image.visible !== undefined ? { visible: image.visible } : {}),
      ...(image.zOrder !== undefined ? { zOrder: image.zOrder } : {})
    }))
  });
  const history = records.history.map((value) => {
    own(value);
    const record = historyRecord(value);
    if (
      !record ||
      !record.uid.length ||
      record.uid.length > 200 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.day)
    )
      throw invalid();
    decodeCandles(record.data);
    return record;
  });
  const coverage = records.coverage.map((value) => {
    const raw = own(value);
    if (
      typeof raw.uid !== "string" ||
      raw.uid.length > 200 ||
      !isTimeframe(raw.timeframe) ||
      !Array.isArray(raw.ranges) ||
      raw.ranges.length > 100000
    )
      throw invalid();
    const ranges = raw.ranges.map((value) => {
      const range = object(value);
      if (
        !range ||
        typeof range.from !== "number" ||
        !Number.isFinite(range.from) ||
        typeof range.to !== "number" ||
        !Number.isFinite(range.to) ||
        range.from > range.to ||
        (range.fetchedAt !== undefined &&
          (typeof range.fetchedAt !== "number" || !Number.isFinite(range.fetchedAt)))
      )
        throw invalid();
      return {
        from: range.from,
        to: range.to,
        ...(range.fetchedAt !== undefined ? { fetchedAt: range.fetchedAt } : {})
      };
    });
    return {
      id: `${GUEST_TARGET}:${raw.uid}:${raw.timeframe}`,
      owner: GUEST_TARGET,
      uid: raw.uid,
      timeframe: raw.timeframe,
      ranges
    };
  });
  const cameras = records.cameras.map((value) => {
    const raw = own(value),
      camera = object(raw.value);
    if (
      typeof raw.id !== "string" ||
      !camera ||
      !isInstrumentSymbol(camera.symbol) ||
      !isChartView({ camera: camera.camera })
    )
      throw invalid();
    return {
      id: raw.id.replace("chart-camera:guest:", `chart-camera:${GUEST_TARGET}:`),
      owner: GUEST_TARGET,
      value: {
        symbol: camera.symbol,
        camera: {
          barSpace: object(camera.camera)?.barSpace,
          rightOffsetBars: object(camera.camera)?.rightOffsetBars
        }
      }
    };
  });
  return {
    backup,
    images,
    history,
    coverage,
    cameras,
    available:
      records.layout !== undefined ||
      records.watchlist !== undefined ||
      records.market !== undefined ||
      !!(
        drawings.length ||
        images.length ||
        views.length ||
        records.historyCount ||
        records.coverageCount ||
        coverage.length ||
        cameras.length
      )
  };
}
export async function guestExport(projection: GuestProjection, valid: () => void): Promise<Backup> {
  const backup = projection.backup;
  for (const [index, image] of projection.images.entries()) {
    valid();
    const data = await image.blob.arrayBuffer();
    valid();
    backup.images[index]!.data = toBase64(data);
  }
  backup.history = projection.history.map((record) => ({
    uid: record.uid,
    timeframe: record.timeframe,
    day: record.day,
    data: toBase64(record.data)
  }));
  valid();
  return { ...backup, exportedAt: new Date().toISOString() };
}
