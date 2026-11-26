import type { TerminalController } from "./controller.js";

const active = new WeakMap<TerminalController, TerminalController>();

export function setActiveWorkspaceChart(root: TerminalController, chart: TerminalController) {
  active.set(root, chart);
  return () => {
    if (active.get(root) === chart) active.delete(root);
  };
}

export function activeWorkspaceChart(root: TerminalController): TerminalController {
  return active.get(root) ?? root;
}
