import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import { chartMeasurement } from "./chart-measurement-session.js";
import {
  bindChartRangeZoom,
  chartRangeZoomReady,
  chartRangeZoomSession,
  type ZoomRectangle
} from "./chart-range-zoom-input.js";
import { useTerminal, useTerminalController } from "./context.js";
import { shallowEqual } from "./snapshot-selector.js";
import type { TerminalState } from "./state.js";
import {
  chartNavigationReady,
  chartNavigationSelectionReady,
  selectChartNavigationState
} from "./chart-navigation-state.js";
import { userCameraAction } from "./controller-camera-sync.js";
import { DrawingToolIcon } from "./DrawingToolIcon.js";

const labels = { ru: "Увеличить выбранную область", en: "Zoom to selection" };
const selectRangeZoomButtonState = (state: TerminalState) => ({
  locale: state.preferences.locale,
  activeTool: state.activeTool,
  ready: chartRangeZoomReady(state)
});

export function ChartRangeZoomButton({ onChoose }: { onChoose?: () => void } = {}) {
  const { controller, state } = useTerminal(selectRangeZoomButtonState, shallowEqual);
  const session = chartRangeZoomSession(controller);
  const armed = useSyncExternalStore(session.subscribe, session.isArmed, session.isArmed);
  const label = labels[state.locale ?? "ru"];
  return (
    <button
      type="button"
      id="zoom"
      className="tool"
      aria-label={label}
      aria-pressed={armed}
      title={label}
      disabled={!state.ready}
      onClick={() => {
        onChoose?.();
        if (!armed) {
          chartMeasurement(controller).dismiss();
          if (state.activeTool) controller.setTool(null);
        }
        session.set(!armed);
      }}
    >
      <DrawingToolIcon name="zoom" />
    </button>
  );
}

export function ChartZoomOutButton({ onChoose }: { onChoose: () => void }) {
  const { controller, state } = useTerminal(selectChartNavigationState, shallowEqual);
  const chart = controller.chart;
  // Adapter attachment and capabilities can change without a new store snapshot.
  const ready = chartNavigationSelectionReady(state, chart) && !!chart.zoom;
  const label = t("Уменьшить масштаб", state.locale);
  return (
    <button
      id="zoom-out"
      type="button"
      className="tool"
      title={label}
      aria-label={label}
      disabled={!ready}
      onClick={() => {
        const activeChart = controller.chart;
        if (!chartNavigationReady(controller.getSnapshot(), activeChart) || !activeChart.zoom)
          return;
        onChoose();
        userCameraAction(controller, activeChart, () => activeChart.zoom?.(-1));
      }}
    >
      <DrawingToolIcon name="zoomOut" />
    </button>
  );
}

export function ChartRangeZoom({ active }: { active: boolean }) {
  const controller = useTerminalController();
  const session = chartRangeZoomSession(controller);
  const armed = useSyncExternalStore(session.subscribe, session.isArmed, session.isArmed);
  const anchor = useRef<HTMLSpanElement>(null);
  const [rectangle, setRectangle] = useState<ZoomRectangle | null>(null);
  useLayoutEffect(() => {
    if (!armed) return;
    const host = anchor.current?.parentElement;
    if (active && host) return bindChartRangeZoom(host, controller, setRectangle);
    session.set(false);
  }, [active, armed, controller, session]);
  return (
    <span
      ref={anchor}
      className="chart-range-zoom"
      data-armed={active && armed ? true : undefined}
      aria-hidden="true"
      hidden={!active || !armed}
    >
      {rectangle && <span className="chart-range-zoom-rectangle" style={rectangle} />}
    </span>
  );
}
