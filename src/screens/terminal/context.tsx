import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { selectedSnapshot, shallowEqual } from "./snapshot-selector.js";
import { equalTerminalState, selectControlsState } from "./terminal-state-selection.js";
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
/** The default snapshot ignores crosshair-only updates. Select crosshair explicitly for hover UI. */
export function useTerminal<Selection = TerminalState>(
  select?: (state: TerminalState) => Selection,
  equal?: (before: Selection, next: Selection) => boolean
) {
  const controller = useTerminalController();
  const state = useTerminalState(
    controller,
    select ?? (identity as (state: TerminalState) => Selection),
    equal ?? (select ? Object.is : (equalTerminalState as (a: Selection, b: Selection) => boolean))
  );
  return { controller, state };
}
export function useTerminalControls() {
  return useTerminal(selectControlsState, shallowEqual);
}
