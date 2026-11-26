import { IndicatorSeries, registerIndicator } from "klinecharts";
import type { Chart, IndicatorDrawParams } from "klinecharts";
import { intlLocale } from "../i18n/preferences.js";
import type { DisplayPreferences } from "../i18n/preferences.js";
import { chartPalette } from "../model/theme.js";
import type { ChartSettings } from "../model/types.js";
import {
  calendarRegionLabels,
  paintTechnicalPriceRegions,
  priceDecorationLayers
} from "./technical-calendar-paint.js";
import type {
  RenderedMoonDecoration,
  RenderedPriceDecoration,
  RenderedPriceRegion
} from "./technical-calendar-paint.js";
import { paintTechnicalMoon } from "./technical-moon-paint.js";

const paneId = "candle_pane";
const registered = new Set<string>();

interface RegionData {
  regions: readonly RenderedPriceRegion[];
  label: (data: RenderedPriceRegion["label"]) => string;
}

interface MoonData {
  decorations: readonly RenderedMoonDecoration[];
  bodyVisible: boolean;
  markerOutline: string;
}

function timeCoordinate(
  kLineDataList: IndicatorDrawParams["kLineDataList"],
  xAxis: IndicatorDrawParams["xAxis"]
) {
  return (timestamp: number): number | null => {
    let start = 0,
      end = kLineDataList.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (kLineDataList[middle]!.timestamp < timestamp) start = middle + 1;
      else end = middle;
    }
    return kLineDataList[start]?.timestamp === timestamp ? xAxis.convertToPixel(start) : null;
  };
}

function drawRegions({
  ctx,
  bounding,
  barSpace,
  kLineDataList,
  visibleRange,
  indicator,
  xAxis,
  yAxis
}: IndicatorDrawParams) {
  const data = indicator.extendData as RegionData | undefined;
  if (!data?.regions.length) return true;
  const { timestamp: firstVisibleTime } =
    kLineDataList[Math.max(0, Math.floor(visibleRange.from) - 1)] ?? {};
  const { timestamp: lastVisibleTime } =
    kLineDataList[Math.min(kLineDataList.length - 1, Math.ceil(visibleRange.to) + 1)] ?? {};
  paintTechnicalPriceRegions(ctx, data.regions, {
    width: bounding.width,
    height: bounding.height,
    halfBar: barSpace.bar / 2,
    ...(firstVisibleTime !== undefined && { firstVisibleTime }),
    ...(lastVisibleTime !== undefined && { lastVisibleTime }),
    x: timeCoordinate(kLineDataList, xAxis),
    y: (value) => yAxis.convertToPixel(value),
    label: data.label
  });
  return true;
}

function drawMoon({
  ctx,
  bounding,
  barSpace,
  kLineDataList,
  visibleRange,
  indicator,
  xAxis,
  yAxis
}: IndicatorDrawParams) {
  const data = indicator.extendData as MoonData | undefined;
  if (!data?.decorations.length) return true;
  paintTechnicalMoon(ctx, data.decorations, {
    width: bounding.width,
    height: bounding.height,
    bodyWidth: Math.max(1, barSpace.gapBar * 0.76),
    bodyVisible: data.bodyVisible,
    markerOutline: data.markerOutline,
    firstIndex: Math.max(0, Math.floor(visibleRange.from)),
    lastIndex: Math.min(kLineDataList.length - 1, Math.ceil(visibleRange.to)),
    candle(index) {
      const bar = kLineDataList[index];
      return bar
        ? {
            timestamp: bar.timestamp,
            open: bar.open,
            close: bar.close,
            x: xAxis.convertToPixel(index)
          }
        : null;
    },
    x: timeCoordinate(kLineDataList, xAxis),
    y: (value) => yAxis.convertToPixel(value)
  });
  return true;
}

function klineDecorationLayer<Data extends object>(
  chart: Chart,
  name: string,
  zLevel: number,
  draw: (params: IndicatorDrawParams) => boolean
) {
  let active = false;
  const remove = () => {
    if (!active) return;
    active = false;
    chart.removeIndicator(paneId, name);
  };
  return {
    update(data: Data | null) {
      if (!data) {
        remove();
        return;
      }
      if (!registered.has(name)) {
        registerIndicator({
          name,
          shortName: " ",
          series: IndicatorSeries.Normal,
          zLevel,
          figures: [],
          calc: () => [],
          draw
        });
        registered.add(name);
      }
      const value = { name, extendData: data };
      if (active) chart.overrideIndicator(value, paneId);
      else active = chart.createIndicator(value, true, { id: paneId }) !== null;
    },
    dispose: remove
  };
}

export function klineCalendarRegions(
  chart: Chart,
  options: DisplayPreferences & { settings?: ChartSettings },
  alive: () => boolean
) {
  const labels = calendarRegionLabels(options.locale);
  const regions = klineDecorationLayer<RegionData>(
    chart,
    "PERSONAL_TA_PRICE_REGIONS",
    -4,
    drawRegions
  );
  const moon = klineDecorationLayer<MoonData>(chart, "PERSONAL_TA_MOON_PHASES", 2, drawMoon);
  const markerOutline = chartPalette(options.settings ?? {}).text;
  let precision: number | undefined;
  let formatter: Intl.NumberFormat | undefined;
  const label: RegionData["label"] = (data) =>
    labels(data, (value) => {
      const nextPrecision = chart.getPriceVolumePrecision().price;
      if (!formatter || precision !== nextPrecision) {
        precision = nextPrecision;
        formatter = new Intl.NumberFormat(intlLocale(options.locale), {
          maximumFractionDigits: precision
        });
      }
      return formatter.format(value);
    });
  return {
    update(next: readonly RenderedPriceDecoration[] = []) {
      const layers = priceDecorationLayers(alive() ? next : []);
      regions.update(layers.regions.length ? { regions: layers.regions, label } : null);
      moon.update(
        layers.moon.length
          ? {
              decorations: layers.moon,
              bodyVisible: options.settings?.bodyVisible !== false,
              markerOutline
            }
          : null
      );
    },
    dispose() {
      regions.dispose();
      moon.dispose();
    }
  };
}
