import type { ChartView, ChartCamera } from "../model/types.js";
import type { ChartAdapter } from "../charts/adapter.js";
import { chooseChartView, isChartCamera, parseChartViewKey } from "../charts/view-camera.js";
import { all, get, put, transaction } from "./storage-db.js";
import { loadView, saveView } from "./storage-v2.js";
import { physicalOwner, prepareProfileV2 } from "./storage-v2-migration.js";

interface SharedView {
  symbol: string;
  timeframe?: string;
  camera: ChartCamera;
}
const memory = new Map<string, SharedView & { owner: string; key?: string; view?: ChartView }>();
const writes = new Map<string, Promise<void>>();
function scope(owner: string, source: { engine: string }): string {
  return `chart-camera:${physicalOwner(owner)}:${source.engine}`;
}
export async function saveChartView(owner: string, key: string, view: ChartView): Promise<void> {
  const source = parseChartViewKey(key);
  if (!source) return;
  const { symbol, timeframe } = source;
  const shared = isChartCamera(view.camera)
    ? { symbol, timeframe, camera: { ...view.camera } }
    : undefined;
  const id = scope(owner, source);
  const snapshot = {
    ...view,
    ...(view.camera ? { camera: { ...view.camera } } : {}),
    ...(view.anchor ? { anchor: { ...view.anchor } } : {})
  };
  if (shared) memory.set(id, { ...shared, owner, key, view: snapshot });
  const write = shared
    ? (writes.get(id) ?? Promise.resolve())
        .catch(() => {})
        .then(() => put("preferences", { id, owner: physicalOwner(owner), value: shared }))
    : undefined;
  if (write) writes.set(id, write);
  await Promise.all([saveView(owner, key, snapshot), ...(write ? [write] : [])]);
}
/** Keep the legacy depth key; a later import transaction wins in IDB transaction order. */
export async function copyDepthChartView(
  owner: string,
  key: string,
  view: ChartView,
  valid: () => boolean
): Promise<boolean> {
  if (!parseChartViewKey(key) || owner === "guest" || !valid()) return false;
  await prepareProfileV2(owner, valid);
  let written = false;
  await transaction(["preferences"], (tx) => {
    if (!valid()) return;
    tx.objectStore("preferences").put({
      id: `view:${physicalOwner(owner)}:${key}`,
      owner: physicalOwner(owner),
      viewKey: key,
      value: view
    });
    written = true;
  });
  return written && valid();
}
export async function loadChartView(owner: string, key: string): Promise<ChartView | undefined> {
  const source = parseChartViewKey(key);
  if (!source) return undefined;
  const id = scope(owner, source),
    [saved, current, legacy] = await Promise.all([
      loadView(owner, key),
      get("preferences", id),
      get("preferences", `${id}:${source.timeframe}`)
    ]),
    record = current ?? legacy;
  let shared = memory.get(id);
  if (!shared && record && typeof record === "object" && "value" in record) {
    const value: unknown = record.value;
    if (
      value &&
      typeof value === "object" &&
      "symbol" in value &&
      typeof value.symbol === "string" &&
      "camera" in value &&
      isChartCamera(value.camera)
    ) {
      shared = {
        symbol: value.symbol,
        camera: value.camera,
        owner,
        ...(record === legacy
          ? { timeframe: source.timeframe }
          : "timeframe" in value && typeof value.timeframe === "string"
            ? { timeframe: value.timeframe }
            : {})
      };
      // Legacy per-timeframe records remain a fallback, never a cross-timeframe memory entry.
      if (record !== legacy) memory.set(id, shared);
    }
  }
  return chooseChartView(
    source.symbol,
    shared?.key === key ? (shared.view ?? saved) : saved,
    shared,
    source.timeframe
  );
}

export async function saveAdapterView(
  chart: ChartAdapter | null,
  owner: string,
  key: string
): Promise<void> {
  if (!chart || chart.retired || chart.persistView === false || owner === "guest") return;
  const view = chart.getView();
  if (view) await saveChartView(owner, key, view);
}

/** A backup's per-symbol views take precedence over outgoing live shared-camera state. */
export async function resetSharedChartCamera(owner: string, preserveStored = false): Promise<void> {
  await Promise.all(
    [...writes].flatMap(([key, write]) =>
      memory.get(key)?.owner === owner ? [write.catch(() => {})] : []
    )
  );
  const records = preserveStored ? [] : await all("preferences");
  const ids = records.flatMap((record) => {
    if (!record || typeof record !== "object" || !("id" in record) || !("owner" in record))
      return [];
    return record.owner === physicalOwner(owner) &&
      typeof record.id === "string" &&
      record.id.startsWith("chart-camera:")
      ? [record.id]
      : [];
  });
  if (ids.length)
    await transaction(["preferences"], (tx) => {
      for (const id of ids) tx.objectStore("preferences").delete(id);
    });
  for (const [key, view] of memory) if (view.owner === owner) memory.delete(key);
}
