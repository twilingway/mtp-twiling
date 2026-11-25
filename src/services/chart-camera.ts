import type { ChartView, ChartCamera } from "../model/types.js";
import { chooseChartView, isChartCamera, parseChartViewKey } from "../charts/view-camera.js";
import { get, put } from "./storage-db.js";
import { loadView, saveView } from "./storage.js";

interface SharedView {
  symbol: string;
  camera: ChartCamera;
}
const memory = new Map<string, SharedView>();
function scope(owner: string, source: { engine: string; timeframe: string }): string {
  return `chart-camera:${owner}:${source.engine}:${source.timeframe}`;
}
export async function saveChartView(owner: string, key: string, view: ChartView): Promise<void> {
  const source = parseChartViewKey(key);
  if (!source) return;
  const { symbol } = source;
  const shared = isChartCamera(view.camera) ? { symbol, camera: view.camera } : undefined;
  const id = scope(owner, source);
  if (shared) memory.set(id, shared);
  await Promise.all([
    saveView(owner, key, view),
    ...(shared ? [put("preferences", { id, owner, value: shared })] : [])
  ]);
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
      shared = { symbol: value.symbol, camera: value.camera };
      memory.set(id, shared);
    }
  }
  return chooseChartView(source.symbol, saved, shared);
}
