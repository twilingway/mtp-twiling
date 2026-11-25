import type { ChartAdapter } from "../../charts/adapter.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { viewKey } from "./controller-bridge.js";
import type { TerminalState } from "./state.js";

export function chartNavigationReady(
  state: TerminalState,
  chart: ChartAdapter | null
): chart is ChartAdapter {
  const source = chart?.source;
  return Boolean(
    chart &&
    source &&
    !chart.retired &&
    chart.persistView !== false &&
    state.authenticated &&
    state.candles.length &&
    !state.loading &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    state.historyViewReady !== false &&
    source.owner === state.owner &&
    source.viewKey === viewKey(state.preferences) &&
    source.uid === selectedMarketRow(state.rows, state.preferences)?.uid &&
    chart.getView()
  );
}
