import { marketAvailable } from "./market-readiness.js";
import type { ChartAdapter } from "../../charts/adapter.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { viewKey } from "./controller-bridge.js";
import type { TerminalState } from "./state.js";

/** Only immutable store fields belong in the cached navigation selection. */
export function selectChartNavigationState(state: TerminalState) {
  return {
    owner: state.owner,
    viewKey: viewKey(state.preferences),
    uid: selectedMarketRow(state.rows, state.preferences)?.uid,
    locale: state.preferences.locale,
    ready: Boolean(
      marketAvailable(state) &&
      state.candles.length &&
      !state.loading &&
      !state.importingBackup &&
      !state.importRecoveryRequired &&
      state.historyViewReady !== false
    )
  };
}

export function chartNavigationSelectionReady(
  state: ReturnType<typeof selectChartNavigationState>,
  chart: ChartAdapter | null
): chart is ChartAdapter {
  const source = chart?.source;
  return Boolean(
    chart &&
    source &&
    !chart.retired &&
    chart.persistView !== false &&
    state.ready &&
    source.owner === state.owner &&
    source.viewKey === state.viewKey &&
    source.uid === state.uid &&
    chart.getView()
  );
}

export function chartNavigationReady(
  state: TerminalState,
  chart: ChartAdapter | null
): chart is ChartAdapter {
  return chartNavigationSelectionReady(selectChartNavigationState(state), chart);
}
