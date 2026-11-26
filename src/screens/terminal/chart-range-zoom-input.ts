import type { ChartAdapter } from "../../charts/adapter.js";
import type { PixelPoint } from "../../model/types.js";
import { chartMeasurement } from "./chart-measurement-session.js";
import { cameraCurrent, userCameraAction } from "./controller-camera-sync.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";

class ChartRangeZoomSession {
  private armed = false;
  private readonly listeners = new Set<() => void>();
  isArmed = () => this.armed;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set = (armed: boolean) => {
    if (this.armed === armed) return;
    this.armed = armed;
    for (const listener of this.listeners) listener();
  };
}

const sessions = new WeakMap<TerminalController, ChartRangeZoomSession>();
export function chartRangeZoomSession(controller: TerminalController) {
  let session = sessions.get(controller);
  if (!session) {
    session = new ChartRangeZoomSession();
    sessions.set(controller, session);
  }
  return session;
}

type PlotSize = { width: number; height: number };
export type ZoomRectangle = PlotSize & { left: number; top: number };
type Drag = { pointerId: number; from: PixelPoint };
const minimumSize = 8;
const interactiveTargets =
  "button,input,select,textarea,a,[role=button],[contenteditable],[data-image-id],.indicator-legend,.technical-pane-legends,.calendar-analysis-overlays,.chart-message";

export function chartRangeZoomReady(state: TerminalState): boolean {
  return (
    state.candles.length > 0 &&
    !state.loading &&
    state.historyViewReady !== false &&
    !state.importingBackup &&
    !state.importRecoveryRequired &&
    !state.profileTransition
  );
}

function contains(size: PlotSize, point: PixelPoint) {
  return point.x >= 0 && point.y >= 0 && point.x < size.width && point.y < size.height;
}

function clippedRectangle(size: PlotSize, from: PixelPoint, to: PixelPoint): ZoomRectangle {
  const x = (value: number) => Math.min(size.width, Math.max(0, value));
  const y = (value: number) => Math.min(size.height, Math.max(0, value));
  const left = x(Math.min(from.x, to.x));
  const top = y(Math.min(from.y, to.y));
  return {
    left,
    top,
    width: x(Math.max(from.x, to.x)) - left,
    height: y(Math.max(from.y, to.y)) - top
  };
}

function absorb(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

export function bindChartRangeZoom(
  host: HTMLElement,
  controller: TerminalController,
  preview: (rectangle: ZoomRectangle | null) => void
): (() => void) | undefined {
  const view = host.ownerDocument.defaultView;
  const chart = controller.chart;
  const session = chartRangeZoomSession(controller);
  const initial = controller.getSnapshot();
  const revision = initial.chartRevision;
  if (
    !view ||
    !chart?.zoomToSelection ||
    !chartRangeZoomReady(initial) ||
    initial.activeTool ||
    !cameraCurrent(controller, chart)
  ) {
    session.set(false);
    return;
  }
  const activeChart: ChartAdapter = chart;
  const abort = new AbortController();
  const capture = { capture: true, passive: false, signal: abort.signal };
  let drag: Drag | null = null;
  const eligible = (target: EventTarget | null) =>
    target instanceof view.Element && host.contains(target) && !target.closest(interactiveTargets);
  const pixel = (event: Pick<PointerEvent, "clientX" | "clientY">): PixelPoint => {
    const { left, top } = host.getBoundingClientRect();
    return { x: event.clientX - left, y: event.clientY - top };
  };
  const ready = () => {
    const state = controller.getSnapshot();
    return (
      chartRangeZoomReady(state) &&
      !state.activeTool &&
      revision === state.chartRevision &&
      cameraCurrent(controller, activeChart)
    );
  };
  const clear = () => {
    if (!drag) return;
    const { pointerId } = drag;
    drag = null;
    if (host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId);
    preview(null);
  };
  const cancel = () => {
    clear();
    session.set(false);
  };
  const rectangle = (from: PixelPoint, to: PixelPoint) =>
    clippedRectangle(activeChart.plotSize(), from, to);

  view.addEventListener(
    "pointerdown",
    (event) => {
      if (!session.isArmed()) return;
      if (drag) {
        if (drag.pointerId !== event.pointerId) cancel();
        return;
      }
      if (!event.isPrimary || event.button !== 0 || !eligible(event.target)) return;
      if (!ready()) {
        cancel();
        return;
      }
      const from = pixel(event);
      if (!contains(activeChart.plotSize(), from)) return;
      absorb(event);
      drag = { pointerId: event.pointerId, from };
      try {
        host.setPointerCapture(event.pointerId);
      } catch (error) {
        // An already released pointer can still reach the window listeners.
        if (!(error instanceof view.DOMException) || error.name !== "NotFoundError") throw error;
      }
    },
    capture
  );
  view.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerId !== drag?.pointerId) return;
      absorb(event);
      if (ready()) preview(rectangle(drag.from, pixel(event)));
      else cancel();
    },
    capture
  );
  view.addEventListener(
    "pointerup",
    (event) => {
      if (event.pointerId !== drag?.pointerId) return;
      absorb(event);
      const { left, top, width, height } = rectangle(drag.from, pixel(event));
      clear();
      if (!ready()) {
        cancel();
        return;
      }
      if (width < minimumSize || height < minimumSize) return;
      const from = activeChart.pixelToPoint(left, top);
      const to = activeChart.pixelToPoint(left + width, top + height);
      if (
        !from ||
        !to ||
        from.timestamp === to.timestamp ||
        from.value === to.value ||
        ![from.timestamp, from.value, to.timestamp, to.value].every(Number.isFinite)
      )
        return;
      session.set(false);
      userCameraAction(controller, activeChart, () => activeChart.zoomToSelection?.(from, to));
    },
    capture
  );
  const cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === drag?.pointerId) cancel();
  };
  view.addEventListener("pointercancel", cancelPointer, capture);
  host.addEventListener("lostpointercapture", cancelPointer, { signal: abort.signal });
  view.addEventListener(
    "touchstart",
    (event) => {
      if (
        session.isArmed() &&
        ready() &&
        Array.from(event.changedTouches).some(
          (touch) => eligible(touch.target) && contains(activeChart.plotSize(), pixel(touch))
        )
      ) {
        absorb(event);
        if (event.touches.length > 1) cancel();
      }
    },
    capture
  );
  view.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !session.isArmed()) return;
      cancel();
      if (!host.ownerDocument.querySelector("dialog[open]")) absorb(event);
    },
    capture
  );
  view.addEventListener("blur", cancel, { signal: abort.signal });
  host.ownerDocument.addEventListener(
    "visibilitychange",
    () => {
      if (host.ownerDocument.visibilityState !== "visible") cancel();
    },
    { signal: abort.signal }
  );
  const unsubscribe = controller.subscribe(() => {
    if (!ready()) cancel();
  });
  const measurement = chartMeasurement(controller);
  const unsubscribeMeasurement = measurement.subscribe(() => {
    if (measurement.isActive()) cancel();
  });
  return () => {
    abort.abort();
    unsubscribe();
    unsubscribeMeasurement();
    cancel();
  };
}
