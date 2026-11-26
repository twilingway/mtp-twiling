import type {
  IChartApi,
  IPrimitivePaneRenderer,
  ISeriesPrimitive,
  Logical,
  Time,
  UTCTimestamp
} from "lightweight-charts";
import type { DisplayPreferences } from "../i18n/preferences.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import { logicalForTime } from "../model/intervals/projected-time.js";
import { chartPalette } from "../model/theme.js";
import type { ChartSettings, Timeframe } from "../model/types.js";
import {
  calendarRegionLabels,
  paintTechnicalPriceRegions,
  priceDecorationLayers
} from "./technical-calendar-paint.js";
import type { RenderedPriceDecoration } from "./technical-calendar-paint.js";
import { paintTechnicalMoon } from "./technical-moon-paint.js";
import { paintTechnicalSloped, slopedViewportX } from "./technical-sloped-paint.js";

import type { LightweightMainSeries as Primary } from "./lightweight-main-series.js";

export function lightweightCalendarRegions(
  chart: IChartApi,
  options: DisplayPreferences & { settings?: ChartSettings; timeframe?: Timeframe },
  alive: () => boolean,
  primary?: () => Primary
) {
  const labels = calendarRegionLabels(options.locale);
  const intervalMs = options.timeframe === undefined ? undefined : TIMEFRAMES[options.timeframe].ms;
  const markerOutline = chartPalette(options.settings ?? {}).text;
  let owner: Primary | undefined;
  let requestUpdate: (() => void) | undefined;
  let layers = priceDecorationLayers([]);
  let tail: { index: number; timestamp: number } | undefined;
  const renderer: IPrimitivePaneRenderer = {
    draw: () => {},
    drawBackground(target) {
      if (!owner || !alive() || (!layers.regions.length && !layers.sloped.length)) return;
      const series = owner;
      const scale = chart.timeScale();
      const range = scale.getVisibleLogicalRange();
      if (!range) return;
      // The installed SDK accepts integer series indices only, even with a fractional viewport.
      const index = Math.floor(range.from);
      const firstX = scale.logicalToCoordinate(index as Logical);
      const nextX = scale.logicalToCoordinate((index + 1) as Logical);
      const halfBar = firstX !== null && nextX !== null ? Math.abs(nextX - firstX) / 2 : 0.5;
      const labelPrice = series.priceFormatter();
      const x = (timestamp: number) => {
        const native = scale.timeToCoordinate(Math.floor(timestamp / 1000) as UTCTimestamp);
        if (native !== null || !tail || timestamp <= tail.timestamp || intervalMs === undefined)
          return native;
        if (firstX === null) return null;
        const projected = tail.index + logicalForTime([tail], timestamp, intervalMs);
        return firstX + (projected - index) * (halfBar * 2);
      };
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        const y = (value: number) => series.priceToCoordinate(value);
        paintTechnicalPriceRegions(context, layers.regions, {
          ...mediaSize,
          halfBar,
          x,
          y,
          label: (data) => labels(data, (value) => labelPrice.format(value))
        });
        if (layers.sloped.length) {
          const axis = slopedViewportX(mediaSize.width, index, firstX, halfBar * 2);
          if (axis) paintTechnicalSloped(context, layers.sloped, { ...mediaSize, ...axis, y });
        }
      });
    }
  };
  const moonRenderer: IPrimitivePaneRenderer = {
    draw(target) {
      if (!owner || !alive() || !layers.moon.length) return;
      const series = owner;
      const scale = chart.timeScale();
      const range = scale.getVisibleLogicalRange();
      if (!range) return;
      const firstIndex = Math.max(0, Math.floor(range.from));
      const lastIndex = Math.ceil(range.to);
      const firstX = scale.logicalToCoordinate(firstIndex as Logical);
      const nextX = scale.logicalToCoordinate((firstIndex + 1) as Logical);
      const barWidth = firstX !== null && nextX !== null ? Math.abs(nextX - firstX) : 1;
      target.useMediaCoordinateSpace(({ context, mediaSize }) =>
        paintTechnicalMoon(context, layers.moon, {
          ...mediaSize,
          firstIndex,
          lastIndex,
          bodyWidth: Math.max(1, barWidth * 0.64),
          bodyVisible: options.settings?.bodyVisible !== false,
          markerOutline,
          candle(index) {
            const bar = series.dataByIndex(index);
            const x = scale.logicalToCoordinate(index as Logical);
            if (
              !bar ||
              !("open" in bar) ||
              !("close" in bar) ||
              typeof bar.open !== "number" ||
              typeof bar.close !== "number" ||
              x === null ||
              typeof bar.time !== "number"
            )
              return null;
            return { open: bar.open, close: bar.close, timestamp: bar.time * 1000, x };
          },
          x: (timestamp) => scale.timeToCoordinate(Math.floor(timestamp / 1000) as UTCTimestamp),
          y: (value) => series.priceToCoordinate(value)
        })
      );
    }
  };
  const background = { zOrder: () => "bottom" as const, renderer: () => renderer };
  const foreground = { zOrder: () => "normal" as const, renderer: () => moonRenderer };
  const primitive: ISeriesPrimitive<Time> = {
    attached(attachment) {
      requestUpdate = attachment.requestUpdate;
    },
    detached() {
      requestUpdate = undefined;
    },
    paneViews: () => (layers.moon.length ? [background, foreground] : [background]),
    autoscaleInfo: () => null
  };
  return {
    update(
      next: readonly RenderedPriceDecoration[] = [],
      lastBar?: { index: number; timestamp: number }
    ) {
      tail = lastBar;
      layers = priceDecorationLayers(next);
      layers.moon = layers.moon.map((item) =>
        item.kind === "candle-tint"
          ? {
              ...item,
              startTimestamp: Math.floor(item.startTimestamp / 1000) * 1000,
              endTimestamp: Math.floor(item.endTimestamp / 1000) * 1000
            }
          : item
      );
      const series = next.length ? primary?.() : undefined;
      if (owner !== series) {
        owner?.detachPrimitive(primitive);
        owner = series;
        owner?.attachPrimitive(primitive);
      }
      requestUpdate?.();
    },
    dispose() {
      owner?.detachPrimitive(primitive);
      owner = undefined;
      tail = undefined;
      layers = priceDecorationLayers([]);
    }
  };
}
