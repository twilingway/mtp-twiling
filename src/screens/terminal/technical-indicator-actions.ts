import type { TerminalController } from "./controller.js";
import type { TerminalPreferences } from "./state.js";
import { importWritable } from "./controller-transfer-guard.js";
import {
  createTechnicalIndicatorInstance,
  isTechnicalIndicatorInstanceList
} from "../../model/technical-indicators/instances.js";
import type {
  TechnicalIndicatorId,
  TechnicalIndicatorInstance
} from "../../model/technical-indicators/types.js";
import {
  isTechnicalPaneLayout,
  reorderTechnicalIndicators,
  reorderTechnicalPanes,
  technicalIndicatorGroups,
  technicalPaneKey
} from "../../model/technical-indicator-layout.js";
import type { TechnicalPaneLayout } from "../../model/technical-indicator-layout.js";

type Patch = Pick<TerminalPreferences, "technicalIndicators" | "technicalPaneLayout">;
const queues = new WeakMap<TerminalController, Promise<void>>();

/** Serialize only TA writes. Read current preferences inside the queue, never before awaiting it. */
export function changeTechnicalPreferences(
  controller: TerminalController,
  transform: (preferences: TerminalPreferences) => Patch | null,
  extraValid: () => boolean = () => true
): Promise<void> {
  const initial = controller.getSnapshot(),
    session = controller.sessionKey();
  let crossedBoundary = false;
  const boundary = () => {
    const current = controller.getSnapshot();
    return (
      !crossedBoundary &&
      current.owner === initial.owner &&
      current.chartRevision === initial.chartRevision &&
      current.preferences.symbol === initial.preferences.symbol &&
      current.preferences.instrumentUid === initial.preferences.instrumentUid &&
      current.preferences.timeframe === initial.preferences.timeframe &&
      current.preferences.engine === initial.preferences.engine &&
      controller.sessionKey() === session &&
      importWritable(current, initial.owner) &&
      !current.backupBusy &&
      extraValid()
    );
  };
  const unsubscribe = controller.subscribe(() => {
    if (!boundary()) crossedBoundary = true;
  });
  const task = (queues.get(controller) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (!boundary()) return;
      const preferences = controller.getSnapshot().preferences,
        patch = transform(preferences);
      if (!patch) return;
      if (patch.technicalIndicators && !isTechnicalIndicatorInstanceList(patch.technicalIndicators))
        throw new Error("Некорректные настройки индикатора.");
      if (patch.technicalPaneLayout && !isTechnicalPaneLayout(patch.technicalPaneLayout))
        throw new Error("Некорректные настройки панели.");
      const valid = () =>
        boundary() &&
        controller.getSnapshot().preferences.technicalIndicators ===
          preferences.technicalIndicators &&
        controller.getSnapshot().preferences.technicalPaneLayout ===
          preferences.technicalPaneLayout;
      await controller.setPreferences(patch, false, valid);
    })
    .finally(unsubscribe);
  queues.set(controller, task);
  return task;
}

export function addTechnicalIndicator(
  controller: TerminalController,
  definition: TechnicalIndicatorId
): Promise<void> {
  return changeTechnicalPreferences(controller, (preferences) => {
    const instances = preferences.technicalIndicators ?? [];
    if (instances.length >= 100) throw new Error("Достигнут предел: 100 индикаторов.");
    const instance = createTechnicalIndicatorInstance(definition, crypto.randomUUID(), {
      order: Math.min(10000, Math.max(-1, ...instances.map((item) => item.order)) + 1)
    });
    const layout = preferences.technicalPaneLayout ?? [];
    return {
      technicalIndicators: [...instances, instance],
      technicalPaneLayout:
        instance.pane.kind === "pane"
          ? [...layout, { paneId: instance.pane.id, heightRatio: 0.2, collapsed: false }]
          : layout
    };
  });
}

export function updateTechnicalIndicator(
  controller: TerminalController,
  id: string,
  transform: (instance: TechnicalIndicatorInstance) => TechnicalIndicatorInstance | null,
  expected?: TechnicalIndicatorInstance
): Promise<void> {
  return changeTechnicalPreferences(controller, (preferences) => {
    const instances = preferences.technicalIndicators ?? [];
    const original = instances.find((item) => item.id === id);
    if (expected && original !== expected)
      throw new Error("Индикатор изменился. Откройте настройки заново.");
    if (!original) return null;
    const changed = transform(original);
    if (changed === original) return null;
    const next = instances.flatMap((item) =>
      item.id === id ? (changed ? [changed] : []) : [item]
    );
    const groups = technicalIndicatorGroups(next);
    const layout = (preferences.technicalPaneLayout ?? []).filter((pane) =>
      groups.some((group) => group.key === `pane:${pane.paneId}`)
    );
    for (const group of groups) {
      const id = group.pane.kind === "pane" ? group.pane.id : null;
      if (id && !layout.some((item) => item.paneId === id))
        layout.push({ paneId: id, heightRatio: 0.2, collapsed: false });
    }
    return { technicalIndicators: next, technicalPaneLayout: layout };
  });
}

export function moveTechnicalIndicator(
  controller: TerminalController,
  id: string,
  target: string,
  placement: "before" | "after" = "before"
): Promise<void> {
  return changeTechnicalPreferences(controller, (preferences) => {
    const previous = preferences.technicalIndicators ?? [];
    const next = reorderTechnicalIndicators(previous, id, target, placement);
    return next === previous ? null : { technicalIndicators: [...next] };
  });
}

export function changeTechnicalPane(
  controller: TerminalController,
  paneId: string,
  collapsed: boolean
): Promise<void> {
  return changeTechnicalPreferences(controller, (preferences) => {
    const layout = preferences.technicalPaneLayout ?? [];
    return {
      technicalPaneLayout: layout.some((item) => item.paneId === paneId)
        ? layout.map((item) => (item.paneId === paneId ? { ...item, collapsed } : item))
        : [...layout, { paneId, heightRatio: 0.2, collapsed }]
    };
  });
}

export function moveTechnicalPane(
  controller: TerminalController,
  paneId: string,
  target: string,
  placement: "before" | "after"
): Promise<void> {
  return changeTechnicalPreferences(controller, (preferences) => {
    const layout = preferences.technicalPaneLayout ?? [];
    return { technicalPaneLayout: [...reorderTechnicalPanes(layout, paneId, target, placement)] };
  });
}

export function persistTechnicalPaneLayout(
  controller: TerminalController,
  changed: TechnicalPaneLayout,
  valid: () => boolean
): Promise<void> {
  return changeTechnicalPreferences(
    controller,
    (preferences) => {
      const layout = preferences.technicalPaneLayout ?? [];
      const existing = new Set(
        (preferences.technicalIndicators ?? []).map((item) => technicalPaneKey(item.pane))
      );
      const accepted = changed.filter((item) => existing.has(`pane:${item.paneId}`));
      return {
        technicalPaneLayout: [
          ...layout.map((item) => accepted.find((next) => next.paneId === item.paneId) ?? item),
          ...accepted.filter((item) => !layout.some((next) => next.paneId === item.paneId))
        ]
      };
    },
    valid
  );
}
