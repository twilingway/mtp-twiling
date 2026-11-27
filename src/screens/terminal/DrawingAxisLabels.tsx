import { useLayoutEffect, useMemo } from "react";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { useTerminal } from "./context.js";
import { drawingVisibleOnInterval } from "../../model/intervals/drawing-visibility.js";
import { chartDateFormat } from "../../i18n/format.js";
import { drawingRenderList } from "./drawing-settings-preview.js";
import { drawingPriceTargets } from "../../model/drawing-price-labels.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { precision } from "../../charts/adapter.js";
import type { DrawingAxisLabels as AxisLabels } from "../../charts/adapter.js";
import { intlLocale } from "../../i18n/preferences.js";
import { drawingPriceLabelStyle } from "../../model/last-price-style.js";
import { bindDrawingAxisLabels } from "./drawing-projection.js";

export function DrawingAxisLabels({ drawingProjection }: { drawingProjection: EventTarget }) {
  const { controller, state } = useTerminal();
  const { timeframe, chartSettings } = state.preferences;
  const drawingsHidden = drawingToolbarSettings(chartSettings).drawingsHidden;
  const drawings = drawingRenderList(state);
  const visible = useMemo(() => {
    if (drawingsHidden) return [];
    return drawings.filter(
      (item) => item.visible !== false && drawingVisibleOnInterval(item.visibility, timeframe)
    );
  }, [drawings, drawingsHidden, timeframe]);
  const selected = drawingsHidden
    ? undefined
    : (state.preview ?? visible.find((item) => item.id === state.selectedObject));
  const row = selectedMarketRow(state.rows, state.preferences);
  const digits = row ? precision(row) : 2;
  const locale = intlLocale(state.preferences.locale);
  const labels = useMemo<AxisLabels>(() => {
    const number = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    const date = chartDateFormat(timeframe, state.preferences);
    return {
      prices: drawingPriceTargets(visible, selected).map((target) => {
        const style = drawingPriceLabelStyle(chartSettings, target.color);
        return {
          ...target,
          text: number.format(target.point.value),
          color: style.color,
          fill: style.fill,
          textColor: style.text
        };
      }),
      times: (selected?.points ?? []).flatMap(({ timestamp }) =>
        Number.isFinite(new Date(timestamp).getTime())
          ? [{ timestamp, text: date.format(timestamp) }]
          : []
      ),
      timeStyle: { fill: "#2962ff", textColor: "#fff" }
    };
  }, [visible, selected, digits, locale, timeframe, state.preferences, chartSettings]);
  useLayoutEffect(
    () => bindDrawingAxisLabels(() => controller.chart, drawingProjection, labels),
    [controller, drawingProjection, labels, state.chartRevision]
  );
  return null;
}
