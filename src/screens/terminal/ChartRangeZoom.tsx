import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { chartMeasurement } from "./chart-measurement-session.js";
import {
  bindChartRangeZoom,
  chartRangeZoomReady,
  chartRangeZoomSession,
  type ZoomRectangle
} from "./chart-range-zoom-input.js";
import { useTerminal } from "./context.js";
import { DrawingToolIcon } from "./DrawingToolIcon.js";

const labels = { ru: "Увеличить выбранную область", en: "Zoom to selection" };

export function ChartRangeZoomButton({ onChoose }: { onChoose?: () => void } = {}) {
  const { controller, state } = useTerminal();
  const session = chartRangeZoomSession(controller);
  const armed = useSyncExternalStore(session.subscribe, session.isArmed, session.isArmed);
  const label = labels[state.preferences.locale ?? "ru"];
  return (
    <button
      type="button"
      id="zoom"
      className="tool"
      aria-label={label}
      aria-pressed={armed}
      title={label}
      disabled={!chartRangeZoomReady(state)}
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

export function ChartRangeZoom({ active }: { active: boolean }) {
  const { controller } = useTerminal();
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
