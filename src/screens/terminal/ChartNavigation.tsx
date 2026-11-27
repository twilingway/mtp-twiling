import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SyntheticEvent, PointerEvent, KeyboardEvent } from "react";
import type { ChartAdapter } from "../../charts/adapter.js";
import { navigationText } from "../../i18n/messages-navigation.js";
import { chartNavigationReady } from "./chart-navigation-state.js";
import { useTerminal } from "./context.js";
import { userCameraAction } from "./controller-camera-sync.js";
import { ChartScrollHold } from "./chart-scroll-hold.js";

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

const compactQuery = "(max-width: 800px), (hover: none), (pointer: coarse)";
const compactLayout = () => window.matchMedia(compactQuery).matches;
function subscribeCompactLayout(listener: () => void): () => void {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function ChartNavigation() {
  const { controller, state } = useTerminal(),
    ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState<Position | null>(null),
    [nearby, setNearby] = useState(false);
  const compact = useSyncExternalStore(subscribeCompactLayout, compactLayout, () => false);
  const hold = useMemo(() => new ChartScrollHold(controller), [controller]);
  useEffect(() => {
    if (compact) return;
    const panel = ref.current?.parentElement;
    if (!panel) return;
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = ref.current?.getBoundingClientRect();
      setNearby(
        !!bounds &&
          event.clientX >= bounds.left - 32 &&
          event.clientX <= bounds.right + 32 &&
          event.clientY >= bounds.top - 24 &&
          event.clientY <= bounds.bottom + 24
      );
    };
    const leave = () => setNearby(false);
    panel.addEventListener("pointermove", move);
    panel.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      panel.removeEventListener("pointermove", move);
      panel.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [compact]);
  useEffect(() => {
    const cancel = () => hold.cancel(),
      hidden = () => {
        if (document.visibilityState !== "visible") cancel();
      },
      unsubscribe = controller.subscribe(() => hold.validate());
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unsubscribe();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
      hold.cancel();
    };
  }, [compact, controller, hold]);
  useEffect(() => {
    if (compact) return;
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
  }, [compact, controller]);
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
  const direction = (action: Action) => (action === "older" ? -1 : action === "newer" ? 1 : null);
  function down(event: PointerEvent<HTMLButtonElement>, action: Action) {
    const value = direction(action);
    if (value === null || !available(action) || event.button !== 0 || event.isPrimary === false)
      return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget,
      id = event.pointerId;
    if (
      !hold.start(value, `pointer:${id}`, () => {
        if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
      })
    )
      return;
    try {
      target.setPointerCapture(id);
    } catch {
      hold.cancel(`pointer:${id}`);
    }
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, action: Action, up: boolean) {
    const value = direction(action);
    if (value === null || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const token = `key:${event.key}`;
    if (up) {
      if (hold.finish(token) === "short") perform(action);
    } else if (!event.repeat && available(action)) hold.start(value, token);
  }
  const actions = buttons.map(([action, path]) => (
    <button
      key={action}
      type="button"
      data-chart-navigation={action}
      aria-label={navigationText(action, state.preferences.locale)}
      title={navigationText(action, state.preferences.locale)}
      disabled={!available(action)}
      style={direction(action) !== null ? { touchAction: "none" } : undefined}
      onPointerDown={(event) => down(event, action)}
      onPointerUp={(event) => {
        event.stopPropagation();
        hold.finish(`pointer:${event.pointerId}`);
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        hold.cancel(`pointer:${event.pointerId}`);
      }}
      onLostPointerCapture={(event) => hold.cancel(`pointer:${event.pointerId}`)}
      onKeyDown={(event) => key(event, action, false)}
      onKeyUp={(event) => key(event, action, true)}
      onBlur={() => hold.cancel()}
      onClick={() => {
        const value = direction(action);
        if (value === null || hold.click(value)) perform(action);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={path} />
      </svg>
    </button>
  ));
  if (compact) return null;
  return (
    <div
      ref={ref}
      className="chart-navigation"
      data-compact={compact || undefined}
      data-nearby={(!compact && nearby) || undefined}
      role="group"
      aria-label={navigationText("navigation", state.preferences.locale)}
      style={position ? { left: position.left, top: position.top } : undefined}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onPointerCancel={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      onContextMenu={(event) => {
        event.preventDefault();
        stop(event);
      }}
    >
      {actions}
    </div>
  );
}
