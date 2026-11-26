import { chartLayout } from "../../model/chart-workspace-layout.js";
import type { ChartLayoutId } from "../../model/chart-workspace-layout.js";
import { isRecord } from "../../model/backup-format.js";
import { DEFAULT_WORKSPACE_SYNC_FLAGS } from "./workspace-sync.js";
import type { WorkspaceSyncFlags } from "./workspace-sync.js";

export interface WorkspacePresentation {
  layoutId: ChartLayoutId;
  flags: WorkspaceSyncFlags;
}

const storageKey = (owner: string) => `mtp:workspace-presentation:${encodeURIComponent(owner)}`;

export function loadWorkspacePresentation(owner: string): WorkspacePresentation {
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey(owner)) ?? "null");
  } catch {
    // An inaccessible or damaged preference falls back to a single chart.
  }
  const flags = { ...DEFAULT_WORKSPACE_SYNC_FLAGS };
  if (!isRecord(saved)) return { layoutId: "single", flags };
  const layout = typeof saved.layoutId === "string" ? chartLayout(saved.layoutId) : undefined;
  if (isRecord(saved.flags)) {
    for (const key of Object.keys(flags) as (keyof WorkspaceSyncFlags)[])
      flags[key] = saved.flags[key] === true;
  }
  return { layoutId: layout?.id ?? "single", flags };
}

export function saveWorkspacePresentation(owner: string, value: WorkspacePresentation): void {
  try {
    localStorage.setItem(storageKey(owner), JSON.stringify(value));
  } catch {
    // The selected layout remains usable during this session.
  }
}
