import type { IndicatorPane, TechnicalIndicatorInstance } from "./technical-indicators/types.js";

export interface TechnicalPanePreference {
  paneId: string;
  heightRatio: number;
  collapsed: boolean;
}
export type TechnicalPaneLayout = TechnicalPanePreference[];
export const DEFAULT_TECHNICAL_PANE_HEIGHT_RATIO = 0.18;

/** Runtime resize intent only; neither field belongs to the persisted layout schema. */
export interface TechnicalPaneCaptureContext {
  readonly resizedPaneIds: readonly string[];
  readonly baselineOrder: readonly string[];
}
export interface TechnicalPaneCapture {
  readonly layout: TechnicalPaneLayout;
  readonly context: TechnicalPaneCaptureContext;
}

const paneId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
const stableCompare = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);
const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((entry) => "value" in entry)
  );
};

export function isTechnicalPaneLayout(value: unknown): value is TechnicalPaneLayout {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set<string>();
  for (const item of value as unknown[]) {
    if (
      !plain(item) ||
      Reflect.ownKeys(item).some(
        (key) => typeof key !== "string" || !["paneId", "heightRatio", "collapsed"].includes(key)
      ) ||
      !paneId(item.paneId) ||
      ids.has(item.paneId) ||
      typeof item.heightRatio !== "number" ||
      !Number.isFinite(item.heightRatio) ||
      item.heightRatio < 0.05 ||
      item.heightRatio > 0.8 ||
      typeof item.collapsed !== "boolean"
    )
      return false;
    ids.add(item.paneId);
  }
  return true;
}

export function technicalPaneKey(pane: IndicatorPane): string {
  return pane.kind === "overlay" ? "price" : `pane:${pane.id}`;
}

export function orderedTechnicalIndicators(
  instances: readonly TechnicalIndicatorInstance[]
): TechnicalIndicatorInstance[] {
  return [...instances].sort((a, b) => a.order - b.order || stableCompare(a.id, b.id));
}

export interface TechnicalIndicatorGroup {
  key: string;
  pane: IndicatorPane;
  instances: TechnicalIndicatorInstance[];
  preference?: TechnicalPanePreference;
}

/** Price is always first; persisted pane order does not depend on translated titles. */
export function technicalIndicatorGroups(
  instances: readonly TechnicalIndicatorInstance[],
  layout: readonly TechnicalPanePreference[] = []
): TechnicalIndicatorGroup[] {
  const groups = new Map<string, TechnicalIndicatorGroup>();
  for (const item of orderedTechnicalIndicators(instances)) {
    const key = technicalPaneKey(item.pane);
    let group = groups.get(key);
    if (!group) {
      const id = item.pane.kind === "pane" ? item.pane.id : null;
      const preference = layout.find((entry) => entry.paneId === id);
      group = {
        key,
        pane: { ...item.pane },
        instances: [],
        ...(preference ? { preference } : {})
      };
      groups.set(key, group);
    }
    group.instances.push(item);
  }
  const positions = new Map(layout.map((item, index) => [`pane:${item.paneId}`, index]));
  return [...groups.values()].sort((a, b) => {
    if (a.key === b.key) return 0;
    if (a.key === "price") return -1;
    if (b.key === "price") return 1;
    return (
      (positions.get(a.key) ?? Infinity) - (positions.get(b.key) ?? Infinity) ||
      a.instances[0]!.order - b.instances[0]!.order ||
      stableCompare(a.key, b.key)
    );
  });
}

/** Move relative to a target within one pane; params/styles and other panes survive. */
export function reorderTechnicalIndicators(
  instances: readonly TechnicalIndicatorInstance[],
  movedId: string,
  targetId: string,
  placement: "before" | "after" = "before"
): readonly TechnicalIndicatorInstance[] {
  if (movedId === targetId) return instances;
  const moved = instances.find((item) => item.id === movedId);
  const target = instances.find((item) => item.id === targetId);
  if (!moved || !target || technicalPaneKey(moved.pane) !== technicalPaneKey(target.pane))
    return instances;
  const key = technicalPaneKey(moved.pane);
  const group = orderedTechnicalIndicators(instances).filter(
    (item) => technicalPaneKey(item.pane) === key
  );
  const without = group.filter((item) => item.id !== movedId);
  without.splice(
    without.findIndex((item) => item.id === targetId) + (placement === "after" ? 1 : 0),
    0,
    moved
  );
  if (without.every((item, index) => item.id === group[index]!.id)) return instances;
  const order = new Map(without.map((item, index) => [item.id, index]));
  return instances.map((item) =>
    order.has(item.id) ? { ...item, order: order.get(item.id)! } : item
  );
}

export function reorderTechnicalPanes(
  layout: readonly TechnicalPanePreference[],
  movedId: string,
  targetId: string,
  placement: "before" | "after" = "before"
): readonly TechnicalPanePreference[] {
  if (movedId === targetId) return layout;
  const moved = layout.find((item) => item.paneId === movedId);
  if (!moved || !layout.some((item) => item.paneId === targetId)) return layout;
  const next = layout.filter((item) => item.paneId !== movedId);
  next.splice(
    next.findIndex((item) => item.paneId === targetId) + (placement === "after" ? 1 : 0),
    0,
    moved
  );
  return next.every((item, index) => item === layout[index]) ? layout : next;
}
