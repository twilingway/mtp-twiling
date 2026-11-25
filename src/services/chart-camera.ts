import type { ChartView, ChartCamera } from "../model/types.js";
import type { ChartAdapter } from "../charts/adapter.js";
import { chooseChartView, isChartCamera, parseChartViewKey } from "../charts/view-camera.js";
import { all, get, put, transaction } from "./storage-db.js";
import { loadView, saveView } from "./storage.js";

interface SharedView {
  symbol: string;
  camera: ChartCamera;
}
const memory = new Map<string, SharedView & { owner: string }>();
function scope(owner: string, source: { engine: string; timeframe: string }): string {
  return `chart-camera:${owner}:${source.engine}:${source.timeframe}`;
}
export async function saveChartView(owner: string, key: string, view: ChartView): Promise<void> {
  const source = parseChartViewKey(key);
  if (!source) return;
  const { symbol } = source;
  const shared = isChartCamera(view.camera) ? { symbol, camera: view.camera } : undefined;
  const id = scope(owner, source);
  if (shared) memory.set(id, { ...shared, owner });
  await Promise.all([
    saveView(owner, key, view),
    ...(shared ? [put("preferences", { id, owner, value: shared })] : [])
  ]);
}
/** Keep the legacy depth key; a later import transaction wins in IDB transaction order. */
export async function copyDepthChartView(
  owner: string,
  key: string,
  view: ChartView,
  valid: () => boolean
): Promise<boolean> {
  if (!parseChartViewKey(key) || owner === "guest" || !valid()) return false;
  let written = false;
  await transaction(["preferences"], (tx) => {
    if (!valid()) return;
    tx.objectStore("preferences").put({
      id: `view:${owner}:${key}`,
      owner,
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
    [saved, record] = await Promise.all([loadView(owner, key), get("preferences", id)]);
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
      shared = { symbol: value.symbol, camera: value.camera, owner };
      memory.set(id, shared);
    }
  }
  return chooseChartView(source.symbol, saved, shared);
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
export async function resetSharedChartCamera(owner: string): Promise<void> {
  const records = await all("preferences");
  const ids = records.flatMap((record) => {
    if (!record || typeof record !== "object" || !("id" in record) || !("owner" in record))
      return [];
    return record.owner === owner &&
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
