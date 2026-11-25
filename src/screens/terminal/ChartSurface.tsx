import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { DEFAULT_FIB_LEVELS, drawingStyle, hitDrawing } from "../../model/drawing-model.js";
import { isDrawing } from "../../model/backup-format.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { snapDrawingPoint } from "../../model/drawing-magnet.js";
import { chartBackground } from "../../model/theme.js";
import type { Drawing, DrawingPoint, PixelPoint } from "../../model/types.js";
import type { ChartAdapter } from "../../charts/adapter.js";
import { isPanMovement } from "../../charts/navigation.js";
import { useChartCanvas } from "./chart-lifecycle.js";
import { useTerminal } from "./context.js";
import type { TerminalState } from "./state.js";
import { drawingVisibleOnInterval } from "../../model/intervals/drawing-visibility.js";

export function visibleDrawings(state: TerminalState): Drawing[] {
  if (drawingToolbarSettings(state.preferences.chartSettings).drawingsHidden) return [];
  return state.drawings.filter((drawing) =>
    drawingVisibleOnInterval(drawing.visibility, state.preferences.timeframe)
  );
}
export function ChartCanvas() {
  const { state } = useTerminal(),
    ref = useRef<HTMLDivElement>(null);
  useChartCanvas(ref, visibleDrawings);
  return (
    <div
      id="chart"
      ref={ref}
      style={{ background: chartBackground(state.preferences.chartSettings) }}
    />
  );
}
interface Drag {
  id: string;
  handle: number;
  start: PixelPoint;
  original: Drawing;
  pixels: (PixelPoint | null)[];
  token: number;
  clone: boolean;
  cloneId: string | null;
}
interface NativePan {
  pointerId: number;
  chart: ChartAdapter;
  element: HTMLDivElement;
  start: PixelPoint;
  started: boolean;
}
function finishNativePan(pan: { current: NativePan | null }) {
  if (!pan.current) return;
  const { chart, element, started } = pan.current;
  pan.current = null;
  if (started) chart.endPan?.();
  delete element.dataset.chartPan;
  delete element.dataset.objectCursor;
  element.style.removeProperty("--drawing-cursor");
}
export function ChartGestures({ children }: { children: ReactNode }) {
  const { controller, state } = useTerminal(),
    draft = useRef<DrawingPoint[]>([]),
    pointer = useRef<HTMLSpanElement>(null),
    drag = useRef<Drag | null>(null),
    pan = useRef<NativePan | null>(null);
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      if (event.pointerId === pan.current?.pointerId) finishNativePan(pan);
    };
    const blur = () => finishNativePan(pan);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", blur);
      finishNativePan(pan);
    };
  }, []);
  useEffect(() => {
    draft.current = [];
    drag.current = null;
    finishNativePan(pan);
  }, [
    state.owner,
    state.preferences.symbol,
    state.preferences.instrumentUid,
    state.preferences.timeframe,
    state.activeTool
  ]);
  const pixel = (event: {
    clientX: number;
    clientY: number;
    currentTarget: HTMLDivElement;
  }): PixelPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const find = (p: PixelPoint) => {
    const chart = controller.chart;
    if (!chart) return null;
    const size = chart.plotSize();
    return p.x > size.width || p.y > size.height
      ? null
      : hitDrawing(
          visibleDrawings(controller.getSnapshot()),
          p,
          (point) => chart.pointToPixel(point),
          size.width,
          size.height
        );
  };
  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const cursor = (element: HTMLDivElement, value: string) => {
    if (value) {
      element.dataset.objectCursor = value;
      element.style.setProperty("--drawing-cursor", value);
    } else {
      delete element.dataset.objectCursor;
      element.style.removeProperty("--drawing-cursor");
    }
  };
  const cursorKind = () => {
    const mode = drawingToolbarSettings(controller.getSnapshot().preferences.chartSettings).cursor;
    return mode === "arrow"
      ? "default"
      : mode === "eraser"
        ? "cell"
        : mode === "dot" || mode === "demonstration"
          ? "none"
          : "crosshair";
  };
  const drawingPoint = (p: PixelPoint, temporary: boolean) => {
    const chart = controller.chart;
    const raw = chart?.pixelToPoint(p.x, p.y);
    if (!chart || !raw) return null;
    const current = controller.getSnapshot(),
      options = drawingToolbarSettings(current.preferences.chartSettings);
    const mode = temporary ? (options.magnet === "off" ? "weak" : "off") : options.magnet;
    return snapDrawingPoint(
      raw,
      p,
      current.candles,
      (point) => chart.pointToPixel(point),
      mode,
      options.snapIndicators && !options.indicatorsHidden
        ? current.preferences.indicators
        : undefined
    );
  };
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("[data-image-id],.indicator-legend"))
    )
      return;
    const chart = controller.chart;
    if (!chart) return;
    const p = pixel(event),
      size = chart.plotSize();
    if (p.x > size.width || p.y > size.height) return;
    controller.setContext(null);
    const tool = controller.getSnapshot().activeTool;
    if (tool) {
      stop(event);
      const point = drawingPoint(p, event.ctrlKey || event.metaKey);
      if (!point) return;
      draft.current.push(point);
      const required = [
        "horizontalStraightLine",
        "horizontalRayLine",
        "verticalStraightLine"
      ].includes(tool)
        ? 1
        : tool === "fibonacciExtension"
          ? 3
          : 2;
      if (draft.current.length >= required) {
        const candidate: unknown = {
          id: crypto.randomUUID(),
          name: tool,
          points: [...draft.current],
          settings: { ...drawingStyle({}), levelStyles: structuredClone(DEFAULT_FIB_LEVELS) },
          ...controller.getSnapshot().preferences.chartSettings.drawingTemplates?.[
            `default:${tool}`
          ]
        };
        if (isDrawing(candidate)) void controller.addDrawing(candidate);
        else controller.notify("Не удалось создать рисунок.");
        draft.current = [];
      } else controller.setPreview({ id: "preview", name: tool, points: [...draft.current] });
      return;
    }
    const hit = find(p);
    const tools = drawingToolbarSettings(controller.getSnapshot().preferences.chartSettings);
    if (tools.cursor === "eraser") {
      stop(event);
      const drawing = controller.getSnapshot().drawings.find((item) => item.id === hit?.id);
      if (drawing && !drawing.lock && !tools.drawingsLocked)
        void controller.setDrawings(
          controller.getSnapshot().drawings.filter((item) => item.id !== drawing.id)
        );
      return;
    }
    controller.selectObject(hit?.id ?? null);
    if (!hit) {
      pan.current = {
        pointerId: event.pointerId,
        chart,
        element: event.currentTarget,
        start: p,
        started: false
      };
      event.currentTarget.dataset.chartPan = "true";
      cursor(event.currentTarget, "grabbing");
      return;
    }
    const drawing = controller.getSnapshot().drawings.find((item) => item.id === hit.id);
    if (!drawing || drawing.lock || tools.drawingsLocked) return;
    stop(event);
    drag.current = {
      id: drawing.id,
      handle: hit.handle,
      start: p,
      original: structuredClone(drawing),
      pixels: drawing.points.map((point) => chart.pointToPixel(point)),
      token: controller.editing.beginGesture(),
      clone: event.ctrlKey || event.metaKey,
      cloneId: null
    };
    cursor(event.currentTarget, "grabbing");
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const chart = controller.chart;
    if (!chart) return;
    const p = pixel(event),
      current = controller.getSnapshot();
    if (pointer.current) {
      const size = chart.plotSize(),
        mode = drawingToolbarSettings(current.preferences.chartSettings).cursor;
      const visible =
        !current.activeTool &&
        !pan.current &&
        !drag.current &&
        (mode === "dot" || mode === "demonstration") &&
        p.x >= 0 &&
        p.y >= 0 &&
        p.x <= size.width &&
        p.y <= size.height;
      pointer.current.style.display = visible ? "block" : "none";
      pointer.current.style.transform = `translate(${p.x}px,${p.y}px)`;
    }
    if (pan.current) {
      const native = pan.current;
      if (!native.started && isPanMovement(native.start, p)) {
        native.chart.beginPan?.(native.start);
        native.started = true;
      }
      return;
    }
    if (current.activeTool && draft.current.length) {
      const point = drawingPoint(p, event.ctrlKey || event.metaKey);
      if (point)
        controller.setPreview({
          id: "preview",
          name: current.activeTool,
          points: [...draft.current, point]
        });
      return;
    }
    const active = drag.current;
    if (!active || !controller.editing.gestureActive(active.token)) {
      drag.current = null;
      const size = chart.plotSize(),
        inPlot = p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
      cursor(
        event.currentTarget,
        inPlot ? (current.activeTool ? "crosshair" : find(p) ? "pointer" : cursorKind()) : ""
      );
      return;
    }
    stop(event);
    if (active.clone && !active.cloneId && !event.ctrlKey && !event.metaKey) active.clone = false;
    if (active.clone && !active.cloneId) {
      if (Math.hypot(p.x - active.start.x, p.y - active.start.y) <= 8) return;
      active.cloneId = crypto.randomUUID();
    }
    const points = active.original.points.map((point, i) => {
      if (!active.clone && active.handle >= 0 && active.handle !== i) return point;
      const start = active.pixels[i];
      return start
        ? ((!active.clone && active.handle >= 0
            ? drawingPoint(
                { x: start.x + p.x - active.start.x, y: start.y + p.y - active.start.y },
                false
              )
            : chart.pixelToPoint(start.x + p.x - active.start.x, start.y + p.y - active.start.y)) ??
            point)
        : point;
    });
    const candidate: unknown = { ...active.original, id: active.cloneId ?? active.id, points };
    if (isDrawing(candidate)) {
      const exists = current.drawings.some((item) => item.id === candidate.id);
      controller.editing.previewGesture(active.token, {
        drawings: exists
          ? current.drawings.map((item) => (item.id === candidate.id ? candidate : item))
          : [...current.drawings, candidate],
        selectedObject: candidate.id
      });
    }
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerId === pan.current?.pointerId) {
      finishNativePan(pan);
      cursor(event.currentTarget, cursorKind());
    }
    if (!drag.current) return;
    stop(event);
    const token = drag.current.token;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    cursor(event.currentTarget, find(pixel(event)) ? "pointer" : cursorKind());
    void controller.editing
      .finishGesture(token)
      .catch((error: unknown) =>
        controller.notify(error instanceof Error ? error.message : "Не удалось сохранить рисунок.")
      );
  }
  function cancel(event: ReactPointerEvent<HTMLDivElement>) {
    finishNativePan(pan);
    if (!drag.current) return;
    drag.current = null;
    controller.editing.cancelGesture();
    cursor(event.currentTarget, "");
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <div
      className={`chart-body ${state.activeTool ? "drawing-active" : ""}`}
      onPointerDownCapture={down}
      onPointerMoveCapture={move}
      onPointerUpCapture={up}
      onPointerCancelCapture={cancel}
      onLostPointerCapture={cancel}
      onPointerLeave={(event) => {
        if (pointer.current) pointer.current.style.display = "none";
        controller.setCrosshair(null);
        if (!drag.current && !pan.current) cursor(event.currentTarget, "");
      }}
      onDoubleClickCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-image-id],.indicator-legend")
        )
          return;
        const hit = find(pixel(event));
        if (hit) {
          event.preventDefault();
          event.stopPropagation();
          controller.selectObject(hit.id);
          controller.setDialog("drawing-settings");
        }
      }}
      onContextMenuCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-image-id],.indicator-legend")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const hit = find(pixel(event));
        controller.selectObject(hit?.id ?? null);
        controller.setContext({
          x: event.clientX,
          y: event.clientY,
          target: hit ? { kind: "drawing", id: hit.id } : { kind: "chart" }
        });
      }}
    >
      {children}
      <span
        ref={pointer}
        className="drawing-pointer"
        data-cursor={drawingToolbarSettings(state.preferences.chartSettings).cursor}
      />
    </div>
  );
}
