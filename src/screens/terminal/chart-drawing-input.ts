import { useCallback, useEffect, useMemo } from "react";
import type { RefObject } from "react";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import type { PixelPoint } from "../../model/types.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { snapDrawingPoint } from "../../model/drawing-magnet.js";
import { nativePriceStep, roundPriceToStep } from "../../charts/price-format.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { createDrawingInput, observeOwnedDrawingTouch } from "./chart-drawing-touch.js";
import { registerDrawingCompletion } from "./drawing-input-completion.js";

export function useChartDrawingInput(
  controller: TerminalController,
  state: TerminalState,
  body: RefObject<HTMLDivElement | null>,
  drag: RefObject<unknown>
) {
  const drawingPoint = useCallback(
    (p: PixelPoint, temporary: boolean) => {
      const chart = controller.chart;
      const raw = chart?.pixelToPoint(p.x, p.y);
      if (!chart || !raw) return null;
      const current = controller.getSnapshot(),
        options = drawingToolbarSettings(current.preferences.chartSettings);
      const mode = temporary ? (options.magnet === "off" ? "weak" : "off") : options.magnet;
      const flags = current.preferences.indicators;
      const indicators =
        flags.mtpAll && current.preferences.chartSettings.mtpAllHidden
          ? { ...flags, mtpAll: false, mtp160: false, mtp440: false, mtp640: false }
          : flags;
      const point = snapDrawingPoint(
        raw,
        p,
        current.candles,
        (point) => chart.pointToPixel(point),
        mode,
        options.snapIndicators && !options.indicatorsHidden ? indicators : undefined
      );
      const step = nativePriceStep(selectedMarketRow(current.rows, current.preferences));
      return { ...point, value: roundPriceToStep(point.value, step) };
    },
    [controller]
  );
  const drawingInput = useMemo(
    () => createDrawingInput(controller, drawingPoint),
    [controller, drawingPoint]
  );
  useEffect(() => {
    drawingInput.cancel();
    return drawingInput.cancel;
  }, [
    drawingInput,
    state.owner,
    state.preferences.symbol,
    state.preferences.instrumentUid,
    state.preferences.timeframe,
    state.activeTool
  ]);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    return observeOwnedDrawingTouch(element, () => Boolean(drag.current) || drawingInput.active());
  }, [drawingInput, body, drag]);
  useEffect(() => {
    const unregister = registerDrawingCompletion(controller, drawingInput.finish);
    const blur = () => drawingInput.cancel();
    window.addEventListener("blur", blur);
    return () => {
      unregister();
      window.removeEventListener("blur", blur);
    };
  }, [controller, drawingInput]);
  return { drawingInput, drawingPoint };
}
