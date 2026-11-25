import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import type { ChartAdapter } from "../../charts/adapter.js";
import { navigationText } from "../../i18n/messages-navigation.js";
import { chartNavigationReady } from "./chart-navigation-state.js";
import { useTerminal } from "./context.js";
import { userCameraAction } from "./controller-camera-sync.js";

const buttons = [
  ["zoomOut", "M5 12h14"],
  ["zoomIn", "M5 12h14M12 5v14"],
  ["older", "m14 6-6 6 6 6"],
  ["newer", "m10 6 6 6-6 6"],
  ["reset", "M4 9a8 8 0 1 1 0 6M4 4v5h5"]
] as const;
type Action = (typeof buttons)[number][0];
interface Position {
  chart: ChartAdapter;
  left: number;
  top: number;
}

function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

export function ChartNavigation() {
  const { controller, state } = useTerminal(),
    ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState<Position | null>(null);
  useEffect(() => {
    let frame = 0,
      previous = -Infinity;
    const update = (time: number) => {
      if (time - previous >= 120) {
        const chart = controller.chart,
          panel = ref.current?.parentElement,
          body = panel?.querySelector(".chart-body"),
          ready = chartNavigationReady(controller.getSnapshot(), chart),
          size = ready ? chart.plotSize() : null,
          panelRect = panel?.getBoundingClientRect(),
          bodyRect = body?.getBoundingClientRect(),
          next =
            ready && size && size.width > 0 && panelRect && bodyRect
              ? {
                  chart,
                  left: bodyRect.left - panelRect.left + size.width / 2,
                  top: bodyRect.bottom - panelRect.top - 68
                }
              : null;
        setPosition((old) =>
          old?.chart === next?.chart && old?.left === next?.left && old?.top === next?.top
            ? old
            : next
        );
        previous = time;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [controller]);
  const chart = controller.chart,
    ready = position?.chart === chart && chartNavigationReady(state, chart);
  const available = (action: Action) =>
    Boolean(
      ready &&
      chart &&
      (action === "reset"
        ? typeof chart.resetView === "function"
        : action === "older" || action === "newer"
          ? typeof chart.scroll === "function"
          : typeof chart.zoom === "function")
    );
  function perform(action: Action) {
    const current = controller.chart;
    if (!chartNavigationReady(controller.getSnapshot(), current)) return;
    userCameraAction(controller, current, () => {
      if (action === "reset") current.resetView?.();
      else if (action === "older" || action === "newer")
        current.scroll?.(action === "older" ? -1 : 1);
      else current.zoom?.(action === "zoomIn" ? 1 : -1);
    });
  }
  return (
    <div
      ref={ref}
      className="chart-navigation"
      role="group"
      aria-label={navigationText("navigation", state.preferences.locale)}
      style={position ? { left: position.left, top: position.top } : undefined}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      onContextMenu={(event) => {
        event.preventDefault();
        stop(event);
      }}
    >
      {buttons.map(([action, path]) => (
        <button
          key={action}
          type="button"
          data-chart-navigation={action}
          aria-label={navigationText(action, state.preferences.locale)}
          title={navigationText(action, state.preferences.locale)}
          disabled={!available(action)}
          onClick={() => perform(action)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={path} />
          </svg>
        </button>
      ))}
    </div>
  );
}
