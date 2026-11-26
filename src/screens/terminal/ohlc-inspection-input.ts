import { useEffect, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import type { PixelPoint } from "../../model/types.js";
import { createOhlcInspection } from "../../model/ohlc-inspection.js";
import { ohlcHitTimestamp } from "../../model/ohlc-hit-test.js";
import { ohlcDisplayMode } from "../../model/ohlc-legend.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { chartRangeZoomSession } from "./chart-range-zoom-input.js";
import { chartMeasurement } from "./chart-measurement-session.js";

type PlotPointer = PointerEvent<HTMLDivElement>;

export function useOhlcInspection(
  controller: TerminalController,
  state: TerminalState,
  pixel: (event: PlotPointer) => PixelPoint,
  ignored: string
) {
  const { owner, activeTool, preferences } = state;
  const { chartSettings, engine, symbol, instrumentUid, timeframe } = preferences;
  const { chartType, bodyVisible, borderVisible, wickVisible } = chartSettings;
  const mode = ohlcDisplayMode(chartSettings);
  const hold = chartSettings?.ohlcOnHold === true;
  const zoom = chartRangeZoomSession(controller);
  const ruler = chartMeasurement(controller);
  const [selection, setSelection] = useState<{
    scope: object;
    timestamp: number | null;
  }>();
  const scope = useMemo(
    () => ({
      owner,
      engine,
      symbol,
      instrumentUid,
      timeframe,
      chartType,
      bodyVisible,
      borderVisible,
      wickVisible,
      mode,
      hold
    }),
    [
      owner,
      engine,
      symbol,
      instrumentUid,
      timeframe,
      chartType,
      bodyVisible,
      borderVisible,
      wickVisible,
      mode,
      hold
    ]
  );
  const inspection = useMemo(
    () =>
      createOhlcInspection(
        scope.hold,
        (timestamp) =>
          setSelection((current) =>
            current?.scope === scope && current.timestamp === timestamp
              ? current
              : { scope, timestamp }
          ),
        (run, delay) => {
          const timer = window.setTimeout(run, delay);
          return () => window.clearTimeout(timer);
        }
      ),
    [scope]
  );
  useEffect(() => {
    if (mode !== "candle") return;
    const unsubscribeZoom = zoom.subscribe(() => {
      if (zoom.isArmed()) inspection.clear();
    });
    const unsubscribeRuler = ruler.subscribe(() => {
      if (ruler.isActive()) inspection.clear();
    });
    window.addEventListener("blur", inspection.clear);
    return () => {
      unsubscribeZoom();
      unsubscribeRuler();
      window.removeEventListener("blur", inspection.clear);
      inspection.clear();
    };
  }, [inspection, mode, ruler, zoom]);
  useEffect(() => {
    if (activeTool) inspection.clear();
  }, [inspection, activeTool]);

  const enabled = (event: PlotPointer) =>
    mode === "candle" &&
    !zoom.isArmed() &&
    !event.defaultPrevented &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.metaKey &&
    !(
      event.target instanceof Element &&
      event.target.closest(`${ignored},button,input,select,textarea,a`)
    );
  const sample = (point: PixelPoint, touch: boolean) => {
    const current = controller.getSnapshot();
    const chart = controller.chart;
    if (
      !chart ||
      chart.retired ||
      current.activeTool ||
      current.importingBackup ||
      current.importRecoveryRequired ||
      current.profileTransition ||
      current.historyViewReady === false
    )
      return null;
    const quote = chart.pixelToPoint(point.x, point.y);
    return quote
      ? ohlcHitTimestamp(
          current.candles,
          point,
          quote,
          (tick) => chart.pointToPixel(tick),
          current.preferences.chartSettings,
          current.preferences.engine,
          touch
        )
      : null;
  };
  const touch = (event: PlotPointer) => event.pointerType !== "mouse";
  return {
    timestamp: !activeTool && selection?.scope === scope ? selection.timestamp : null,
    clear: inspection.clear,
    leave: inspection.leave,
    touchPress: inspection.touchPress,
    down(event: PlotPointer, blocked: boolean) {
      if (mode !== "candle") return;
      if (!event.isPrimary || blocked || !enabled(event)) {
        inspection.clear();
        return;
      }
      if (event.button !== 0) return;
      const point = pixel(event);
      const isTouch = touch(event);
      inspection.down(
        { id: event.pointerId, point, touch: isTouch, startedAt: event.timeStamp },
        sample(point, isTouch)
      );
    },
    move(event: PlotPointer, blocked: boolean) {
      if (mode !== "candle") return;
      if (blocked || !enabled(event)) {
        inspection.clear();
        return;
      }
      const point = pixel(event);
      const isTouch = touch(event);
      if (inspection.hasPress(event.pointerId))
        inspection.move(event.pointerId, point, () => sample(point, isTouch));
      else if (!isTouch && event.buttons === 0) inspection.hover(sample(point, false));
    },
    up(event: PlotPointer, blocked: boolean) {
      if (mode !== "candle" || !inspection.hasPress(event.pointerId)) return;
      if (blocked || !enabled(event)) {
        inspection.cancel(event.pointerId);
        return;
      }
      const point = pixel(event);
      inspection.up(event.pointerId, point, sample(point, touch(event)), event.timeStamp);
    },
    cancel(event: PlotPointer) {
      inspection.cancel(event.pointerId);
    }
  };
}
