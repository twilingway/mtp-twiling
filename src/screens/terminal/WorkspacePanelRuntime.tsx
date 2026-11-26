import { useLayoutEffect } from "react";
import type { ReactNode } from "react";
import { TerminalContext } from "./context.js";
import type { TerminalState } from "./state.js";
import type { WorkspacePanelController, WorkspacePanelRow } from "./workspace-panel-controller.js";

export function WorkspacePanelRuntime({
  controller,
  parentState,
  row,
  children
}: {
  controller: WorkspacePanelController;
  parentState: TerminalState;
  row: WorkspacePanelRow | undefined;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const unsubscribe = controller.editing.observeWorkspaceAnnotations();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller]);
  useLayoutEffect(() => {
    controller.configure(row, parentState);
  }, [controller, parentState, row]);
  return <TerminalContext value={controller}>{children}</TerminalContext>;
}
