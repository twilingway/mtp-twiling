import type { TechnicalPaneMetric } from "./adapter.js";

/** Native separators own dragging; this gate only captures completed user edits and reports bounds. */
export function attachTechnicalPaneEvents(
  container: HTMLElement,
  options: {
    metrics: () => readonly TechnicalPaneMetric[];
    apply: () => void;
    capture: (
      before: readonly TechnicalPaneMetric[],
      after: readonly TechnicalPaneMetric[]
    ) => void;
    changed: () => void;
  }
) {
  let active: { pointer: number; y: number; before: readonly TechnicalPaneMetric[] } | null = null;
  let disposed = false,
    frame = 0,
    finishing = false;
  let viewportWidth = container.clientWidth,
    viewportHeight = container.clientHeight;
  const schedule = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed) options.changed();
    });
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || active || finishing) return;
    const metrics = options.metrics(),
      rect = container.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (!metrics.slice(1).some((item) => Math.abs(item.top - y) <= 6)) return;
    active = {
      pointer: event.pointerId,
      y: event.clientY,
      before: metrics.map((item) => ({ ...item }))
    };
  };
  const stop = () => {
    const restore = active !== null || finishing;
    active = null;
    finishing = false;
    if (restore && !disposed) {
      options.apply();
      schedule();
    }
  };
  const up = (event: PointerEvent) => {
    const gesture = active;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    active = null;
    if (Math.abs(event.clientY - gesture.y) < 2) return;
    finishing = true;
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed || !finishing) return;
        finishing = false;
        options.capture(gesture.before, options.metrics());
        options.changed();
      });
    });
  };
  const resize = new ResizeObserver(() => {
    if (disposed) return;
    if (viewportWidth !== container.clientWidth || viewportHeight !== container.clientHeight) {
      viewportWidth = container.clientWidth;
      viewportHeight = container.clientHeight;
      stop();
    }
    if (!active && !finishing) options.apply();
    schedule();
  });
  resize.observe(container);
  container.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", stop, true);
  window.addEventListener("blur", stop);
  return {
    cancel: stop,
    schedule,
    observe: (element: Element) => resize.observe(element),
    dragging: () => active !== null || finishing,
    dispose() {
      disposed = true;
      stop();
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      container.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("blur", stop);
    }
  };
}
