import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { TechnicalPaneMetric } from "../../charts/adapter.js";

interface PanePointer {
  clientX: number;
  clientY: number;
}

const tapSlop = 8;

function movedOutsideTap(from: PanePointer, to: PanePointer): boolean {
  return Math.hypot(from.clientX - to.clientX, from.clientY - to.clientY) > tapSlop;
}

export function technicalPaneAtPointer(
  point: PanePointer,
  box: Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">,
  metrics: readonly TechnicalPaneMetric[]
): string | undefined {
  if (
    !Number.isFinite(point.clientX) ||
    !Number.isFinite(point.clientY) ||
    point.clientX < box.left ||
    point.clientX >= box.right ||
    point.clientY < box.top ||
    point.clientY >= box.bottom
  )
    return;
  const y = point.clientY - box.top;
  return metrics.find(
    (pane) => pane.key.startsWith("pane:") && y >= pane.top && y < pane.top + pane.height
  )?.key;
}

function trackPanePointer(
  layer: HTMLDivElement,
  body: HTMLElement,
  metrics: () => readonly TechnicalPaneMetric[]
) {
  const subscription = new AbortController();
  const passive = { capture: true, passive: true, signal: subscription.signal };
  let hovered: HTMLElement | undefined;
  let touched: HTMLElement | undefined;
  let pointer: PanePointer | undefined;
  let pendingTouch: AbortController | undefined;

  const paneAt = (point: PanePointer) => {
    const key = technicalPaneAtPointer(point, layer.getBoundingClientRect(), metrics());
    return key
      ? Array.from(layer.children).find(
          (item): item is HTMLElement =>
            item instanceof HTMLElement && item.dataset.technicalPane === key
        )
      : undefined;
  };
  const setHovered = (pane: HTMLElement | undefined) => {
    if (hovered === pane) return;
    hovered?.removeAttribute("data-pane-hover");
    hovered = pane;
    hovered?.setAttribute("data-pane-hover", "true");
  };
  const refreshHover = () => setHovered(pointer ? paneAt(pointer) : undefined);
  const clearHover = () => {
    pointer = undefined;
    refreshHover();
  };
  const move = ({ pointerType, clientX, clientY }: PointerEvent) => {
    if (pointerType !== "touch") {
      pointer = { clientX, clientY };
      refreshHover();
    }
  };
  const setTouched = (pane: HTMLElement | undefined) => {
    if (touched === pane) return;
    touched?.removeAttribute("data-pane-touch");
    touched = pane;
    touched?.setAttribute("data-pane-touch", "true");
  };
  const cancelTouch = () => {
    pendingTouch?.abort();
    pendingTouch = undefined;
  };
  const down = (start: PointerEvent) => {
    cancelTouch();
    if (start.pointerType !== "touch") {
      setTouched(undefined);
      const pane =
        start.target instanceof Element
          ? start.target.closest(".technical-pane-actions")?.parentElement
          : undefined;
      // The native press precedes the browser changing from keyboard to mouse focus.
      if (pane?.parentElement === layer) {
        pointer = { clientX: start.clientX, clientY: start.clientY };
        setHovered(pane);
      }
      return;
    }
    clearHover();
    const pane =
      start.isPrimary && start.target instanceof Node && body.contains(start.target)
        ? paneAt(start)
        : undefined;
    if (touched !== pane) setTouched(undefined);
    if (!pane) return;
    pendingTouch = new AbortController();
    const touchOptions = { capture: true, passive: true, signal: pendingTouch.signal };
    const abandon = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return;
      setTouched(undefined);
      cancelTouch();
    };
    const document = body.ownerDocument;
    document.addEventListener(
      "pointermove",
      (event) => {
        if (movedOutsideTap(start, event)) abandon(event);
      },
      touchOptions
    );
    document.addEventListener("pointercancel", abandon, touchOptions);
    document.addEventListener(
      "pointerup",
      (event) => {
        if (event.pointerId !== start.pointerId) return;
        const valid = !movedOutsideTap(start, event) && pane === paneAt(event);
        setTouched(valid ? pane : undefined);
        cancelTouch();
      },
      touchOptions
    );
  };
  body.addEventListener("pointermove", move, passive);
  body.addEventListener("pointerleave", clearHover, { signal: subscription.signal });
  body.ownerDocument.defaultView?.addEventListener(
    "blur",
    () => {
      clearHover();
      setTouched(undefined);
      cancelTouch();
    },
    passive
  );
  body.parentElement?.addEventListener("scroll", refreshHover, passive);
  body.ownerDocument.addEventListener("pointerdown", down, passive);
  return {
    refreshHover,
    stop() {
      subscription.abort();
      clearHover();
      setTouched(undefined);
      cancelTouch();
    }
  };
}

export function useTechnicalPaneActionReveal(
  root: RefObject<HTMLDivElement | null>,
  metrics: readonly TechnicalPaneMetric[],
  enabled: boolean
): void {
  const currentMetrics = useRef(metrics);
  const tracker = useRef<ReturnType<typeof trackPanePointer> | undefined>(undefined);
  useLayoutEffect(() => {
    currentMetrics.current = metrics;
    tracker.current?.refreshHover();
  }, [metrics]);
  useEffect(() => {
    const layer = root.current;
    const body = layer?.parentElement;
    if (!enabled || !layer || !body) return;
    const instance = trackPanePointer(layer, body, () => currentMetrics.current);
    tracker.current = instance;
    return () => {
      tracker.current = undefined;
      instance.stop();
    };
  }, [enabled, root]);
}
