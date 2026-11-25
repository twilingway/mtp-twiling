import { get, all, transaction } from "./storage-db.js";
import { object, normaliseRows, imageAsset } from "./types.js";
import { validateBackup, isDrawing, isChartView } from "../model/backup-format.js";
import { isBankIdentity, providerRefFromId } from "../model/market-provider.js";
import { isInstrumentViewKey } from "../model/instrument-symbol.js";
import { readRawPublicPortableRecords } from "./storage-guest-records.js";

export const PUBLIC_OWNER = "public";
export const physicalOwner = (owner: string): string => `profile-v2:${owner}`;
const pending = new Map<string, Promise<void>>();
const check = (valid: () => boolean) => {
  if (!valid()) throw new DOMException("Профиль изменился", "AbortError");
};
/** Copy portable v1 records atomically. Never delete or modify a v1 record or credential. */
export function prepareProfileV2(
  owner: string,
  valid: () => boolean = () => true,
  signal?: AbortSignal
): Promise<void> {
  const previous = pending.get(owner);
  if (previous)
    return previous.catch((error: unknown) => {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      check(valid);
      signal?.throwIfAborted();
      return prepareProfileV2(owner, valid, signal);
    });
  const operation = migrate(owner, valid, signal).finally(() => {
    if (pending.get(owner) === operation) pending.delete(owner);
  });
  pending.set(owner, operation);
  return operation;
}
async function migrate(owner: string, valid: () => boolean, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const target = physicalOwner(owner),
    marker = `v2-profile-ready:${owner}`;
  if (await get("preferences", marker)) {
    check(valid);
    return;
  }
  const [preferences, drawings, images] =
    owner === PUBLIC_OWNER
      ? await readRawPublicPortableRecords()
      : await Promise.all([all("preferences"), all("drawings"), all("images")]);
  check(valid);
  const writes: { store: string; value: Record<string, unknown> }[] = [];
  for (const item of preferences) {
    const raw = object(item);
    if (raw?.owner !== owner || typeof raw.id !== "string") continue;
    if (raw.id === `layout:${owner}`) {
      const layout = validateBackup({
        application: "personal-terminal",
        schemaVersion: 1,
        drawings: [],
        images: [],
        layout: raw.value
      }).layout;
      writes.push({
        store: "preferences",
        value: { id: `layout:${target}`, owner: target, value: layout }
      });
    } else if (raw.id === `watchlist:${owner}` || raw.id === `market:${owner}`) {
      const market = raw.id.startsWith("market:");
      const rows = normaliseRows(market ? object(raw.value)?.rows : raw.value).filter(
        isBankIdentity
      );
      writes.push({
        store: "preferences",
        value: {
          id: `${market ? "market" : "watchlist"}:${target}`,
          owner: target,
          value: market ? { rows, at: object(raw.value)?.at ?? 0 } : rows
        }
      });
    } else if (
      typeof raw.viewKey === "string" &&
      isInstrumentViewKey(raw.viewKey) &&
      !raw.viewKey.startsWith("bybit:") &&
      isChartView(raw.value)
    ) {
      writes.push({
        store: "preferences",
        value: { ...raw, id: `view:${target}:${raw.viewKey}`, owner: target }
      });
    }
  }
  for (const item of drawings) {
    const raw = object(item);
    if (raw?.owner !== owner || typeof raw.symbol !== "string" || raw.symbol.startsWith("bybit:"))
      continue;
    if (!Array.isArray(raw.items) || !raw.items.every(isDrawing))
      throw new Error("Повреждена разметка legacy профиля.");
    writes.push({
      store: "drawings",
      value: { ...raw, id: `${target}:${raw.symbol}`, owner: target }
    });
  }
  for (const item of images) {
    const image = imageAsset(item);
    if (!image || image.owner !== owner || image.symbol.startsWith("bybit:")) continue;
    writes.push({
      store: "images",
      value: { ...image, id: crypto.randomUUID(), syncId: image.syncId ?? image.id, owner: target }
    });
  }
  await transaction(
    ["preferences", "drawings", "images"],
    (tx) => {
      check(valid);
      const store = tx.objectStore("preferences"),
        existing = store.get(marker);
      existing.onsuccess = () => {
        try {
          check(valid);
        } catch {
          tx.abort();
          return;
        }
        if (existing.result) return;
        for (const item of writes) tx.objectStore(item.store).put(item.value);
        store.put({ id: marker, owner: target, value: true });
      };
    },
    signal
  );
}
function publicView(key: unknown): boolean {
  return typeof key === "string" && !!providerRefFromId(key.split(":").slice(0, -3).join(":"));
}
export async function copyPublicProfile(
  sourceOwner: string,
  targetOwner: string,
  valid: () => boolean,
  merge = false,
  signal?: AbortSignal
): Promise<{ conflict: boolean; count: number }> {
  if (sourceOwner === targetOwner) return { conflict: false, count: 0 };
  await prepareProfileV2(sourceOwner, valid, signal);
  await prepareProfileV2(targetOwner, valid, signal);
  const source = physicalOwner(sourceOwner),
    target = physicalOwner(targetOwner);
  const [preferences, drawings, images] = await Promise.all([
    all("preferences"),
    all("drawings"),
    all("images")
  ]);
  check(valid);
  const srcWatch = object(preferences.find((value) => object(value)?.id === `watchlist:${source}`));
  const dstWatch = object(preferences.find((value) => object(value)?.id === `watchlist:${target}`));
  const incoming = normaliseRows(srcWatch?.value).filter((row) => row.providerRef);
  const existing = normaliseRows(dstWatch?.value);
  const sourceDocs = drawings
    .map(object)
    .filter((raw) => raw?.owner === source && providerRefFromId(raw.symbol));
  const sourceImages = images
    .map(imageAsset)
    .filter((image) => image?.owner === source && providerRefFromId(image.symbol));
  const sourceViews = preferences
    .map(object)
    .filter((raw) => raw?.owner === source && publicView(raw.viewKey));
  const count = incoming.length + sourceDocs.length + sourceImages.length + sourceViews.length;
  const hasTarget =
    existing.some((row) => row.providerRef) ||
    drawings.some((value) => {
      const raw = object(value);
      return raw?.owner === target && providerRefFromId(raw.symbol);
    }) ||
    images.some((value) => {
      const raw = object(value);
      return raw?.owner === target && providerRefFromId(raw.symbol);
    }) ||
    preferences.some((value) => {
      const raw = object(value);
      return raw?.owner === target && publicView(raw.viewKey);
    });
  if (!count || (hasTarget && !merge)) return { conflict: hasTarget && count > 0, count };
  const rows = [
    ...existing,
    ...incoming.filter((row) => !existing.some((item) => item.uid === row.uid))
  ];
  if (rows.length > 300) throw new Error("Нельзя перенести больше 300 инструментов.");
  await transaction(
    ["preferences", "drawings", "images"],
    (tx) => {
      check(valid);
      const pref = tx.objectStore("preferences");
      pref.put({ id: `watchlist:${target}`, owner: target, value: rows });
      pref.put({ id: `market:${target}`, owner: target, value: { rows, at: Date.now() } });
      for (const raw of sourceDocs)
        if (
          raw &&
          !drawings.some((value) => object(value)?.id === `${target}:${String(raw.symbol)}`)
        )
          tx.objectStore("drawings").put({
            ...raw,
            id: `${target}:${String(raw.symbol)}`,
            owner: target
          });
      for (const image of sourceImages)
        if (
          image &&
          !images.some((value) => {
            const raw = imageAsset(value);
            return raw?.owner === target && (raw.syncId ?? raw.id) === (image.syncId ?? image.id);
          })
        )
          tx.objectStore("images").put({
            ...image,
            id: crypto.randomUUID(),
            syncId: image.syncId ?? image.id,
            owner: target
          });
      for (const raw of sourceViews)
        if (
          raw &&
          !preferences.some(
            (value) => object(value)?.id === `view:${target}:${String(raw.viewKey)}`
          )
        )
          pref.put({ ...raw, id: `view:${target}:${String(raw.viewKey)}`, owner: target });
      // Only namespaced public flags transfer. No bank preference or chart selection is replaced.
      const srcLayout = object(
        object(preferences.find((value) => object(value)?.id === `layout:${source}`))?.value
      );
      const dstLayout =
        object(
          object(preferences.find((value) => object(value)?.id === `layout:${target}`))?.value
        ) ?? {};
      const flags = { ...object(dstLayout.watchlistFlags) };
      for (const [key, color] of Object.entries(object(srcLayout?.watchlistFlags) ?? {}))
        if (key.startsWith("uid:") && providerRefFromId(key.slice(4)) && !Object.hasOwn(flags, key))
          flags[key] = color;
      pref.put({
        id: `layout:${target}`,
        owner: target,
        value: { ...dstLayout, watchlistFlags: flags }
      });
    },
    signal
  );
  return { conflict: false, count };
}
