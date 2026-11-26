import { useEffect, useRef } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { useTerminal } from "./context.js";
import { startChartDemonstration } from "./chart-demonstration.js";

export function ChartDemonstration({ active }: { active: boolean }) {
  const { controller, state } = useTerminal();
  const canvas = useRef<HTMLCanvasElement>(null);
  const enabled =
    active &&
    !state.activeTool &&
    !state.dialog &&
    !state.profileTransition &&
    !state.backupBusy &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    drawingToolbarSettings(state.preferences.chartSettings).cursor === "demonstration";

  useEffect(() => {
    const overlay = canvas.current;
    const host = overlay?.parentElement;
    const chart = host?.querySelector<HTMLElement>(":scope > .chart-canvas");
    if (!enabled || !overlay || !host || !chart) return;
    return startChartDemonstration(overlay, host, chart, () => controller.chart?.plotSize());
  }, [controller, enabled, state.chartRevision]);

  return <canvas ref={canvas} className="chart-demonstration" aria-hidden="true" />;
}
