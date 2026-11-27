import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { selectedSnapshot, shallowEqual } from "./snapshot-selector.js";
import { selectControlsState } from "./terminal-state-selection.js";
export const TerminalContext = createContext<TerminalController | null>(null);
const identity = (state: TerminalState) => state;
export function useTerminalController() {
  const controller = useContext(TerminalContext);
  if (!controller) throw new Error("Terminal provider is missing");
  return controller;
}
export function useTerminalState<Selection>(
  controller: TerminalController,
  select: (state: TerminalState) => Selection,
  equal: (before: Selection, next: Selection) => boolean = Object.is
) {
  const getSelected = useMemo(
    () => selectedSnapshot(controller.getSnapshot, select, equal),
    [controller, select, equal]
  );
  return useSyncExternalStore(controller.subscribe, getSelected, getSelected);
}
export function useTerminal<Selection = TerminalState>(
  select: (state: TerminalState) => Selection = identity as (state: TerminalState) => Selection,
  equal: (before: Selection, next: Selection) => boolean = Object.is
) {
  const controller = useTerminalController();
  const state = useTerminalState(controller, select, equal);
  return { controller, state };
}
export function useTerminalControls() {
  return useTerminal(selectControlsState, shallowEqual);
}
