import type { IChartApi, ISeriesApi, Logical } from "lightweight-charts";
import type { ChartAdapter } from "./adapter.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import { logicalForTime } from "../model/intervals/projected-time.js";
import { focusRange } from "./navigation.js";
import { navigationCenter, navigationDistance, zoomSpacing } from "./navigation-controls.js";
import { selectionTimeWindow, selectionZoomBounds } from "./selection-zoom.js";
import type { SelectionZoomSource } from "./selection-zoom.js";

export function lightweightNavigation(
  chart: Pick<IChartApi, "timeScale">,
  series: Pick<ISeriesApi<"Candlestick">, "priceScale">,
  count: () => number,
  ready: () => boolean,
  projectionDelta: () => number = () => 0,
  selectionSource?: () => SelectionZoomSource
): Pick<ChartAdapter, "zoom" | "scroll" | "resetView" | "zoomToSelection" | "focusPoints"> {
  function geometry() {
    if (!ready() || !count()) return null;
    const scale = chart.timeScale(),
      width = scale.width(),
      firstX = scale.logicalToCoordinate(0 as Logical),
      lastX = scale.logicalToCoordinate((count() - 1) as Logical);
    return width > 0 &&
      Number.isFinite(width) &&
      firstX != null &&
      Number.isFinite(firstX) &&
      lastX != null &&
      Number.isFinite(lastX)
      ? { scale, width, firstX, lastX }
      : null;
  }
  return {
    zoom(direction) {
      const g = geometry();
      if (!g) return;
      const { scale, width, firstX, lastX } = g,
        options = scale.options(),
        spacing = zoomSpacing(
          options.barSpacing,
          direction,
          options.minBarSpacing,
          Math.min(options.maxBarSpacing || width / 2, width / 2)
        ),
        x = navigationCenter(width, firstX, lastX),
        anchor = scale.coordinateToLogical(x);
      if (anchor == null || !Number.isFinite(anchor) || !Number.isFinite(spacing) || spacing <= 0)
        return;
      // Apply the entire camera together: public scale writes settle on the next frame.
      scale.applyOptions({
        barSpacing: spacing,
        rightOffset: anchor - (count() - 1) - projectionDelta() + (width - x - 1) / spacing - 0.5
      });
    },
    zoomToSelection(from, to) {
      const g = geometry();
      const source = selectionSource?.();
      if (!g || !source) return;
      const selection = selectionZoomBounds(source, from, to);
      const price = series.priceScale();
      if (!selection || !price.getVisibleRange()) return;
      const { minBarSpacing, maxBarSpacing } = g.scale.options();
      const window = selectionTimeWindow(
        selection.time,
        g.width,
        minBarSpacing,
        maxBarSpacing || g.width / 2
      );
      if (!window) return;
      price.setVisibleRange(selection.price); // Public setter selects manual scale.
      g.scale.setVisibleLogicalRange({ from: window.from, to: window.to });
    },
    focusPoints(points) {
      const source = selectionSource?.();
      const scale = chart.timeScale();
      const visible = scale.getVisibleLogicalRange();
      if (!source || !visible || !points.length) return;
      const price = series.priceScale(),
        priceRange = price.getVisibleRange();
      const horizontal = focusRange(
        points.map((point) =>
          logicalForTime(source.data, point.timestamp, TIMEFRAMES[source.timeframe].ms)
        ),
        visible
      );
      if (horizontal) scale.setVisibleLogicalRange(horizontal);
      if (priceRange) {
        const vertical = focusRange(
          points.map((point) => point.value),
          priceRange
        );
        if (horizontal || vertical) {
          price.applyOptions({ autoScale: false });
          price.setVisibleRange(vertical ?? priceRange);
        }
      }
    },
    scroll(direction, fraction) {
      const g = geometry();
      if (!g) return;
      const { scale, width, firstX, lastX } = g,
        distance = navigationDistance(direction, width, firstX, lastX, fraction),
        spacing = scale.options().barSpacing,
        priceScale = series.priceScale(),
        range = priceScale.getVisibleRange();
      if (!distance || !range || !Number.isFinite(spacing) || spacing <= 0) return;
      if (fraction === undefined) {
        priceScale.applyOptions({ autoScale: false });
        priceScale.setVisibleRange(range);
      }
      scale.scrollToPosition(scale.scrollPosition() - distance / spacing, false);
    },
    resetView() {
      if (!ready() || !count()) return;
      const scale = chart.timeScale();
      series.priceScale().applyOptions({ autoScale: true });
      // LW resetTimeScale restores mutable options, not the chart's initial camera.
      const offset = 8 - projectionDelta();
      scale.applyOptions({ barSpacing: 6, rightOffset: offset });
      scale.scrollToPosition(offset, false);
    }
  };
}
