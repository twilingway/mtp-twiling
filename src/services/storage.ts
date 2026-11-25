import { decodeCandles } from "../model/history-codec.js";
import { assertImportCurrent, type BackupImportOptions } from "../model/backup-import.js";
import { replacePortableRecords } from "./storage-portable.js";
import { driveCredentialId } from "./drive/auth-credential-id.js";
import { db, get, all, put, transaction, flush } from "./storage-db.js";
export { flush } from "./storage-db.js";
export {
  loadCoverage,
  loadHistory,
  historyStats,
  clearHistory,
  saveHistory
} from "./storage-history.js";
export type { HistoryGroup, HistoryStats } from "./storage-history.js";
import { validateBackup, toBase64, fromBase64, isDrawing } from "../model/backup-format.js";
import type {
  Backup,
  Catalog,
  ChartView,
  Drawing,
  ImageAsset,
  MarketRow,
  ProfilePreferences
} from "../model/types.js";
import {
  historyRecord,
  imageAsset,
  list,
  normaliseCatalog,
  normaliseMarket,
  normaliseRows,
  object,
  text
} from "./types.js";
import type { MarketCache } from "./types.js";

function validatePart(part: Record<string, unknown>) {
  return validateBackup({
    application: "personal-terminal",
    schemaVersion: 1,
    drawings: [],
    images: [],
    ...part
  });
}
export async function loadPreferences(owner = "guest"): Promise<ProfilePreferences> {
  const record = object(await get("preferences", `layout:${owner}`));
  return validatePart({ layout: record?.value ?? {} }).layout ?? {};
}
export function savePreferences(owner: string, value: ProfilePreferences): Promise<void> {
  return put("preferences", { id: `layout:${owner}`, owner, value });
}
export async function loadDrawings(owner: string, symbol: string): Promise<Drawing[]> {
  const record = object(await get("drawings", `${owner}:${symbol}`));
  if (!record) return [];
  const items = list(record.items);
  if (!items.every(isDrawing)) throw new Error("Повреждённая разметка.");
  return items;
}
export function saveDrawings(
  owner: string,
  symbol: string,
  items: readonly Drawing[]
): Promise<void> {
  return put("drawings", { id: `${owner}:${symbol}`, owner, symbol, items, updatedAt: Date.now() });
}
export function saveImage(image: ImageAsset): Promise<void> {
  return put("images", image);
}
export async function saveAnnotationDocument(
  owner: string,
  symbol: string,
  drawings: readonly Drawing[],
  images: readonly ImageAsset[]
): Promise<void> {
  if (images.some((image) => image.owner !== owner || image.symbol !== symbol))
    throw new Error("Изображение принадлежит другому профилю или инструменту.");
  const previous = await loadImages(owner, symbol);
  const ids = new Set(images.map((image) => image.id));
  await transaction(["drawings", "images"], (tx) => {
    tx.objectStore("drawings").put({
      id: `${owner}:${symbol}`,
      owner,
      symbol,
      items: drawings,
      updatedAt: Date.now()
    });
    for (const image of previous) if (!ids.has(image.id)) tx.objectStore("images").delete(image.id);
    for (const image of images) tx.objectStore("images").put(image);
  });
}
export function deleteImage(id: string): Promise<void> {
  return transaction(["images"], (tx) => {
    tx.objectStore("images").delete(id);
  });
}
export function loadImages(owner: string, symbol: string): Promise<ImageAsset[]> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("images")
      .objectStore("images")
      .index("ownerSymbol")
      .getAll(IDBKeyRange.only([owner, symbol]));
    request.onsuccess = () => {
      const result: unknown = request.result;
      resolve(
        list(result).flatMap((value) => {
          const image = imageAsset(value);
          return image ? [image] : [];
        })
      );
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
export async function usage(): Promise<StorageEstimate> {
  return (await navigator.storage?.estimate?.()) ?? {};
}
export async function loadCatalog(): Promise<Catalog | undefined> {
  return normaliseCatalog(object(await get("preferences", "catalog"))?.value);
}
export function saveCatalog(value: Catalog): Promise<void> {
  return put("preferences", { id: "catalog", value });
}
export async function loadMarket(owner: string): Promise<MarketCache | undefined> {
  return normaliseMarket(object(await get("preferences", `market:${owner}`))?.value);
}
export function saveMarket(owner: string, value: MarketCache): Promise<void> {
  return put("preferences", { id: `market:${owner}`, owner, value });
}
export async function loadWatchlist(owner: string): Promise<MarketRow[] | undefined> {
  const record = object(await get("preferences", `watchlist:${owner}`));
  return record && Array.isArray(record.value) ? normaliseRows(record.value) : undefined;
}
export function saveWatchlist(owner: string, value: readonly MarketRow[]): Promise<void> {
  return put("preferences", { id: `watchlist:${owner}`, owner, value });
}
export function saveWatchlistSnapshot(owner: string, rows: readonly MarketRow[]): Promise<void> {
  return transaction(["preferences"], (tx) => {
    const store = tx.objectStore("preferences");
    store.put({ id: `watchlist:${owner}`, owner, value: rows });
    store.put({ id: `market:${owner}`, owner, value: { rows, at: Date.now() } });
  });
}
export function saveView(owner: string, key: string, value: ChartView): Promise<void> {
  return put("preferences", { id: `view:${owner}:${key}`, owner, viewKey: key, value });
}
export async function loadView(owner: string, key: string): Promise<ChartView | undefined> {
  const record = object(await get("preferences", `view:${owner}:${key}`));
  if (!record) return undefined;
  return validatePart({ views: [{ key, value: record.value }] }).views?.[0]?.value;
}
let deviceKeyPending: Promise<CryptoKey> | undefined;
/** One non-extractable key shared by bank and Google credentials on this origin. */
export function deviceKey(): Promise<CryptoKey> {
  if (!deviceKeyPending)
    deviceKeyPending = loadDeviceKey().catch((error: unknown) => {
      deviceKeyPending = undefined;
      throw error;
    });
  return deviceKeyPending;
}
async function loadDeviceKey(): Promise<CryptoKey> {
  const record = object(await get("vault", "device-key"));
  if (record) {
    if (!(record.key instanceof CryptoKey)) throw new Error("Повреждён ключ устройства.");
    return record.key;
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
  let selected = key;
  await transaction(["vault"], (tx) => {
    const store = tx.objectStore("vault"),
      request = store.get("device-key");
    request.onsuccess = () => {
      const existing = object(request.result);
      if (existing?.key instanceof CryptoKey) selected = existing.key;
      else if (existing) tx.abort();
      else store.add({ id: "device-key", key });
    };
  });
  return selected;
}
interface Sealed {
  iv: string;
  data: string;
}
async function seal(token: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deviceKey(),
    new TextEncoder().encode(token)
  );
  return { iv: toBase64(iv.buffer), data: toBase64(data) };
}
async function unseal(value: Sealed): Promise<string> {
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(fromBase64(value.iv)) },
    await deviceKey(),
    fromBase64(value.data)
  );
  return new TextDecoder().decode(data);
}
export interface Session {
  token: string;
  owner: string;
  name: string;
}
export async function saveSession({
  token,
  owner,
  name,
  remember
}: Session & { remember: boolean }): Promise<void> {
  const encrypted = await seal(token),
    record = { id: "remembered", owner, name, ...encrypted };
  sessionStorage.setItem("terminal-session", JSON.stringify(record));
  if (remember) await put("vault", record);
  else
    await transaction(["vault"], (tx) => {
      tx.objectStore("vault").delete("remembered");
    });
  await put("preferences", { id: "last-profile", value: { owner, name } });
}
export async function restoreSession(): Promise<Session | null> {
  try {
    const session = sessionStorage.getItem("terminal-session");
    const value: unknown = session ? JSON.parse(session) : await get("vault", "remembered");
    const record = object(value);
    if (
      !record ||
      typeof record.iv !== "string" ||
      typeof record.data !== "string" ||
      typeof record.name !== "string" ||
      typeof record.owner !== "string"
    )
      return null;
    return {
      token: await unseal({ iv: record.iv, data: record.data }),
      name: record.name,
      owner: record.owner
    };
  } catch {
    return null;
  }
}
export function clearSession(owner?: string): Promise<void> {
  sessionStorage.removeItem("terminal-session");
  return transaction(["vault"], (tx) => {
    tx.objectStore("vault").delete("remembered");
    if (owner) tx.objectStore("vault").delete(driveCredentialId(owner));
  });
}
export async function lastProfile(): Promise<{ owner: string; name: string } | undefined> {
  const value = object(object(await get("preferences", "last-profile"))?.value);
  return value && typeof value.owner === "string" && typeof value.name === "string"
    ? { owner: value.owner, name: value.name }
    : undefined;
}
export async function createBackup(
  owner: string,
  { includeHistory = false }: { includeHistory?: boolean } = {}
): Promise<Backup> {
  await flush();
  const drawingRecords = (await all("drawings"))
    .map(object)
    .filter((record) => record?.owner === owner);
  const drawings = drawingRecords.map((record) => ({
    symbol: text(record?.symbol) ?? "",
    items: record?.items
  }));
  const validDrawings = validatePart({ drawings }).drawings;
  const images = [];
  for (const value of await all("images")) {
    const image = imageAsset(value);
    if (image?.owner === owner)
      images.push({
        id: image.syncId ?? image.id,
        symbol: image.symbol,
        name: image.name,
        type: image.blob.type,
        point: image.point,
        width: image.width,
        ...(image.lock !== undefined ? { lock: image.lock } : {}),
        ...(image.visible !== undefined ? { visible: image.visible } : {}),
        ...(image.zOrder !== undefined ? { zOrder: image.zOrder } : {}),
        data: toBase64(await image.blob.arrayBuffer())
      });
  }
  const views = (await all("preferences"))
    .map(object)
    .filter((record) => record?.owner === owner && typeof record.viewKey === "string")
    .map((record) => ({ key: record?.viewKey, value: record?.value }));
  const validViews = validatePart({ views }).views ?? [];
  const history = includeHistory
    ? (await all("history")).flatMap((value) => {
        const block = historyRecord(value);
        return block?.owner === owner
          ? [
              {
                uid: block.uid,
                timeframe: block.timeframe,
                day: block.day,
                data: toBase64(block.data)
              }
            ]
          : [];
      })
    : [];
  return {
    application: "personal-terminal" as const,
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    layout: await loadPreferences(owner),
    watchlist: (await loadWatchlist(owner)) ?? [],
    drawings: validDrawings,
    images,
    views: validViews,
    history
  };
}
export async function importBackup(
  owner: string,
  input: unknown,
  options: BackupImportOptions = {}
): Promise<{ drawings: number; images: number; history: number }> {
  const data = validateBackup(input);
  const signal = options.replacePortable ? options.signal : undefined;
  if (options.replacePortable && (!data.layout || !data.watchlist || !data.views))
    throw new Error("Для синхронизации нужен полный снимок настроек.");
  assertImportCurrent(options.valid, signal);
  const existingImages = (await all("images"))
    .map(imageAsset)
    .filter((image) => image?.owner === owner);
  const images: ImageAsset[] = data.images.map((image) => ({
    id:
      existingImages.find(
        (previous) =>
          previous &&
          image.id &&
          (previous.syncId ?? previous.id) === image.id &&
          previous.symbol === image.symbol
      )?.id ?? crypto.randomUUID(),
    ...(image.id ? { syncId: image.id } : {}),
    owner,
    symbol: image.symbol,
    name: image.name ?? "",
    point: image.point,
    width: image.width,
    ...(image.lock !== undefined ? { lock: image.lock } : {}),
    ...(image.visible !== undefined ? { visible: image.visible } : {}),
    ...(image.zOrder !== undefined ? { zOrder: image.zOrder } : {}),
    blob: new Blob([fromBase64(image.data)], { type: image.type })
  }));
  const history = (options.replacePortable ? [] : (data.history ?? [])).map((block) => {
    const buffer = fromBase64(block.data);
    decodeCandles(buffer);
    return {
      ...block,
      id: `${owner}:${block.uid}:${block.timeframe}:${block.day}`,
      owner,
      data: buffer
    };
  });
  const drawings: {
    id: string;
    owner: string;
    symbol: string;
    items: Drawing[];
    updatedAt: number;
  }[] = [];
  for (const document of data.drawings) {
    const existing = options.replacePortable ? [] : await loadDrawings(owner, document.symbol),
      ids = new Set(existing.map((item) => item.id));
    const merged = [
      ...existing,
      ...document.items
        .filter((item) => !item.id || !ids.has(item.id))
        .map((item) => ({ ...item, id: item.id || crypto.randomUUID() }))
    ];
    drawings.push({
      id: `${owner}:${document.symbol}`,
      owner,
      symbol: document.symbol,
      items: merged,
      updatedAt: Date.now()
    });
  }
  assertImportCurrent(options.valid, signal);
  await transaction(
    ["preferences", "drawings", "images", "history"],
    (tx) => {
      assertImportCurrent(options.valid, signal);
      const write = () => {
        tx.objectStore("preferences").put({
          id: `layout:${owner}`,
          owner,
          value: data.layout ?? {}
        });
        if (data.watchlist !== undefined) {
          tx.objectStore("preferences").put({
            id: `watchlist:${owner}`,
            owner,
            value: data.watchlist
          });
          tx.objectStore("preferences").put({
            id: `market:${owner}`,
            owner,
            value: { rows: data.watchlist, at: Date.now() }
          });
        }
        for (const view of data.views ?? []) {
          if (view.key.length > 200) throw new Error("Некорректный вид графика.");
          tx.objectStore("preferences").put({
            id: `view:${owner}:${view.key}`,
            owner,
            viewKey: view.key,
            value: view.value
          });
        }
        for (const record of drawings) tx.objectStore("drawings").put(record);
        for (const image of images) tx.objectStore("images").put(image);
        for (const block of history) tx.objectStore("history").put(block);
      };
      if (options.replacePortable)
        replacePortableRecords(tx, owner, write, options.valid ?? (() => true));
      else write();
    },
    signal
  );
  return {
    drawings: drawings.reduce((sum, item) => sum + item.items.length, 0),
    images: images.length,
    history: history.length
  };
}
export async function migrateLegacy(owner: string, accountName?: string): Promise<void> {
  let preference: string | null;
  try {
    preference = localStorage.getItem("terminal.preferences.v1");
  } catch {
    return;
  }
  if (preference) {
    try {
      const value: unknown = JSON.parse(preference);
      if (!Object.keys(await loadPreferences(owner)).length)
        await savePreferences(owner, validatePart({ layout: value }).layout ?? {});
      localStorage.removeItem("terminal.preferences.v1");
    } catch {
      /* Retain unsupported legacy data. */
    }
  }
  if (!accountName) return;
  const aliases = [accountName];
  for (const encoding of ["ibm866", "windows-1251"]) {
    try {
      aliases.push(new TextDecoder(encoding).decode(new TextEncoder().encode(accountName)));
    } catch {
      /* Optional old encoding. */
    }
  }
  const prefixes = aliases.map((name) => `terminal.drawings.v1:${name}:`);
  for (const key of Object.keys(localStorage).filter((key) =>
    prefixes.some((prefix) => key.startsWith(prefix))
  )) {
    try {
      const prefix = prefixes.find((prefix) => key.startsWith(prefix));
      if (!prefix) continue;
      const symbol = key.slice(prefix.length).split(":").slice(1).join(":");
      if (!symbol) continue;
      const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      const old = validatePart({ drawings: [{ symbol, items: value }] }).drawings[0]?.items ?? [];
      const items = await loadDrawings(owner, symbol);
      for (const item of old)
        if (
          !items.some(
            (other) =>
              JSON.stringify([other.name, other.points]) ===
              JSON.stringify([item.name, item.points])
          )
        )
          items.push({ ...item, id: item.id || crypto.randomUUID() });
      await saveDrawings(owner, symbol, items);
      localStorage.removeItem(key);
    } catch {
      /* Retain unsupported legacy data. */
    }
  }
}
