import { object } from "./types.js";
import { db } from "./storage-db.js";

export const GUEST_SOURCE = "guest";
export const GUEST_TARGET = "profile-v2:public";
export const GUEST_DECISION = "guest-public-adoption:v1";
export const GUEST_STORES = ["preferences", "drawings", "images", "history", "coverage"] as const;
export interface GuestRecords {
  layout: unknown;
  watchlist: unknown;
  market: unknown;
  views: unknown[];
  cameras: unknown[];
  drawings: unknown[];
  images: unknown[];
  history: unknown[];
  coverage: unknown[];
  historyCount: number;
  coverageCount: number;
}
const prefix = (key: string) => IDBKeyRange.bound(key, key + "\uffff");
const imagesRange = (owner: string) => IDBKeyRange.bound([owner], [owner, []]);
export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local workspace read failed"));
  });
}

/** Keep the existing public-v1 migration compatible without scanning bank/session record values. */
export async function readRawPublicPortableRecords(): Promise<[unknown[], unknown[], unknown[]]> {
  const tx = db.transaction(["preferences", "drawings", "images"], "readonly"),
    pref = tx.objectStore("preferences");
  const [layout, watchlist, market, views, drawings, images] = await Promise.all([
    requestValue<unknown>(pref.get("layout:public")),
    requestValue<unknown>(pref.get("watchlist:public")),
    requestValue<unknown>(pref.get("market:public")),
    requestValue<unknown[]>(pref.getAll(prefix("view:public:"))),
    requestValue<unknown[]>(tx.objectStore("drawings").getAll(prefix("public:"))),
    requestValue<unknown[]>(
      tx.objectStore("images").index("ownerSymbol").getAll(imagesRange("public"))
    )
  ]);
  return [
    [layout, watchlist, market, ...views].filter((value) => value !== undefined),
    drawings,
    images
  ];
}

/** Exact keys/ranges only. Never reads a session, key, vault or another owner's record value. */
export async function readGuestRecords(
  tx: IDBTransaction,
  history: boolean
): Promise<GuestRecords> {
  const pref = tx.objectStore("preferences");
  const [
    layout,
    watchlist,
    market,
    views,
    cameras,
    drawings,
    images,
    blocks,
    coverage,
    historyKeys,
    coverageKeys
  ] = await Promise.all([
    requestValue<unknown>(pref.get("layout:guest")),
    requestValue<unknown>(pref.get("watchlist:guest")),
    requestValue<unknown>(pref.get("market:guest")),
    requestValue<unknown[]>(pref.getAll(prefix("view:guest:"))),
    requestValue<unknown[]>(pref.getAll(prefix("chart-camera:guest:"))),
    requestValue<unknown[]>(tx.objectStore("drawings").getAll(prefix("guest:"))),
    requestValue<unknown[]>(
      tx.objectStore("images").index("ownerSymbol").getAll(imagesRange(GUEST_SOURCE))
    ),
    history
      ? requestValue<unknown[]>(tx.objectStore("history").getAll(prefix("guest:")))
      : Promise.resolve([]),
    history
      ? requestValue<unknown[]>(tx.objectStore("coverage").getAll(prefix("guest:")))
      : Promise.resolve([]),
    requestValue(tx.objectStore("history").getAllKeys(prefix("guest:"))),
    requestValue(tx.objectStore("coverage").getAllKeys(prefix("guest:")))
  ]);
  return {
    layout,
    watchlist,
    market,
    views,
    cameras,
    drawings,
    images,
    history: blocks,
    coverage,
    historyCount: historyKeys.length,
    coverageCount: coverageKeys.length
  };
}

/** Keys reveal occupancy without loading unrelated preference values, including credential metadata. */
export async function publicTargetOccupied(tx: IDBTransaction): Promise<boolean> {
  const pref = tx.objectStore("preferences");
  const [keys, watch, market, drawings, images, history, coverage] = await Promise.all([
    requestValue(pref.getAllKeys()),
    requestValue<unknown>(pref.get(`watchlist:${GUEST_TARGET}`)),
    requestValue<unknown>(pref.get(`market:${GUEST_TARGET}`)),
    requestValue(tx.objectStore("drawings").getAllKeys(prefix(`${GUEST_TARGET}:`))),
    requestValue(
      tx.objectStore("images").index("ownerSymbol").getAllKeys(imagesRange(GUEST_TARGET))
    ),
    requestValue(tx.objectStore("history").getAllKeys(prefix(`${GUEST_TARGET}:`))),
    requestValue(tx.objectStore("coverage").getAllKeys(prefix(`${GUEST_TARGET}:`)))
  ]);
  const bootstrap = new Set([
    "v2-profile-ready:public",
    GUEST_DECISION,
    `watchlist:${GUEST_TARGET}`,
    `market:${GUEST_TARGET}`
  ]);
  if (
    keys.some(
      (key) =>
        typeof key === "string" &&
        !bootstrap.has(key) &&
        (key === "layout:public" ||
          key.endsWith(":public") ||
          key.includes(":public:") ||
          key.startsWith(`${GUEST_TARGET}:`) ||
          key.endsWith(`:${GUEST_TARGET}`) ||
          key.includes(`:${GUEST_TARGET}:`))
    )
  )
    return true;
  if ([drawings, images, history, coverage].some((list) => list.length > 0)) return true;
  if (watch !== undefined) {
    const record = object(watch);
    if (
      record?.owner !== GUEST_TARGET ||
      !Array.isArray(record.value) ||
      record.value.length ||
      Object.keys(record.value).length ||
      Object.keys(record).some((key) => !["id", "owner", "value"].includes(key))
    )
      return true;
  }
  if (market !== undefined) {
    const record = object(market),
      value = object(record?.value);
    if (
      record?.owner !== GUEST_TARGET ||
      Object.keys(record).some((key) => !["id", "owner", "value"].includes(key)) ||
      !value ||
      !Array.isArray(value.rows) ||
      value.rows.length ||
      !Number.isFinite(value.at) ||
      Object.keys(value).some((key) => !["rows", "at"].includes(key))
    )
      return true;
  }
  return false;
}
