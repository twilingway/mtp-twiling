import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";
import { nativePriceStep, roundPriceToStep } from "../../charts/price-format.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { PixelPoint } from "../../model/types.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { chartMeasurement } from "./chart-measurement-session.js";

type PlotPointer = PointerEvent<HTMLDivElement>;
type Pending = { id: number; x: number; y: number; phase: string };
const tapSlop = 8;

export function useChartMeasurementInput(
  controller: TerminalController,
  state: TerminalState,
  coordinates: (event: PlotPointer) => PixelPoint,
  ignored: string
) {
  const session = chartMeasurement(controller);
  const pending = useRef<Pending | null>(null);
  const { symbol, instrumentUid, timeframe, engine } = state.preferences;
  useEffect(
    () => () => {
      pending.current = null;
      session.dismiss();
    },
    [
      session,
      state.owner,
      state.chartRevision,
      state.importingBackup,
      state.importRecoveryRequired,
      state.profileTransition,
      symbol,
      instrumentUid,
      timeframe,
      engine
    ]
  );
  useEffect(() => {
    if (state.activeTool) session.dismiss();
  }, [session, state.activeTool]);

  const pointAt = (event: PlotPointer) => {
    const current = controller.getSnapshot();
    const chart = controller.chart;
    if (
      chart?.retired ||
      current.importingBackup ||
      current.importRecoveryRequired ||
      current.profileTransition ||
      current.historyViewReady === false ||
      !current.candles.length ||
      (typeof Element !== "undefined" &&
        event.target instanceof Element &&
        event.target.closest(`${ignored},button,input,select,textarea,a`))
    )
      return null;
    const { x, y } = coordinates(event);
    const raw = chart?.pixelToPoint(x, y);
    if (!raw || !Number.isFinite(raw.timestamp) || !Number.isFinite(raw.value)) return null;
    const step = nativePriceStep(selectedMarketRow(current.rows, current.preferences));
    return { ...raw, value: roundPriceToStep(raw.value, step) };
  };
  const absorb = (event: PlotPointer) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return {
    down(event: PlotPointer) {
      if (event.button !== 0 || !event.isPrimary) return false;
      const shortcut = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      const { phase } = session.get();
      if (phase === "idle" && !shortcut) return false;
      if (!pointAt(event)) return false;
      if (phase === "result") session.dismiss();
      if (phase === "result" && !shortcut) return false;
      pending.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        phase: session.get().phase
      };
      absorb(event);
      return true;
    },
    move(event: PlotPointer) {
      const { phase } = session.get();
      if (!event.isPrimary || (phase !== "armed" && phase !== "tracking")) return false;
      const point = pointAt(event);
      if (!point) return false;
      if (phase === "tracking") session.preview(point);
      return true;
    },
    up(event: PlotPointer) {
      const press = pending.current;
      if (!press || press.id !== event.pointerId) return false;
      pending.current = null;
      absorb(event);
      if (
        press.phase !== session.get().phase ||
        Math.hypot(press.x - event.clientX, press.y - event.clientY) > tapSlop
      )
        return true;
      const point = pointAt(event);
      if (point) session.select(point);
      return true;
    },
    cancel(event: PlotPointer) {
      if (pending.current?.id === event.pointerId) pending.current = null;
    },
    active: session.isActive
  };
}
