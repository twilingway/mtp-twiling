import { db } from "./storage-db.js";
import { requestValue, readGuestRecords, GUEST_DECISION } from "./storage-guest-records.js";
import { projectGuest } from "./storage-guest-projection.js";
import {
  object,
  imageAsset,
  historyRecord,
  normalizeLocalProfileSelection,
  isTimeframe
} from "./types.js";
import { validateBackup, isDrawing, isChartView, toBase64 } from "../model/backup-format.js";
import { isInstrumentSymbol, isInstrumentViewKey } from "../model/instrument-symbol.js";
import { isReservedProviderId, providerRefFromId } from "../model/market-provider.js";
import { decodeCandles } from "../model/history-codec.js";
import { isChartCamera } from "../charts/view-camera.js";
import { DEVICE_PHYSICAL_OWNER } from "../model/workspace-identity.js";
import type { WorkspaceSource } from "../model/workspace-identity-types.js";

export const WORKSPACE_STORES = [
  "preferences",
  "drawings",
  "images",
  "history",
  "coverage"
] as const;
export const ownerName = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const prefix = (key: string) => IDBKeyRange.bound(key, `${key}\uffff`);
const invalid = () => new Error("Некорректные локальные данные рабочего пространства.");
export async function discoverWorkspaceOwners(): Promise<{
  owners: string[];
  keys: string[];
  remembered?: string;
}> {
  const tx = db.transaction([...WORKSPACE_STORES]),
    pref = tx.objectStore("preferences");
  const [rawKeys, remembered, drawingKeys, historyKeys, coverageKeys, imageRecords] =
    await Promise.all([
      requestValue(pref.getAllKeys()),
      requestValue<unknown>(pref.get("last-profile")),
      requestValue(tx.objectStore("drawings").getAllKeys()),
      requestValue(tx.objectStore("history").getAllKeys()),
      requestValue(tx.objectStore("coverage").getAllKeys()),
      requestValue<unknown[]>(tx.objectStore("images").getAll())
    ]);
  const keys = rawKeys.filter((key): key is string => typeof key === "string");
  const owners = new Set<string>(["public"]);
  for (const key of [...drawingKeys, ...historyKeys, ...coverageKeys]) {
    const match =
      typeof key === "string" ? /^(?:profile-v2:)?([A-Za-z0-9_-]{1,200}):/.exec(key) : null;
    if (match?.[1] && match[1] !== "device") owners.add(match[1]);
  }
  for (const raw of imageRecords) {
    const owner = object(raw)?.owner;
    const logical = typeof owner === "string" ? owner.replace(/^profile-v2:/, "") : undefined;
    if (!ownerName(logical)) throw invalid();
    if (logical !== "device") owners.add(logical);
  }
  for (const key of keys) {
    const match =
      /^(?:layout:|watchlist:|market:|v2-profile-ready:|drive-v2:)(?:profile-v2:)?([A-Za-z0-9_-]{1,200})$/.exec(
        key
      );
    if (match?.[1] && match[1] !== "device") owners.add(match[1]);
    const viewOwner = /^(?:view:|chart-camera:)(?:profile-v2:)?([A-Za-z0-9_-]{1,200}):/.exec(key);
    if (viewOwner?.[1] && viewOwner[1] !== "device") owners.add(viewOwner[1]);
    const camera = /^workspace-camera(?:-shared)?:(\[.*\])$/.exec(key);
    if (camera) {
      try {
        const value: unknown = JSON.parse(camera[1]!);
        if (Array.isArray(value) && ownerName(value[0]) && value[0] !== "device")
          owners.add(value[0]);
      } catch {
        throw invalid();
      }
    }
  }
  const last = object(object(remembered)?.value)?.owner;
  if (ownerName(last) && last !== "device") owners.add(last);
  return { owners: [...owners].sort(), keys, ...(ownerName(last) ? { remembered: last } : {}) };
}
function checkOwner(raw: unknown, owner: string): Record<string, unknown> {
  const record = object(raw);
  if (!record || record.owner !== owner) throw invalid();
  return record;
}
function cameraRecord(raw: unknown, physical: string, logical: string): Record<string, unknown> {
  const record = object(raw);
  if (!record || typeof record.id !== "string") throw invalid();
  const id = record.id,
    value = object(record.value);
  if (!value) throw invalid();
  if (id.startsWith("workspace-camera:")) {
    const parts: unknown = JSON.parse(id.slice("workspace-camera:".length));
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      parts[0] !== logical ||
      !Number.isInteger(parts[1]) ||
      Number(parts[1]) < 1 ||
      Number(parts[1]) > 16 ||
      typeof parts[2] !== "string" ||
      !isInstrumentViewKey(parts[2]) ||
      !isChartView(value)
    )
      throw invalid();
    return {
      id: `workspace-camera:${JSON.stringify(["device", ...(parts as unknown[]).slice(1)])}`,
      value
    };
  }
  if (!isInstrumentSymbol(value.symbol) || !isChartCamera(value.camera)) throw invalid();
  if (id.startsWith("workspace-camera-shared:")) {
    const parts: unknown = JSON.parse(id.slice("workspace-camera-shared:".length));
    if (
      !Array.isArray(parts) ||
      parts.length !== 4 ||
      parts[0] !== logical ||
      !Number.isInteger(parts[1]) ||
      Number(parts[1]) < 1 ||
      Number(parts[1]) > 16 ||
      parts[2] !== value.symbol ||
      !["kline", "tradingview"].includes(String(parts[3])) ||
      !isTimeframe(value.timeframe)
    )
      throw invalid();
    return {
      id: `workspace-camera-shared:${JSON.stringify(["device", ...(parts as unknown[]).slice(1)])}`,
      owner: "device",
      value
    };
  }
  if (record.owner !== physical || !id.startsWith(`chart-camera:${physical}:`)) throw invalid();
  const suffix = id.slice(`chart-camera:${physical}:`.length);
  if (
    !/^(kline|tradingview)(:.*)?$/.test(suffix) ||
    (value.timeframe !== undefined && !isTimeframe(value.timeframe))
  )
    throw invalid();
  return {
    id: `chart-camera:${DEVICE_PHYSICAL_OWNER}:${suffix}`,
    owner: DEVICE_PHYSICAL_OWNER,
    value
  };
}
export async function readWorkspaceSource(
  owner: string,
  keys: readonly string[]
): Promise<WorkspaceSource> {
  const tx = db.transaction([...WORKSPACE_STORES], "readonly"),
    pref = tx.objectStore("preferences");
  const marker = await requestValue<unknown>(pref.get(`v2-profile-ready:${owner}`));
  const decision =
    owner === "guest" ? await requestValue<unknown>(pref.get(GUEST_DECISION)) : undefined;
  if (
    marker !== undefined &&
    (object(marker)?.value !== true || object(marker)?.owner !== `profile-v2:${owner}`)
  )
    throw invalid();
  const physical = owner === "guest" || marker === undefined ? owner : `profile-v2:${owner}`;
  if (owner === "guest") {
    const status = object(object(decision)?.value)?.status;
    if (
      decision !== undefined &&
      !["copied", "source-empty", "target-occupied"].includes(String(status))
    )
      throw invalid();
    if (status === "copied" || status === "source-empty")
      return {
        owner,
        physical,
        backup: validateBackup({
          application: "personal-terminal",
          schemaVersion: 2,
          drawings: [],
          images: []
        }),
        images: [],
        cameras: [],
        history: [],
        coverage: [],
        populated: false
      };
    const records = await readGuestRecords(tx, true);
    projectGuest(records); // Exact legacy projection validates recovery semantics without adopting/seeding.
  }
  const cameraKeys = keys.filter(
    (key) =>
      key.startsWith(`chart-camera:${physical}:`) ||
      key.startsWith(`workspace-camera:[${JSON.stringify(owner)},`) ||
      key.startsWith(`workspace-camera-shared:[${JSON.stringify(owner)},`)
  );
  if (physical !== owner)
    cameraKeys.push(...keys.filter((key) => key.startsWith(`chart-camera:${owner}:`)));
  const [
    layout,
    watchlist,
    market,
    views,
    drawings,
    images,
    history,
    coverage,
    cameras,
    rawHistory,
    rawCoverage
  ] = await Promise.all([
    requestValue<unknown>(pref.get(`layout:${physical}`)),
    requestValue<unknown>(pref.get(`watchlist:${physical}`)),
    requestValue<unknown>(pref.get(`market:${physical}`)),
    requestValue<unknown[]>(pref.getAll(prefix(`view:${physical}:`))),
    requestValue<unknown[]>(tx.objectStore("drawings").getAll(prefix(`${physical}:`))),
    requestValue<unknown[]>(
      tx
        .objectStore("images")
        .index("ownerSymbol")
        .getAll(IDBKeyRange.bound([physical], [physical, []]))
    ),
    requestValue<unknown[]>(tx.objectStore("history").getAll(prefix(`${physical}:`))),
    requestValue<unknown[]>(tx.objectStore("coverage").getAll(prefix(`${physical}:`))),
    Promise.all(cameraKeys.map((key) => requestValue<unknown>(pref.get(key)))),
    physical !== owner
      ? requestValue<unknown[]>(tx.objectStore("history").getAll(prefix(`${owner}:`)))
      : Promise.resolve([]),
    physical !== owner
      ? requestValue<unknown[]>(tx.objectStore("coverage").getAll(prefix(`${owner}:`)))
      : Promise.resolve([])
  ]);
  const layoutValue =
    layout === undefined
      ? undefined
      : normalizeLocalProfileSelection(checkOwner(layout, physical).value);
  const marketValue = market === undefined ? undefined : object(checkOwner(market, physical).value);
  if (
    market !== undefined &&
    (!marketValue || !Number.isFinite(marketValue.at) || !Array.isArray(marketValue.rows))
  )
    throw invalid();
  const rows =
    watchlist === undefined ? (marketValue?.rows ?? []) : checkOwner(watchlist, physical).value;
  const assets = images.map((raw) => {
    const image = imageAsset(raw);
    if (!image || image.owner !== physical) throw invalid();
    return image;
  });
  const backup = validateBackup({
    application: "personal-terminal",
    schemaVersion: 2,
    ...(layoutValue === undefined ? {} : { layout: layoutValue }),
    watchlist: rows,
    drawings: drawings.map((raw) => {
      const doc = checkOwner(raw, physical);
      if (!Array.isArray(doc.items) || !doc.items.every(isDrawing)) throw invalid();
      return { symbol: doc.symbol, items: doc.items };
    }),
    views: views.map((raw) => {
      const view = checkOwner(raw, physical);
      return { key: view.viewKey, value: view.value };
    }),
    images: assets.map((image) => ({
      id: image.syncId ?? image.id,
      symbol: image.symbol,
      name: image.name,
      type: image.blob.type,
      data: "",
      point: image.point,
      width: image.width
    }))
  });
  // Validate market even when an explicit watchlist takes precedence; never silently discard corruption.
  if (marketValue)
    validateBackup({
      application: "personal-terminal",
      schemaVersion: 2,
      drawings: [],
      images: [],
      watchlist: marketValue.rows
    });
  const validUid = (uid: unknown) =>
    typeof uid === "string" &&
    uid.length > 0 &&
    uid.length <= 200 &&
    (!isReservedProviderId(uid) || !!providerRefFromId(uid));
  const blocks = [...history, ...rawHistory].map((raw) => {
    const record = historyRecord(raw);
    if (
      !record ||
      ![owner, physical].includes(record.owner) ||
      !validUid(record.uid) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.day) ||
      record.id !== `${record.owner}:${record.uid}:${record.timeframe}:${record.day}`
    )
      throw invalid();
    decodeCandles(record.data);
    return { ...record };
  });
  const ranges = [...rawCoverage, ...coverage].map((raw) => {
    const record = object(raw);
    if (
      !record ||
      typeof record.owner !== "string" ||
      ![owner, physical].includes(record.owner) ||
      !validUid(record.uid) ||
      !isTimeframe(record.timeframe) ||
      record.id !== `${String(record.owner)}:${String(record.uid)}:${record.timeframe}` ||
      !Array.isArray(record.ranges) ||
      record.ranges.length > 100000
    )
      throw invalid();
    if (
      !record.ranges.every((entry: unknown) => {
        const range = object(entry);
        return (
          range &&
          Number.isFinite(range.from) &&
          Number.isFinite(range.to) &&
          Number(range.from) <= Number(range.to) &&
          (range.fetchedAt === undefined || Number.isFinite(range.fetchedAt))
        );
      })
    )
      throw invalid();
    return record;
  });
  return {
    owner,
    physical,
    backup,
    images: await Promise.all(
      assets.map(async (image) => ({
        image,
        content: JSON.stringify({
          symbol: image.symbol,
          name: image.name,
          type: image.blob.type,
          point: image.point,
          width: image.width,
          lock: image.lock,
          visible: image.visible,
          zOrder: image.zOrder,
          data: toBase64(await image.blob.arrayBuffer())
        })
      }))
    ),
    history: blocks,
    coverage: ranges,
    cameras: cameras.map((raw) =>
      cameraRecord(
        raw,
        typeof object(raw)?.id === "string" &&
          String(object(raw)?.id).startsWith(`chart-camera:${owner}:`)
          ? owner
          : physical,
        owner
      )
    ),
    populated: !!(
      layoutValue !== undefined ||
      (backup.watchlist?.length ?? 0) ||
      drawings.length ||
      assets.length ||
      views.length ||
      blocks.length ||
      ranges.length ||
      cameras.length
    )
  };
}
