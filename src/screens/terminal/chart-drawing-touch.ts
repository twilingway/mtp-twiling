import type { PointerEvent } from "react";
import { t } from "../../i18n/messages.js";
import { DEFAULT_FIB_LEVELS, drawingStyle } from "../../model/drawing-model.js";
import { isDrawing } from "../../model/backup-format.js";
import type { DrawingPoint, PixelPoint } from "../../model/types.js";
import type { TerminalController } from "./controller.js";

type PlotPointer = PointerEvent<HTMLDivElement>;

/** Multi-click on mouse; a single captured drag for two-point touch tools. */
export function createDrawingInput(
  controller: TerminalController,
  pointAt: (point: PixelPoint, temporary: boolean) => DrawingPoint | null
) {
  let points: DrawingPoint[] = [];
  let touch: { id: number; start: PixelPoint } | null = null;
  const cancel = () => {
    points = [];
    touch = null;
    controller.setPreview(null);
  };
  const complete = () => {
    const current = controller.getSnapshot(),
      tool = current.activeTool;
    if (!tool) return cancel();
    const candidate: unknown = {
      id: crypto.randomUUID(),
      name: tool,
      points: [...points],
      settings: {
        ...drawingStyle({ name: tool }),
        levelStyles: structuredClone(DEFAULT_FIB_LEVELS)
      },
      ...current.preferences.chartSettings.drawingTemplates?.[`default:${tool}`]
    };
    cancel();
    if (isDrawing(candidate)) void controller.addDrawing(candidate);
    else controller.notify(t("Не удалось создать рисунок."));
  };
  return {
    active: () => touch !== null,
    owns: (id: number) => touch?.id === id,
    cancel,
    down(event: PlotPointer, pixel: PixelPoint) {
      const tool = controller.getSnapshot().activeTool;
      if (!tool) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.isPrimary === false) return true;
      if (touch) return true;
      const point = pointAt(pixel, event.ctrlKey || event.metaKey);
      if (!point) return true;
      const required = [
        "horizontalStraightLine",
        "horizontalRayLine",
        "verticalStraightLine"
      ].includes(tool)
        ? 1
        : tool === "fibonacciExtension"
          ? 3
          : 2;
      if (event.pointerType === "touch" && required === 2) {
        points = [point];
        touch = { id: event.pointerId, start: pixel };
        event.currentTarget.setPointerCapture(event.pointerId);
      } else points.push(point);
      if (points.length >= required) complete();
      else controller.setPreview({ id: "preview", name: tool, points: [...points] });
      return true;
    },
    move(event: PlotPointer, pixel: PixelPoint) {
      const tool = controller.getSnapshot().activeTool;
      if (!tool || !points.length) return false;
      if (touch && touch.id !== event.pointerId) return true;
      const point = pointAt(pixel, event.ctrlKey || event.metaKey);
      if (point) controller.setPreview({ id: "preview", name: tool, points: [...points, point] });
      return true;
    },
    up(event: PlotPointer, pixel: PixelPoint) {
      if (!touch || touch.id !== event.pointerId) return false;
      const start = touch.start,
        point = pointAt(pixel, event.ctrlKey || event.metaKey);
      if (point && Math.hypot(pixel.x - start.x, pixel.y - start.y) >= 6) {
        points.push(point);
        complete();
      } else cancel();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return true;
    }
  };
}

/** Android may deliver contextmenu as MouseEvent, without pointerType. */
export function createDrawingContextSource() {
  let touchObject = false,
    until = 0;
  return {
    down(event: { pointerType: string; timeStamp: number }, object: boolean) {
      touchObject = event.pointerType === "touch" && object;
      until = Infinity;
    },
    up(event: { timeStamp: number }) {
      until = event.timeStamp + 1200;
    },
    suppress(event: { timeStamp: number; pointerType?: string }) {
      return touchObject && event.pointerType !== "mouse" && event.timeStamp <= until;
    }
  };
}

/** Pointer handling owns editing; do not also feed the SDK native touch stream. */
export function observeOwnedDrawingTouch(element: HTMLElement, active: () => boolean) {
  const ownTouch = (event: TouchEvent) => {
    if (!active()) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener("touchstart", ownTouch, { capture: true, passive: false });
  element.addEventListener("touchmove", ownTouch, { capture: true, passive: false });
  return () => {
    element.removeEventListener("touchstart", ownTouch, true);
    element.removeEventListener("touchmove", ownTouch, true);
  };
}
