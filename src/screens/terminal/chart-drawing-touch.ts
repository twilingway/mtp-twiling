import type { PointerEvent } from "react";
import { t } from "../../i18n/messages.js";
import { DEFAULT_FIB_LEVELS, drawingStyle } from "../../model/drawing-model.js";
import { isDrawing } from "../../model/backup-format.js";
import {
  drawingPointCount,
  isFreehandTool,
  isVertexTool,
  MAX_DRAWING_POINTS
} from "../../model/drawing-tool-policy.js";
import { DrawingStrokeSampler } from "../../model/drawing-stroke-sampler.js";
import type { DrawingTool, DrawingPoint, PixelPoint } from "../../model/types.js";
import type { TerminalController } from "./controller.js";
import { annotationDefaults, isAnnotationTool } from "../../model/drawing-annotation.js";
import { validCreationDraft } from "./drawing-creation-draft.js";

type PlotPointer = PointerEvent<HTMLDivElement>;

/** Actual pointer input overrides device media queries on hybrid devices. */
export function drawingHandleRadius(container: HTMLElement, coarse: boolean): number {
  const touch = container.closest<HTMLElement>(".chart-body")?.dataset.drawingTouch;
  return (touch === undefined ? coarse : touch === "true") ? 13 : 5;
}

/** Mouse clicks and touch drags share persistent time/price anchors. */
export function createDrawingInput(
  controller: TerminalController,
  pointAt: (point: PixelPoint, temporary: boolean) => DrawingPoint | null
) {
  let points: DrawingPoint[] = [];
  let placements: PixelPoint[] = [];
  let vertices: PixelPoint[] = [];
  let stroke: DrawingStrokeSampler | null = null;
  let scope: string | null = null;
  let pointerId: number | null = null;
  const scopeKey = () => {
    const state = controller.getSnapshot();
    return JSON.stringify([
      state.owner,
      state.preferences.symbol,
      state.preferences.instrumentUid,
      state.preferences.timeframe,
      state.activeTool
    ]);
  };
  let capture: { id: number; start: PixelPoint; element: HTMLDivElement } | null = null;
  const release = () => {
    const owned = capture;
    capture = null;
    if (owned?.element.hasPointerCapture(owned.id)) owned.element.releasePointerCapture(owned.id);
  };
  const cancel = () => {
    points = [];
    placements = [];
    vertices = [];
    stroke = null;
    scope = null;
    pointerId = null;
    release();
    const current = controller.getSnapshot(),
      draft = current.drawingCreationDraft;
    // Placement cancellation also runs on window blur; an open editor owns its preview.
    if (!draft || !validCreationDraft(current, draft)) controller.setPreview(null);
  };
  const settingsFor = (tool: DrawingTool, pixel?: PixelPoint) => {
    const current = controller.getSnapshot();
    const defaults = annotationDefaults(tool);
    const template = current.preferences.chartSettings.drawingTemplates?.[`default:${tool}`];
    const first = placements[0],
      end = pixel ?? placements.at(-1),
      size = isAnnotationTool(tool) ? controller.chart?.plotSize() : undefined;
    return {
      ...drawingStyle({ name: tool }),
      ...defaults,
      levelStyles: structuredClone(DEFAULT_FIB_LEVELS),
      ...template?.settings,
      ...(isAnnotationTool(tool) && {
        annotation: {
          ...defaults.annotation,
          ...template?.settings?.annotation,
          ...(first &&
            size && {
              screenX: Math.max(0, Math.min(1, first.x / size.width)),
              screenY: Math.max(0, Math.min(1, first.y / size.height))
            }),
          ...(tool === "signpost" &&
            placements.length > 1 &&
            first &&
            end && { offsetX: end.x - first.x, offsetY: end.y - first.y })
        }
      })
    };
  };
  const complete = () => {
    const current = controller.getSnapshot(),
      tool = current.activeTool;
    if (!tool || scope !== scopeKey()) return cancel();
    const candidate: unknown = {
      id: crypto.randomUUID(),
      name: tool,
      ...current.preferences.chartSettings.drawingTemplates?.[`default:${tool}`],
      points: tool === "signpost" ? points.slice(0, 1) : [...points],
      settings: settingsFor(tool)
    };
    cancel();
    if (isDrawing(candidate)) {
      if (isAnnotationTool(tool) && tool !== "flag" && tool !== "priceNote")
        controller.drawingCreation.begin(candidate);
      else void controller.addDrawing(candidate);
    } else controller.notify(t("Не удалось создать рисунок."));
  };
  const preview = (tool: DrawingTool, point?: DrawingPoint, pixel?: PixelPoint) =>
    controller.setPreview({
      id: "preview",
      name: tool,
      points: tool === "signpost" ? points.slice(0, 1) : point ? [...points, point] : [...points],
      settings: settingsFor(tool, pixel)
    });
  const finish = () => {
    const tool = controller.getSnapshot().activeTool;
    if (!tool || !isVertexTool(tool) || points.length < 2) return false;
    if (scope !== scopeKey()) {
      cancel();
      return false;
    }
    complete();
    return true;
  };
  return {
    active: () => capture !== null,
    pending: () => points.length > 0,
    owns: (id: number) => (capture?.id ?? pointerId) === id,
    cancel,
    finish,
    canFinish: () => points.length >= 2,
    down(event: PlotPointer, pixel: PixelPoint) {
      const tool = controller.getSnapshot().activeTool;
      if (!tool) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.isPrimary === false || capture) return true;
      if (points.length && scope !== scopeKey()) cancel();
      const point = pointAt(pixel, event.ctrlKey || event.metaKey);
      if (!point) return true;
      if (!points.length) scope = scopeKey();
      pointerId = event.pointerId;
      const required = drawingPointCount(tool);
      placements.push(pixel);
      if (isFreehandTool(tool)) {
        stroke = new DrawingStrokeSampler();
        stroke.add(point, pixel);
        points = stroke.points();
        capture = { id: event.pointerId, start: pixel, element: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (isVertexTool(tool)) {
        const first = vertices[0],
          last = vertices.at(-1);
        if (
          tool === "polyline" &&
          first &&
          points.length >= 3 &&
          Math.hypot(pixel.x - first.x, pixel.y - first.y) <
            (event.pointerType === "touch" ? 22 : 10)
        ) {
          if (points.length < MAX_DRAWING_POINTS) points.push({ ...points[0]! });
          complete();
          return true;
        }
        // A double click delivers two downs at the same location; retain one vertex.
        if (!last || Math.hypot(pixel.x - last.x, pixel.y - last.y) >= 1) {
          points.push(point);
          vertices.push(pixel);
        }
        if (points.length >= MAX_DRAWING_POINTS) {
          complete();
          return true;
        }
      } else if (event.pointerType === "touch" && required === 2) {
        points = [point];
        capture = { id: event.pointerId, start: pixel, element: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
      } else points.push(point);
      if (required !== null && points.length >= required) complete();
      else preview(tool);
      return true;
    },
    move(event: PlotPointer, pixel: PixelPoint) {
      const tool = controller.getSnapshot().activeTool;
      if (!tool || !points.length) return false;
      if (capture && capture.id !== event.pointerId) return true;
      const point = pointAt(pixel, event.ctrlKey || event.metaKey);
      if (point && stroke) {
        if (stroke.add(point, pixel)) {
          points = stroke.points();
          preview(tool);
        }
      } else if (point) preview(tool, point, pixel);
      return true;
    },
    up(event: PlotPointer, pixel: PixelPoint) {
      if (!capture || capture.id !== event.pointerId) return false;
      const start = capture.start,
        point = pointAt(pixel, event.ctrlKey || event.metaKey);
      if (point && Math.hypot(pixel.x - start.x, pixel.y - start.y) >= 6) {
        if (stroke) {
          stroke.add(point, pixel, true);
          points = stroke.points();
        } else {
          points.push(point);
          placements.push(pixel);
        }
        if (points.length >= 2) complete();
        else cancel();
      } else if (stroke && points.length >= 3) {
        // A closed stroke can end near its start after travelling a long distance.
        if (point) stroke.add(point, pixel, true);
        points = stroke.points();
        complete();
      } else cancel();
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
