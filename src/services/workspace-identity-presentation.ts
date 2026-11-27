import { isProfilePreferences, isRecord, validateBackup } from "../model/backup-format.js";
import { chartLayout } from "../model/chart-workspace-layout.js";
import type { WorkspaceMigrationConflict } from "../model/workspace-identity-types.js";

export interface PresentationEntry {
  key: string;
  value: string;
}
/** Unbound ancient account-name data remains untouched; only safe counts enter the report. */
export function preservedUnboundV1(): { preferences: number; drawings: number } {
  const counts = { preferences: 0, drawings: 0 };
  if (!("localStorage" in globalThis)) return counts;
  const storage = globalThis.localStorage;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === "terminal.preferences.v1") counts.preferences++;
    else if (key?.startsWith("terminal.drawings.v1:")) counts.drawings++;
  }
  return counts;
}
export function presentationOwners(): string[] {
  if (!("localStorage" in globalThis)) return [];
  const storage = globalThis.localStorage,
    owners = new Set<string>();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key) continue;
    const presentation = /^mtp:workspace-presentation:([^:]+)$/.exec(key);
    const panel = /^mtp:workspace(?:-grid)?:(\[.*\])(?::(?:instrument|preferences))?$/.exec(key);
    let owner: unknown;
    if (presentation) owner = decodeURIComponent(presentation[1]!);
    else if (panel) {
      const tuple: unknown = JSON.parse(panel[1]!);
      if (Array.isArray(tuple)) owner = tuple[0];
    }
    if (typeof owner === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(owner) && owner !== "device")
      owners.add(owner);
  }
  return [...owners];
}
export function presentationTarget(key: string, owner: string): string | undefined {
  if (key === `mtp:workspace-presentation:${encodeURIComponent(owner)}`)
    return "mtp:workspace-presentation:device";
  const slot = /^mtp:workspace:(\[.*\]):(instrument|preferences)$/.exec(key);
  const grid = /^mtp:workspace-grid:(\[.*\])$/.exec(key);
  const match = slot ?? grid;
  if (!match) return undefined;
  const parts: unknown = JSON.parse(match[1]!);
  if (!Array.isArray(parts) || parts[0] !== owner) return undefined;
  if (slot) {
    if (
      parts.length !== 2 ||
      !Number.isInteger(parts[1]) ||
      Number(parts[1]) < 1 ||
      Number(parts[1]) > 16
    )
      throw new Error("Invalid workspace panel key");
    return `mtp:workspace:${JSON.stringify(["device", parts[1]])}:${slot[2]}`;
  }
  if (
    parts.length !== 3 ||
    typeof parts[1] !== "string" ||
    !chartLayout(parts[1]) ||
    !["desktop", "mobile"].includes(String(parts[2]))
  )
    throw new Error("Invalid workspace grid key");
  return `mtp:workspace-grid:${JSON.stringify(["device", parts[1], parts[2]])}`;
}
export function validatePresentationEntry(entry: PresentationEntry): void {
  const target = presentationTarget(entry.key, "device");
  if (
    target !== entry.key ||
    typeof entry.value !== "string" ||
    entry.value.length > 2 * 1024 * 1024
  )
    throw new Error("Invalid workspace presentation");
  if (entry.key.endsWith(":instrument")) {
    if (entry.value.length > 200 || entry.value.trim() !== entry.value)
      throw new Error("Invalid panel instrument");
    return;
  }
  const value: unknown = JSON.parse(entry.value);
  if (!isRecord(value)) throw new Error("Invalid workspace presentation");
  if (entry.key.endsWith(":preferences")) {
    if (!isProfilePreferences(value)) throw new Error("Invalid panel preferences");
    validateBackup({
      application: "personal-terminal",
      schemaVersion: 2,
      layout: value,
      drawings: [],
      images: []
    });
  } else if (entry.key === "mtp:workspace-presentation:device") {
    if (
      typeof value.layoutId !== "string" ||
      !chartLayout(value.layoutId) ||
      !isRecord(value.flags) ||
      Object.entries(value.flags).some(
        ([key, flag]) =>
          !["instrument", "timeframe", "crosshair", "time", "dateRange"].includes(key) ||
          typeof flag !== "boolean"
      )
    )
      throw new Error("Invalid workspace layout");
  } else {
    if (entry.value.length > 4096) throw new Error("Invalid workspace grid");
    const parts: unknown[] = JSON.parse(entry.key.slice("mtp:workspace-grid:".length)) as unknown[];
    const layout = chartLayout(String(parts[1]))!;
    for (const [key, sizes] of Object.entries(value)) {
      const count =
        key === "column" ? layout.columns : parts[2] === "mobile" ? layout.count : layout.rows;
      if (
        !["column", "row"].includes(key) ||
        !Array.isArray(sizes) ||
        sizes.length !== count ||
        !sizes.every(
          (size: unknown) =>
            typeof size === "number" && Number.isFinite(size) && size > 0 && size <= 100000
        )
      )
        throw new Error("Invalid workspace grid sizes");
    }
  }
}
export function stagePresentation(owners: readonly string[]): {
  entries: PresentationEntry[];
  conflicts: WorkspaceMigrationConflict[];
} {
  // No localStorage is normal in non-browser consumers; a throwing browser storage is a real read failure.
  if (!("localStorage" in globalThis)) return { entries: [], conflicts: [] };
  const storage = globalThis.localStorage,
    keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key !== null
    );
  const out = new Map<string, string>(),
    conflicts: WorkspaceMigrationConflict[] = [];
  for (const owner of owners)
    for (const key of keys) {
      const target = presentationTarget(key, owner);
      if (!target) continue;
      const value = storage.getItem(key);
      if (value === null) throw new Error("Workspace presentation changed during migration");
      validatePresentationEntry({ key: target, value });
      if (!out.has(target)) out.set(target, value);
      else if (out.get(target) !== value)
        conflicts.push({
          sourceOwner: owner,
          kind: "presentation",
          key,
          recoveryRef: `localStorage:${key}`
        });
    }
  return { entries: [...out].map(([key, value]) => ({ key, value })), conflicts };
}
export function applyPresentation(entries: readonly PresentationEntry[]): "applied" | "fallback" {
  for (const entry of entries) validatePresentationEntry(entry);
  if (!entries.length) return "applied";
  try {
    for (const { key, value } of entries) {
      globalThis.localStorage.setItem(key, value);
      if (globalThis.localStorage.getItem(key) !== value) return "fallback";
    }
    return "applied";
  } catch {
    return "fallback";
  }
}
