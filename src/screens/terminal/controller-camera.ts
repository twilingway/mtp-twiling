import { copyDepthChartView, loadChartView, saveChartView } from "../../services/chart-camera.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { TerminalController } from "./controller.js";
import type { TerminalPreferences } from "./state.js";
import { viewKey } from "./controller-bridge.js";

type Controller = Pick<TerminalController, "getSnapshot" | "chart" | "subscribe">;

/** Preserve the existing public saveView eligibility rules. */
export async function saveControllerView(controller: Controller): Promise<void> {
  const state = controller.getSnapshot(),
    chart = controller.chart;
  if (
    state.importRecoveryRequired ||
    state.importingBackup ||
    state.historyViewReady === false ||
    chart?.retired ||
    chart?.persistView === false
  )
    return;
  const key = viewKey(state.preferences),
    source = chart?.source;
  if (
    source &&
    (source.owner !== state.owner ||
      source.viewKey !== key ||
      source.uid !== selectedMarketRow(state.rows, state.preferences)?.uid)
  )
    return;
  const view = chart?.getView();
  if (view && state.owner !== "guest") await saveChartView(state.owner, key, view);
}

export function historyDepthTransition(
  controller: Controller,
  patch: Partial<TerminalPreferences>
) {
  const initial = controller.getSnapshot(),
    p = initial.preferences,
    destination = { ...p, ...patch },
    uid = selectedMarketRow(initial.rows, p)?.uid;
  const changing =
    patch.rangeDays !== undefined &&
    patch.rangeDays !== p.rangeDays &&
    destination.symbol === p.symbol &&
    destination.timeframe === p.timeframe &&
    destination.engine === p.engine &&
    selectedMarketRow(initial.rows, destination)?.uid === uid;
  if (!changing)
    return {
      active: false,
      valid: () => true,
      carry: () => Promise.resolve(true),
      dispose: () => {}
    };
  const key = viewKey(p),
    owner = initial.owner,
    revision = initial.chartRevision;
  let cancelled = false;
  const valid = () => {
    const state = controller.getSnapshot();
    return (
      !cancelled &&
      state.owner === owner &&
      state.chartRevision === revision &&
      viewKey(state.preferences) === key &&
      selectedMarketRow(state.rows, state.preferences)?.uid === uid &&
      !state.backupBusy &&
      !state.importingBackup &&
      !state.importRecoveryRequired &&
      state.historyViewReady !== false &&
      !state.loading
    );
  };
  cancelled = !valid();
  const dispose = controller.subscribe(() => {
    if (!valid()) cancelled = true;
  });
  return {
    active: true,
    valid,
    dispose,
    async carry(next: TerminalPreferences, selectionCurrent: () => boolean): Promise<boolean> {
      if (!valid() || !selectionCurrent()) return false;
      const state = controller.getSnapshot(),
        chart = controller.chart,
        source = chart?.source;
      // Before a canvas mounts, preserve the same saved view it would restore.
      if (!chart) {
        const saved = await loadChartView(owner, key),
          current = () => valid() && selectionCurrent() && controller.chart === null;
        if (!current()) return false;
        return saved ? copyDepthChartView(owner, viewKey(next), saved, current) : true;
      }
      if (
        chart.retired ||
        chart.persistView === false ||
        !source ||
        source.owner !== owner ||
        source.viewKey !== key ||
        source.uid !== uid
      )
        return false;
      const view = chart.getView();
      if (!view) return !state.candles.length;
      const current = () =>
        valid() &&
        selectionCurrent() &&
        controller.chart === chart &&
        !chart.retired &&
        chart.persistView !== false;
      return copyDepthChartView(owner, viewKey(next), view, current);
    }
  };
}
