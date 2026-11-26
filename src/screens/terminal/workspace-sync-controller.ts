import { nativeTimeframe } from "../../model/intervals/native-timeframes.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { Timeframe } from "../../model/types.js";
import { nativeInterval } from "../../services/providers/bybit/market.js";
import { okxNativeInterval } from "../../services/providers/okx/market.js";
import { cameraCurrent, subscribeCamera } from "./controller-camera-sync.js";
import type { TerminalController } from "./controller.js";
import type { WorkspaceSync, WorkspaceSyncIntent } from "./workspace-sync.js";

interface Binding {
  owner: string;
  slot: number;
  workspace: WorkspaceSync;
}

const bindings = new WeakMap<TerminalController, Binding>();

function currentBinding(controller: TerminalController) {
  const binding = bindings.get(controller);
  const state = controller.getSnapshot();
  return binding &&
    state.owner === binding.owner &&
    !state.profileTransition &&
    !state.importingBackup &&
    !state.importRecoveryRequired
    ? binding
    : undefined;
}

function currentInstrument(controller: TerminalController) {
  const { rows, preferences } = controller.getSnapshot();
  return selectedMarketRow(rows, preferences);
}

export function registerWorkspaceSync(
  workspace: WorkspaceSync,
  slot: number,
  controller: TerminalController
): () => void {
  const owner = controller.getSnapshot().owner;
  const binding = { owner, slot, workspace };
  bindings.set(controller, binding);
  const current = (intent?: WorkspaceSyncIntent) =>
    currentBinding(controller) === binding && (intent?.isCurrent() ?? true);
  const readyChart = () => {
    const chart = controller.chart;
    return current() && cameraCurrent(controller, chart) ? chart : null;
  };
  const unregister = workspace.register(slot, {
    readInstrument: () => (current() ? (currentInstrument(controller)?.uid ?? null) : null),
    readTimeframe: () =>
      current() && currentInstrument(controller)
        ? controller.getSnapshot().preferences.timeframe
        : null,
    readViewport: () => {
      const view = readyChart()?.getView();
      if (view?.from === undefined || view.to === undefined) return null;
      return { from: view.from * 1000, to: view.to * 1000 };
    },
    setInstrument: (uid, intent) => {
      if (!current(intent) || currentInstrument(controller)?.uid === uid) return;
      const { rows, authenticated } = controller.getSnapshot();
      const row = rows.find((candidate) => candidate.uid === uid);
      if (!row || (!authenticated && !row.providerRef)) return;
      return controller.setPreferences({ symbol: row.symbol, instrumentUid: uid }, false, () =>
        current(intent)
      );
    },
    setTimeframe: (timeframe, intent) => {
      if (!current(intent) || controller.getSnapshot().preferences.timeframe === timeframe) return;
      const row = currentInstrument(controller);
      if (!row) return;
      nativeTimeframe(timeframe);
      if (row.providerRef?.provider === "okx") okxNativeInterval(timeframe);
      if (row.providerRef?.provider === "bybit") nativeInterval(timeframe);
      return controller.setPreferences({ timeframe }, false, () => current(intent));
    },
    setCrosshair: (timestamp) => {
      if (timestamp === null) controller.chart?.setLinkedCrosshair?.(null);
      else readyChart()?.setLinkedCrosshair?.(timestamp);
    },
    setViewport: (viewport) => readyChart()?.setLinkedTimeWindow?.(viewport)
  });
  const unsubscribe = subscribeCamera(controller, (kind) => {
    if (kind === "change" && current()) workspace.publishViewport(slot);
  });
  return () => {
    unsubscribe();
    unregister();
    if (bindings.get(controller) === binding) bindings.delete(controller);
  };
}

export function publishWorkspaceInstrument(controller: TerminalController, uid?: string | null) {
  const binding = currentBinding(controller);
  const instrument = currentInstrument(controller)?.uid;
  if (binding && instrument && (uid == null || uid === instrument))
    binding.workspace.publishInstrument(binding.slot, instrument);
}

export function publishWorkspaceTimeframe(controller: TerminalController, timeframe: Timeframe) {
  const binding = currentBinding(controller);
  if (binding && controller.getSnapshot().preferences.timeframe === timeframe)
    binding.workspace.publishTimeframe(binding.slot, timeframe);
}

export function publishWorkspaceCrosshair(
  controller: TerminalController,
  timestamp: number | null
) {
  const binding = currentBinding(controller);
  if (binding) binding.workspace.publishCrosshair(binding.slot, timestamp);
}
