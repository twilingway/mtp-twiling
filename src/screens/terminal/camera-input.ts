import { useEffect, useMemo } from "react";
import type { PointerEvent, SyntheticEvent } from "react";
import type { ChartAdapter } from "../../charts/adapter.js";
import type { TerminalController } from "./controller.js";
import { cameraCurrent, userCameraAction } from "./controller-camera-sync.js";

export function createCameraInput(controller: TerminalController) {
  const pointers = new Map<number, number>();
  let owned: ChartAdapter | null = null;
  const eligible = (event: SyntheticEvent) =>
    !(
      typeof Element !== "undefined" &&
      event.target instanceof Element &&
      event.target.closest(
        ".chart-navigation,[data-image-id],.indicator-legend,.technical-pane-legends,button,input,select,textarea,a"
      )
    );
  const blocked = (event: SyntheticEvent): boolean => {
    const state = controller.getSnapshot();
    if (
      eligible(event) &&
      (state.importingBackup || state.importRecoveryRequired || controller.chart?.retired)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  };
  const finish = (event?: { pointerId: number }) => {
    if (event) pointers.delete(event.pointerId);
    else pointers.clear();
    if (!pointers.size) {
      owned?.endViewInteraction?.();
      owned = null;
    }
  };
  return {
    down(event: PointerEvent<HTMLDivElement>) {
      if (blocked(event)) return false;
      if (!eligible(event) || event.button !== 0 || !cameraCurrent(controller, controller.chart))
        return;
      pointers.set(event.pointerId, event.clientX);
      owned = controller.chart;
      owned.beginViewInteraction?.(false);
    },
    move(event: PointerEvent<HTMLDivElement>) {
      if (blocked(event)) return false;
      const start = pointers.get(event.pointerId),
        chart = owned;
      if (start === undefined || !cameraCurrent(controller, chart)) return;
      // Pure vertical movement is outside the current portable X-camera format.
      chart.beginViewInteraction?.(pointers.size > 1 || Math.abs(start - event.clientX) > 0.5);
    },
    up: finish,
    cancel: () => finish(),
    action(event: SyntheticEvent) {
      if (blocked(event)) return false;
      if (eligible(event) && cameraCurrent(controller, controller.chart))
        userCameraAction(controller, controller.chart, () => {});
    }
  };
}

export function useCameraInput(controller: TerminalController) {
  const input = useMemo(() => createCameraInput(controller), [controller]);
  useEffect(() => {
    const up = (event: globalThis.PointerEvent) => input.up(event),
      blur = () => input.cancel();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", blur);
      input.cancel();
    };
  }, [input]);
  return input;
}
