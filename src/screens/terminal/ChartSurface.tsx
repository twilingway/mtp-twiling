import { t } from "../../i18n/messages.js";
import { useEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { hitDrawing } from "../../model/drawing-model.js";
import { annotationMeasureText } from "../../model/drawing-annotation-measure.js";
import { isAnnotationTool } from "../../model/drawing-annotation.js";
import { isDrawing } from "../../model/backup-format.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { dragChartDrawing } from "./chart-drawing-drag.js";
import type { DrawingDrag } from "./chart-drawing-drag.js";
import { isVertexTool } from "../../model/drawing-tool-policy.js";
import { chartBackground } from "../../model/theme.js";
import type { Drawing, PixelPoint } from "../../model/types.js";
import type { ChartAdapter, TechnicalSupplementalInputs } from "../../charts/adapter.js";
import { nativePriceStep, chartPriceFormat } from "../../charts/price-format.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { isPanMovement } from "../../charts/navigation.js";
import { useChartCanvas } from "./chart-lifecycle.js";
import { useTerminal } from "./context.js";
import type { TerminalState } from "./state.js";
import { drawingVisibleOnInterval } from "../../model/intervals/drawing-visibility.js";
import { technicalIndicatorGroups } from "../../model/technical-indicator-layout.js";
import { useCameraInput } from "./camera-input.js";
import { drawingRenderList } from "./drawing-settings-preview.js";
import { ChartMeasurementOverlay } from "./ChartMeasurement.js";
import { useChartMeasurementInput } from "./chart-measurement-input.js";
import { publishWorkspaceCrosshair } from "./workspace-sync-controller.js";
import { useOhlcInspection } from "./ohlc-inspection-input.js";
import { OhlcCandleCard } from "./OhlcCandleCard.js";
import { createDrawingContextSource } from "./chart-drawing-touch.js";
import { useChartDrawingInput } from "./chart-drawing-input.js";
import { AnnotationInlineEditor } from "./drawings/AnnotationInlineEditor.js";
const chartControls =
  "[data-image-id],.indicator-legend,.technical-pane-legends,.calendar-analysis-overlays,.drawing-finish,.annotation-inline-editor";

export function visibleDrawings(state: TerminalState): Drawing[] {
  if (drawingToolbarSettings(state.preferences.chartSettings).drawingsHidden) return [];
  return drawingRenderList(state).filter((drawing) =>
    drawingVisibleOnInterval(drawing.visibility, state.preferences.timeframe)
  );
}
export function ChartCanvas({
  slot = 1,
  supplemental,
  drawingProjection
}: {
  slot?: number;
  supplemental: TechnicalSupplementalInputs;
  drawingProjection?: EventTarget;
}) {
  const { state } = useTerminal(),
    ref = useRef<HTMLDivElement>(null);
  useChartCanvas(ref, visibleDrawings, supplemental, drawingProjection);
  return (
    <div
      id={slot === 1 ? "chart" : `chart-${slot}`}
      className="chart-canvas"
      ref={ref}
      style={{ background: chartBackground(state.preferences.chartSettings) }}
    />
  );
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
export function ChartGestures({
  children,
  drawingProjection
}: {
  children: ReactNode;
  drawingProjection?: EventTarget;
}) {
  const { controller, state } = useTerminal(),
    body = useRef<HTMLDivElement>(null),
    contextSource = useMemo(createDrawingContextSource, []),
    pointer = useRef<HTMLSpanElement>(null),
    drag = useRef<DrawingDrag | null>(null),
    pan = useRef<NativePan | null>(null);
  const lowerCount = technicalIndicatorGroups(state.preferences.technicalIndicators ?? []).filter(
    (item) => item.pane.kind === "pane"
  ).length;
  const legacyVolume = state.preferences.engine === "kline" && state.preferences.indicators.volume;
  const minimumHeight = lowerCount ? 160 + 28 + 31 * (lowerCount + (legacyVolume ? 1 : 0)) : 0;
  const cameraInput = useCameraInput(controller);
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
  const measurement = useChartMeasurementInput(controller, state, pixel, chartControls);
  const ohlc = useOhlcInspection(controller, state, pixel, chartControls);
  const find = (p: PixelPoint, touch = false) => {
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
          size.height,
          touch ? 22 : 10,
          {
            selectedId: controller.getSnapshot().selectedObject,
            hoveredId: controller.getSnapshot().hoveredDrawingId ?? null,
            measureText: annotationMeasureText,
            formatPrice: (value) =>
              value.toFixed(
                chartPriceFormat(
                  selectedMarketRow(
                    controller.getSnapshot().rows,
                    controller.getSnapshot().preferences
                  ) ?? { symbol: "", step: null }
                ).precision
              )
          }
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
  const cursorKind = (hasVisibleMarker = false) => {
    const mode = drawingToolbarSettings(controller.getSnapshot().preferences.chartSettings).cursor;
    return mode === "arrow"
      ? "default"
      : mode === "eraser"
        ? "cell"
        : mode === "dot" || mode === "demonstration"
          ? hasVisibleMarker
            ? "none"
            : "default"
          : "crosshair";
  };
  const { drawingInput, drawingPoint } = useChartDrawingInput(controller, state, body, drag);
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current) return stop(event);
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest(chartControls))
    )
      return;
    if (controller.getSnapshot().drawingCreationDraft) return stop(event);
    const chart = controller.chart;
    if (!chart) return;
    const p = pixel(event),
      size = chart.plotSize();
    if (p.x > size.width || p.y > size.height) return;
    controller.setContext(null);
    if (drawingInput.down(event, p)) return;
    if (event.isPrimary === false) return;
    const hit = find(p, event.pointerType === "touch");
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
      pointerId: event.pointerId,
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
    let markerVisible = false;
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
      markerVisible = visible;
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
    if (drawingInput.move(event, p)) return;
    const active = drag.current;
    if (active && active.pointerId !== event.pointerId) return;
    if (!active || !controller.editing.gestureActive(active.token)) {
      drag.current = null;
      const size = chart.plotSize(),
        inPlot = p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
      const hoveredId = inPlot ? (find(p)?.id ?? null) : null;
      if (current.hoveredDrawingId !== hoveredId)
        controller.update({ hoveredDrawingId: hoveredId });
      cursor(
        event.currentTarget,
        inPlot
          ? current.activeTool
            ? "crosshair"
            : find(p)
              ? "pointer"
              : cursorKind(markerVisible)
          : ""
      );
      return;
    }
    stop(event);
    if (active.clone && !active.cloneId && !event.ctrlKey && !event.metaKey) active.clone = false;
    if (active.clone && !active.cloneId) {
      if (Math.hypot(p.x - active.start.x, p.y - active.start.y) <= 8) return;
      active.cloneId = crypto.randomUUID();
    }
    const step = nativePriceStep(selectedMarketRow(current.rows, current.preferences));
    const candidate = dragChartDrawing(active, p, chart, drawingPoint, step);
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
    contextSource.up(event);
    if (drawingInput.up(event, pixel(event))) return;
    if (event.pointerId === pan.current?.pointerId) {
      finishNativePan(pan);
      cursor(event.currentTarget, cursorKind());
    }
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    stop(event);
    const token = drag.current.token;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    cursor(event.currentTarget, find(pixel(event)) ? "pointer" : cursorKind());
    void controller.editing
      .finishGesture(token)
      .catch((error: unknown) =>
        controller.notify(
          error instanceof Error ? error.message : t("Не удалось сохранить рисунок.")
        )
      );
  }
  function cancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawingInput.pending() && !drawingInput.owns(event.pointerId)) return;
    if (drag.current && drag.current.pointerId !== event.pointerId) return;
    contextSource.up(event);
    if (drawingInput.pending()) drawingInput.cancel();
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
      ref={body}
      className={`chart-body ${state.activeTool ? "drawing-active" : ""}`}
      style={{ minHeight: minimumHeight }}
      onPointerDownCapture={(event) => {
        event.currentTarget.dataset.drawingTouch = String(event.pointerType === "touch");
        contextSource.down(
          event,
          Boolean(find(pixel(event), event.pointerType === "touch")) || Boolean(state.activeTool)
        );
        if (!measurement.down(event) && cameraInput.down(event) !== false) {
          down(event);
          ohlc.down(event, measurement.active() || pan.current?.pointerId !== event.pointerId);
        } else ohlc.clear();
      }}
      onPointerMoveCapture={(event) => {
        if (measurement.move(event)) {
          ohlc.clear();
          if (pointer.current) pointer.current.style.display = "none";
          cursor(event.currentTarget, "crosshair");
        } else if (cameraInput.move(event) !== false) {
          move(event);
          ohlc.move(event, Boolean(drag.current || pan.current?.started || measurement.active()));
        }
      }}
      onPointerUpCapture={(event) => {
        cameraInput.up(event);
        if (!measurement.up(event)) {
          ohlc.up(event, Boolean(drag.current || pan.current?.started || measurement.active()));
          up(event);
        } else ohlc.clear();
      }}
      onWheelCapture={(event) => {
        ohlc.clear();
        cameraInput.action(event);
      }}
      onPointerCancelCapture={(event) => {
        ohlc.cancel(event);
        measurement.cancel(event);
        cameraInput.up(event);
        cancel(event);
      }}
      onLostPointerCapture={(event) => {
        ohlc.cancel(event);
        measurement.cancel(event);
        cameraInput.up(event);
        // Touch taps release the browser's implicit capture after pointerup. Only loss of
        // capture explicitly owned by an active drawing gesture can cancel its draft.
        if (
          (drawingInput.active() && drawingInput.owns(event.pointerId)) ||
          drag.current?.pointerId === event.pointerId ||
          pan.current?.pointerId === event.pointerId
        )
          cancel(event);
      }}
      onPointerLeave={(event) => {
        if (controller.getSnapshot().hoveredDrawingId)
          controller.update({ hoveredDrawingId: null });
        ohlc.leave();
        measurement.cancel(event);
        if (pointer.current) pointer.current.style.display = "none";
        controller.setCrosshair(null);
        publishWorkspaceCrosshair(controller, null);
        if (!drag.current && !pan.current) cursor(event.currentTarget, "");
      }}
      onDoubleClickCapture={(event) => {
        if (measurement.active()) return;
        if (drawingInput.finish()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (cameraInput.action(event) === false) return;
        if (event.target instanceof Element && event.target.closest(chartControls)) return;
        const hit = find(pixel(event));
        if (hit) {
          event.preventDefault();
          event.stopPropagation();
          controller.selectObject(hit.id);
          const drawing = controller.getSnapshot().drawings.find((item) => item.id === hit.id);
          if (
            drawing &&
            isAnnotationTool(drawing.name) &&
            !["table", "flag", "priceNote", "priceLabel"].includes(drawing.name)
          ) {
            controller.setDialog("annotation-editor");
            controller.drawingSettings.begin(hit.id);
          } else controller.setDialog("drawing-settings");
        }
      }}
      onContextMenuCapture={(event) => {
        if (event.target instanceof Element && event.target.closest(chartControls)) return;
        event.preventDefault();
        event.stopPropagation();
        if (ohlc.touchPress() || contextSource.suppress(event.nativeEvent)) return;
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
      <AnnotationInlineEditor projection={drawingProjection} />
      {state.activeTool &&
        isVertexTool(state.activeTool) &&
        (state.preview?.points.length ?? 0) >= 2 && (
          <button
            type="button"
            className="drawing-finish"
            disabled={!drawingInput.canFinish()}
            style={{
              position: "absolute",
              left: 12,
              top: 48,
              zIndex: 12,
              minHeight: 44,
              padding: "8px 16px"
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              drawingInput.finish();
            }}
          >
            {t("Завершить рисунок")}
          </button>
        )}
      {ohlc.timestamp != null && (
        <OhlcCandleCard timestamp={ohlc.timestamp} drawingProjection={drawingProjection} />
      )}
      <ChartMeasurementOverlay
        controller={controller}
        state={state}
        {...(drawingProjection ? { drawingProjection } : {})}
      />
      <span
        ref={pointer}
        className="drawing-pointer"
        data-cursor={drawingToolbarSettings(state.preferences.chartSettings).cursor}
      />
    </div>
  );
}
