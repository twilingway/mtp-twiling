import type { ChartLayoutDefinition } from "../../model/chart-workspace-layout.js";
import {
  readWorkspaceLocal,
  writeWorkspaceLocal
} from "../../services/workspace-identity-local.js";

export interface LayoutSizes {
  column?: readonly number[];
  row?: readonly number[];
}

export function workspaceGridStorageKey(
  owner: string,
  layout: ChartLayoutDefinition,
  narrow: boolean
): string {
  return `mtp:workspace-grid:${JSON.stringify([owner, layout.id, narrow ? "mobile" : "desktop"])}`;
}

function trackSizes(input: unknown, expected: number): readonly number[] | undefined {
  if (
    !Array.isArray(input) ||
    input.length !== expected ||
    !input.every(
      (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100_000
    )
  )
    return undefined;
  return input as number[];
}

export function readWorkspaceGridSizes(
  key: string,
  layout: ChartLayoutDefinition,
  narrow: boolean
): LayoutSizes {
  try {
    const text = readWorkspaceLocal(key);
    const value: unknown = text === null || text.length > 4_096 ? null : JSON.parse(text);
    if (!value || typeof value !== "object") return {};
    const column = narrow
      ? undefined
      : trackSizes("column" in value ? value.column : null, layout.columns);
    const row = trackSizes("row" in value ? value.row : null, narrow ? layout.count : layout.rows);
    return { ...(column && { column }), ...(row && { row }) };
  } catch {
    return {};
  }
}

export function writeWorkspaceGridSizes(key: string, sizes: LayoutSizes): void {
  try {
    writeWorkspaceLocal(key, JSON.stringify(sizes));
  } catch {
    // The open workspace keeps the measured tracks if browser storage is unavailable.
  }
}
