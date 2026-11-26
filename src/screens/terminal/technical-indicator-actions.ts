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
  DEFAULT_TECHNICAL_PANE_HEIGHT_RATIO
} from "../../model/technical-indicator-layout.js";
import type {
  TechnicalPaneLayout,
  TechnicalPaneCaptureContext
} from "../../model/technical-indicator-layout.js";

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
  valid: () => boolean,
  capture?: TechnicalPaneCaptureContext
): Promise<void> {
  return changeTechnicalPreferences(
    controller,
    (preferences) => {
      const layout = preferences.technicalPaneLayout ?? [];
      const groups = technicalIndicatorGroups(preferences.technicalIndicators ?? [], layout).filter(
        (group) => group.pane.kind === "pane"
      );
      const freshOrder = groups.map((group) => group.key.slice(5)),
        existing = new Set(freshOrder);
      const accepted = changed.filter((item) => existing.has(item.paneId));
      const capturedOrder = accepted.map((item) => item.paneId),
        captured = new Set(capturedOrder);
      const baseline = capture?.baselineOrder ?? [],
        common = new Set(
          baseline.filter((id) => existing.has(id) && layout.some((item) => item.paneId === id))
        ),
        baselineCommon = baseline.filter((id) => common.has(id)),
        freshCommon = layout.map((item) => item.paneId).filter((id) => common.has(id));
      // A resize has no reorder intent: an earlier queued model reorder wins over its old snapshot.
      const reordered = baselineCommon.some((id, index) => freshCommon[index] !== id);
      const order =
        capture && !reordered
          ? [...capturedOrder, ...freshOrder.filter((id) => !captured.has(id))]
          : freshOrder;
      const resized = new Set(capture?.resizedPaneIds ?? capturedOrder);
      return {
        technicalPaneLayout: order.map((paneId) => {
          const measured = accepted.find((item) => item.paneId === paneId),
            fresh = layout.find((item) => item.paneId === paneId);
          return (
            (resized.has(paneId) ? measured : fresh) ??
            fresh ??
            measured ?? {
              paneId,
              heightRatio: DEFAULT_TECHNICAL_PANE_HEIGHT_RATIO,
              collapsed: false
            }
          );
        })
      };
    },
    valid
  );
}
