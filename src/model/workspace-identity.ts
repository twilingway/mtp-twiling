import { validateBackup, isRecord } from "./backup-format.js";
import { decodeCandles, encodeCandles, mergeCandles } from "./history-codec.js";
import type { Drawing, HistoryRange, ProfilePreferences } from "./types.js";
import type {
  WorkspaceMigrationConflict,
  WorkspaceSource,
  WorkspaceWrite,
  WorkspaceMerge
} from "./workspace-identity-types.js";

export const DEVICE_PHYSICAL_OWNER = "profile-v2:device";
export function sameWorkspaceValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((entry, index) => sameWorkspaceValue(entry, b[index]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameWorkspaceValue(a[key], b[key]))
  );
}
/** Stable, bounded local IDs; no random/time/DOM input and no credential-derived material. */
export function remappedId(owner: string, id: string, used: ReadonlySet<string>): string {
  let hash = 2166136261;
  for (const char of `${owner}\0${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const prefix = `migrated-${(hash >>> 0).toString(16)}`;
  let next = prefix,
    count = 0;
  while (used.has(next)) next = `${prefix}-${++count}`;
  return next;
}
export function mergeDeviceWorkspace(sources: readonly WorkspaceSource[]): WorkspaceMerge {
  const writes: WorkspaceWrite[] = [],
    conflicts: WorkspaceMigrationConflict[] = [];
  const conflict = (
    source: WorkspaceSource,
    kind: WorkspaceMigrationConflict["kind"],
    key: string
  ) => {
    conflicts.push({
      sourceOwner: source.owner,
      kind,
      key,
      recoveryRef: `workspace-source:${source.owner}`
    });
  };
  const mergeFields = (
    out: Record<string, unknown>,
    input: Record<string, unknown>,
    source: WorkspaceSource,
    path: string
  ) => {
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(out, key)) out[key] = structuredClone(value);
      else if (isRecord(out[key]) && isRecord(value))
        mergeFields(out[key], value, source, `${path}${key}.`);
      else if (!sameWorkspaceValue(out[key], value))
        conflict(source, "preferences", `${path}${key}`);
    }
  };
  const layout: Record<string, unknown> = {},
    rows = new Map<string, NonNullable<WorkspaceSource["backup"]["watchlist"]>[number]>();
  const documents = new Map<string, Drawing[]>(),
    views = new Map<string, unknown>();
  const images = new Map<string, WorkspaceSource["images"][number]>(),
    imageContents = new Set<string>();
  const cameras = new Map<string, Record<string, unknown>>();
  const histories = new Map<string, Record<string, unknown>>(),
    coverages = new Map<string, Record<string, unknown>>();
  const indicators: NonNullable<ProfilePreferences["technicalIndicators"]> = [];
  const technicalPanes: Record<string, unknown> = {};
  let selectedInstrument = false;
  for (const source of sources) {
    const settings = structuredClone(source.backup.layout ?? {});
    const selection: Record<string, unknown> = {};
    for (const key of ["symbol", "instrumentUid", "providerRef"] as const) {
      if (Object.hasOwn(settings, key)) selection[key] = settings[key];
      delete settings[key];
    }
    if (Object.keys(selection).length) {
      if (!selectedInstrument) {
        Object.assign(layout, selection);
        selectedInstrument = true;
      } else
        for (const [key, value] of Object.entries(selection))
          if (!sameWorkspaceValue(layout[key], value)) conflict(source, "preferences", key);
    }
    const incomingIndicators = settings.technicalIndicators ?? [];
    const incomingPanes: Record<string, unknown> = Object.fromEntries(
      (settings.technicalPaneLayout ?? []).map((pane) => [pane.paneId, pane])
    );
    delete settings.technicalIndicators;
    delete settings.technicalPaneLayout;
    mergeFields(layout, settings as Record<string, unknown>, source, "");
    const paneRemaps = new Map<string, string>();
    for (const indicator of incomingIndicators) {
      let item = structuredClone(indicator);
      const existing = indicators.find((entry) => entry.id === item.id);
      if (existing && sameWorkspaceValue(existing, item)) continue;
      if (existing) {
        const id = remappedId(source.owner, item.id, new Set(indicators.map((entry) => entry.id)));
        item = { ...item, id };
        conflict(source, "object-remap", `indicator:${indicator.id}:${id}`);
      }
      if (item.pane.kind === "pane") {
        const oldPane = item.pane.id;
        let newPane = paneRemaps.get(oldPane);
        if (!newPane) {
          newPane =
            Object.hasOwn(technicalPanes, oldPane) &&
            !sameWorkspaceValue(technicalPanes[oldPane], incomingPanes[oldPane])
              ? remappedId(source.owner, `pane:${oldPane}`, new Set(Object.keys(technicalPanes)))
              : oldPane;
          // Colliding instances must not silently share the primary's pane.
          if (existing && newPane === oldPane)
            newPane = remappedId(
              source.owner,
              `pane:${oldPane}`,
              new Set(Object.keys(technicalPanes))
            );
          paneRemaps.set(oldPane, newPane);
          if (incomingPanes[oldPane] !== undefined)
            technicalPanes[newPane] = {
              ...(structuredClone(incomingPanes[oldPane]) as Record<string, unknown>),
              paneId: newPane
            };
        }
        item.pane = { kind: "pane", id: newPane };
      }
      indicators.push(item);
    }
    for (const [key, value] of Object.entries(incomingPanes)) {
      const target = paneRemaps.get(key) ?? key;
      const remapped = { ...(structuredClone(value) as Record<string, unknown>), paneId: target };
      if (!Object.hasOwn(technicalPanes, target)) technicalPanes[target] = remapped;
      else if (!sameWorkspaceValue(technicalPanes[target], remapped))
        conflict(source, "preferences", `technicalPaneLayout.${key}`);
    }
    for (const row of source.backup.watchlist ?? []) {
      const key = row.uid ?? `symbol:${row.symbol}`;
      if (!rows.has(key)) rows.set(key, structuredClone(row));
    }
    for (const doc of source.backup.drawings) {
      const out = documents.get(doc.symbol) ?? [];
      for (const drawing of doc.items) {
        if (typeof drawing.id !== "string") throw new Error("Invalid local drawing identity");
        let item = structuredClone(drawing) as Drawing;
        const existing = out.find((entry) => entry.id === item.id);
        if (existing && sameWorkspaceValue(existing, item)) continue;
        if (existing) {
          item = {
            ...item,
            id: remappedId(source.owner, item.id, new Set(out.map((entry) => entry.id)))
          };
          conflict(source, "object-remap", `drawing:${doc.symbol}:${drawing.id}:${item.id}`);
        }
        out.push(item);
      }
      documents.set(doc.symbol, out);
    }
    for (const view of source.backup.views ?? []) {
      if (!views.has(view.key)) views.set(view.key, structuredClone(view.value));
      else if (!sameWorkspaceValue(views.get(view.key), view.value))
        conflict(source, "view", view.key);
    }
    for (const entry of source.images) {
      const original = entry.image.syncId ?? entry.image.id;
      const contentKey = `${entry.image.symbol}\0${entry.content}`;
      if (imageContents.has(contentKey)) continue;
      let id = original;
      if (images.has(id)) {
        id = remappedId(source.owner, id, new Set(images.keys()));
        conflict(source, "object-remap", `image:${original}:${id}`);
      }
      images.set(id, entry);
      imageContents.add(contentKey);
    }
    for (const camera of source.cameras) {
      const id = String(camera.id);
      if (!cameras.has(id)) cameras.set(id, camera);
      else if (!sameWorkspaceValue(cameras.get(id)?.value, camera.value))
        conflict(source, "view", id);
    }
    for (const history of source.history) {
      const key = `${String(history.uid)}:${String(history.timeframe)}:${String(history.day)}`;
      const previous = histories.get(key);
      histories.set(key, {
        ...history,
        id: `${DEVICE_PHYSICAL_OWNER}:${key}`,
        owner: DEVICE_PHYSICAL_OWNER,
        data: encodeCandles(
          mergeCandles(
            decodeCandles(history.data),
            ...(previous ? [decodeCandles(previous.data)] : [])
          )
        )
      });
    }
    for (const coverage of source.coverage) {
      const key = `${String(coverage.uid)}:${String(coverage.timeframe)}`;
      const previous = coverages.get(key);
      const ranges = [
        ...(coverage.ranges as HistoryRange[]),
        ...((previous?.ranges ?? []) as HistoryRange[])
      ]
        .sort((a, b) => a.from - b.from)
        .reduce<HistoryRange[]>((out, range) => {
          const last = out.at(-1);
          if (last && range.from <= last.to) {
            last.to = Math.max(last.to, range.to);
            last.fetchedAt = Math.max(last.fetchedAt ?? 0, range.fetchedAt ?? 0);
          } else out.push({ ...range });
          return out;
        }, []);
      coverages.set(key, {
        id: `${DEVICE_PHYSICAL_OWNER}:${key}`,
        owner: DEVICE_PHYSICAL_OWNER,
        uid: coverage.uid,
        timeframe: coverage.timeframe,
        ranges
      });
    }
  }
  if (indicators.length) layout.technicalIndicators = indicators;
  if (Object.keys(technicalPanes).length)
    layout.technicalPaneLayout = Object.values(technicalPanes);
  if (
    rows.size > 300 ||
    indicators.length > 100 ||
    images.size > 1000 ||
    documents.size > 10000 ||
    [...documents.values()].some((items) => items.length > 10000)
  )
    throw new RangeError("Workspace migration limits exceeded");
  const backup = validateBackup({
    application: "personal-terminal",
    schemaVersion: 2,
    ...(sources.some((source) => source.backup.requiredProviders)
      ? { requiredProviders: ["okx"] }
      : {}),
    layout,
    watchlist: [...rows.values()],
    drawings: [...documents].map(([symbol, items]) => ({ symbol, items })),
    views: [...views].map(([key, value]) => ({ key, value })),
    images: [...images].map(([id, { image }]) => ({
      id,
      symbol: image.symbol,
      name: image.name,
      type: image.blob.type,
      data: "",
      point: image.point,
      width: image.width
    }))
  });
  const pref = (id: string, value: unknown) =>
    writes.push({ store: "preferences", value: { id, owner: DEVICE_PHYSICAL_OWNER, value } });
  pref(`layout:${DEVICE_PHYSICAL_OWNER}`, backup.layout);
  pref(`watchlist:${DEVICE_PHYSICAL_OWNER}`, backup.watchlist);
  pref(`market:${DEVICE_PHYSICAL_OWNER}`, { rows: backup.watchlist, at: 0 });
  for (const view of backup.views ?? [])
    writes.push({
      store: "preferences",
      value: {
        id: `view:${DEVICE_PHYSICAL_OWNER}:${view.key}`,
        owner: DEVICE_PHYSICAL_OWNER,
        viewKey: view.key,
        value: view.value
      }
    });
  for (const [symbol, items] of documents)
    writes.push({
      store: "drawings",
      value: {
        id: `${DEVICE_PHYSICAL_OWNER}:${symbol}`,
        owner: DEVICE_PHYSICAL_OWNER,
        symbol,
        items
      }
    });
  const usedImageIds = new Set(
    sources.flatMap((source) => source.images.map(({ image }) => image.id))
  );
  for (const [syncId, { image }] of images) {
    const preferred = `device-image:${syncId}`;
    const id = usedImageIds.has(preferred)
      ? remappedId("device-image", syncId, usedImageIds)
      : preferred;
    usedImageIds.add(id);
    writes.push({
      store: "images",
      value: { ...image, id, syncId, owner: DEVICE_PHYSICAL_OWNER }
    });
  }
  for (const value of cameras.values()) writes.push({ store: "preferences", value });
  for (const value of histories.values()) writes.push({ store: "history", value });
  for (const value of coverages.values()) writes.push({ store: "coverage", value });
  return { writes, conflicts };
}
