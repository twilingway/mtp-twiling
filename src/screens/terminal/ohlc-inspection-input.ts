import { useEffect, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import type { PixelPoint } from "../../model/types.js";
import { createOhlcInspection } from "../../model/ohlc-inspection.js";
import { ohlcCandleIndex, ohlcDisplayMode } from "../../model/ohlc-legend.js";
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
  const mode = ohlcDisplayMode(chartSettings);
  const hold = chartSettings?.ohlcOnHold === true;
  const zoom = chartRangeZoomSession(controller);
  const ruler = chartMeasurement(controller);
  const [selection, setSelection] = useState<{
    scope: object;
    timestamp: number | null;
  }>();
  const scope = useMemo(
    () => ({ owner, engine, symbol, instrumentUid, timeframe, mode, hold }),
    [owner, engine, symbol, instrumentUid, timeframe, mode, hold]
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
  const sample = ({ x, y }: PixelPoint) => {
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
    const point = chart.pixelToPoint(x, y);
    return point && ohlcCandleIndex(current.candles, point.timestamp) >= 0 ? point.timestamp : null;
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
      inspection.down(
        { id: event.pointerId, point, touch: touch(event), startedAt: event.timeStamp },
        sample(point)
      );
    },
    move(event: PlotPointer, blocked: boolean) {
      if (mode !== "candle") return;
      if (blocked || !enabled(event)) {
        inspection.clear();
        return;
      }
      const point = pixel(event);
      inspection.move(event.pointerId, point);
      if (!touch(event) && event.buttons === 0) inspection.hover(sample(point));
    },
    up(event: PlotPointer, blocked: boolean) {
      if (mode !== "candle") return;
      if (blocked || !enabled(event)) {
        inspection.cancel(event.pointerId);
        return;
      }
      const point = pixel(event);
      inspection.up(event.pointerId, point, sample(point), event.timeStamp);
    },
    cancel(event: PlotPointer) {
      inspection.cancel(event.pointerId);
    }
  };
}
