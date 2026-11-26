import { isChartView } from "../model/backup-format.js";
import type { ChartView } from "../model/types.js";

function workspaceCameraId(owner: string, slot: number, key: string): string {
  return `workspace-camera:${JSON.stringify([owner, slot, key])}`;
}

export async function loadWorkspaceView(owner: string, slot: number, key: string) {
  const { get } = await import("./storage-db.js");
  const record = await get("preferences", workspaceCameraId(owner, slot, key));
  const view = record && typeof record === "object" && "value" in record ? record.value : null;
  return isChartView(view) ? view : undefined;
}

export async function saveWorkspaceView(
  owner: string,
  slot: number,
  key: string,
  value: ChartView
): Promise<void> {
  const { put } = await import("./storage-db.js");
  await put("preferences", { id: workspaceCameraId(owner, slot, key), value });
}
