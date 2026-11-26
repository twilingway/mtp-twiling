import type {
  IChartApi,
  IPrimitivePaneRenderer,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  Time,
  UTCTimestamp
} from "lightweight-charts";
import type { DisplayPreferences } from "../i18n/preferences.js";
import { chartPalette } from "../model/theme.js";
import type { ChartSettings } from "../model/types.js";
import {
  calendarRegionLabels,
  paintTechnicalPriceRegions,
  priceDecorationLayers
} from "./technical-calendar-paint.js";
import type { RenderedPriceDecoration } from "./technical-calendar-paint.js";
import { paintTechnicalMoon } from "./technical-moon-paint.js";

type Primary = ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;

export function lightweightCalendarRegions(
  chart: IChartApi,
  options: DisplayPreferences & { settings?: ChartSettings },
  alive: () => boolean,
  primary?: () => Primary
) {
  const labels = calendarRegionLabels(options.locale);
  const markerOutline = chartPalette(options.settings ?? {}).text;
  let owner: Primary | undefined;
  let requestUpdate: (() => void) | undefined;
  let layers = priceDecorationLayers([]);
  const renderer: IPrimitivePaneRenderer = {
    draw: () => {},
    drawBackground(target) {
      if (!owner || !alive() || !layers.regions.length) return;
      const series = owner;
      const scale = chart.timeScale();
      const range = scale.getVisibleLogicalRange();
      if (!range) return;
      const firstX = scale.logicalToCoordinate(range.from);
      const nextX = scale.logicalToCoordinate((range.from + 1) as Logical);
      const halfBar = firstX !== null && nextX !== null ? Math.abs(nextX - firstX) / 2 : 0.5;
      const labelPrice = series.priceFormatter();
      target.useMediaCoordinateSpace(({ context, mediaSize }) =>
        paintTechnicalPriceRegions(context, layers.regions, {
          ...mediaSize,
          halfBar,
          x: (timestamp) => scale.timeToCoordinate(Math.floor(timestamp / 1000) as UTCTimestamp),
          y: (value) => series.priceToCoordinate(value),
          label: (data) => labels(data, (value) => labelPrice.format(value))
        })
      );
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
    update(next: readonly RenderedPriceDecoration[] = []) {
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
      layers = priceDecorationLayers([]);
    }
  };
}
