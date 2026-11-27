import { isChartView } from "../model/backup-format.js";
import type { ChartCamera, ChartView } from "../model/types.js";
import { chooseChartView, isChartCamera, parseChartViewKey } from "../charts/view-camera.js";

interface SharedView {
  symbol: string;
  timeframe: string;
  camera: ChartCamera;
  key?: string;
  view?: ChartView;
}
const memory = new Map<string, SharedView>();
const writes = new Map<string, Promise<void>>();

function sharedCameraId(owner: string, slot: number, key: string): string | undefined {
  const source = parseChartViewKey(key);
  return source
    ? `workspace-camera-shared:${JSON.stringify([owner, slot, source.symbol, source.engine])}`
    : undefined;
}

function workspaceCameraId(owner: string, slot: number, key: string): string {
  return `workspace-camera:${JSON.stringify([owner, slot, key])}`;
}

export async function loadWorkspaceView(owner: string, slot: number, key: string) {
  const { get } = await import("./storage-db.js");
  const id = sharedCameraId(owner, slot, key),
    source = parseChartViewKey(key),
    [record, sharedRecord] = await Promise.all([
      get("preferences", workspaceCameraId(owner, slot, key)),
      id ? get("preferences", id) : undefined
    ]);
  const view = record && typeof record === "object" && "value" in record ? record.value : null;
  let shared = id ? memory.get(id) : undefined;
  if (!shared && sharedRecord && typeof sharedRecord === "object" && "value" in sharedRecord) {
    const value: unknown = sharedRecord.value;
    if (
      value &&
      typeof value === "object" &&
      "symbol" in value &&
      typeof value.symbol === "string" &&
      "timeframe" in value &&
      typeof value.timeframe === "string" &&
      "camera" in value &&
      isChartCamera(value.camera)
    ) {
      shared = { symbol: value.symbol, timeframe: value.timeframe, camera: value.camera };
      if (id) memory.set(id, shared);
    }
  }
  const saved = isChartView(view) ? view : undefined;
  return source
    ? chooseChartView(
        source.symbol,
        shared?.key === key ? (shared.view ?? saved) : saved,
        shared,
        source.timeframe
      )
    : saved;
}

export async function saveWorkspaceView(
  owner: string,
  slot: number,
  key: string,
  value: ChartView
): Promise<void> {
  const id = sharedCameraId(owner, slot, key),
    source = parseChartViewKey(key),
    shared =
      source && isChartCamera(value.camera)
        ? { symbol: source.symbol, timeframe: source.timeframe, camera: { ...value.camera } }
        : undefined;
  const snapshot = {
    ...value,
    ...(value.camera ? { camera: { ...value.camera } } : {}),
    ...(value.anchor ? { anchor: { ...value.anchor } } : {})
  };
  if (id && shared) memory.set(id, { ...shared, key, view: snapshot });
  const store = async () => {
    const { put } = await import("./storage-db.js");
    await Promise.all([
      put("preferences", { id: workspaceCameraId(owner, slot, key), value: snapshot }),
      ...(id && shared ? [put("preferences", { id, owner, value: shared })] : [])
    ]);
  };
  const write = id ? (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(store) : store();
  if (id) writes.set(id, write);
  await write;
}
