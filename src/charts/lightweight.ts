import { CandlestickSeries, ColorType, CrosshairMode, createChart } from "lightweight-charts";
import type { IPriceLine, ISeriesPrimitive, Logical, Time, UTCTimestamp } from "lightweight-charts";
import { MtpModel, activeMtpPeriods, lightweightMtp } from "../model/mtp.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import type { Candle, ChartView, DrawingPoint } from "../model/types.js";
import { logicalForTime, timeForLogical } from "./adapter.js";
import { chartPriceFormat, lightweightPriceFormat } from "./price-format.js";
import type { ChartAdapter, ChartOptions } from "./adapter.js";
import { focusRange } from "./navigation.js";
import { PendingChartView } from "./view-camera.js";
import { drawingToolbarSettings } from "../model/drawing-toolbar.js";
import { chartPalette } from "../model/theme.js";
import { hasCalendarAxis } from "../model/intervals/axis-ticks.js";
import { paintCalendarAxis, paintCalendarGrid } from "./lightweight-calendar-grid.js";
import { lightweightDateFormatters } from "../i18n/chart-formatters.js";
import { intlLocale } from "../i18n/preferences.js";
import { calendarAxisDisplay } from "../i18n/calendar-axis.js";
import { lightweightNavigation } from "./lightweight-navigation.js";
import { UserCameraEvents } from "./camera-events.js";
import { lightweightLegacy } from "./lightweight-legacy.js";
import { lightweightTechnical } from "./lightweight-technical.js";
import { preserveLightweightCamera } from "./lightweight-preserve-camera.js";

export function makeLightweight(options: ChartOptions): ChartAdapter {
  const camera = new UserCameraEvents(options);
  const { container, row, settings, indicators, timeframe } = options;
  const instrumentUid = row.uid;
  let priceFormat = chartPriceFormat(row);
  let data: Candle[] = [],
    updateDrawings = () => {},
    settingData = false,
    viewStaged = false,
    restoreFrame: number | null = null,
    settleFrame: number | null = null;
  const pendingView = new PendingChartView();
  let lastPriceLabel: IPriceLine | null = null;
  const palette = chartPalette(settings);
  const dateFormatters = lightweightDateFormatters(timeframe, options);
  const display = calendarAxisDisplay(timeframe, options);
  const formatTick = (time: Time, type: number) =>
    hasCalendarAxis(timeframe) ? "" : dateFormatters.tickMarkFormatter(time, type);
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: palette.background },
      textColor: palette.text,
      fontFamily: '-apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif',
      fontSize: settings.scaleFontSize ?? 11,
      attributionLogo: false
    },
    grid: {
      vertLines: {
        color: palette.grid,
        visible: settings.grid !== false && !hasCalendarAxis(timeframe)
      },
      horzLines: { color: palette.grid, visible: settings.grid !== false }
    },
    rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.22 } },
    timeScale: {
      borderColor: palette.border,
      timeVisible: !["1d", "1w", "1M"].includes(timeframe),
      tickMarkFormatter: formatTick,
      rightOffset: 8
    },
    crosshair: {
      mode:
        drawingToolbarSettings(settings).cursor === "crosshair"
          ? CrosshairMode.Normal
          : CrosshairMode.Hidden,
      vertLine: {
        color: palette.crosshair,
        style: 2,
        labelBackgroundColor: palette.labelBackground
      },
      horzLine: {
        color: palette.crosshair,
        style: 2,
        labelBackgroundColor: palette.labelBackground
      }
    },
    localization: {
      locale: intlLocale(options.locale),
      timeFormatter: dateFormatters.timeFormatter
    }
  });
  const series = chart.addSeries(CandlestickSeries, {
    upColor: settings.bodyVisible === false ? "transparent" : (settings.upColor ?? "#53b987"),
    downColor: settings.bodyVisible === false ? "transparent" : (settings.downColor ?? "#eb4d5c"),
    wickUpColor: settings.wickUpColor ?? "#336854",
    wickDownColor: settings.wickDownColor ?? "#7f323f",
    borderUpColor: settings.borderUpColor ?? "#53b987",
    borderDownColor: settings.borderDownColor ?? "#eb4d5c",
    borderVisible: settings.borderVisible !== false,
    wickVisible: settings.wickVisible !== false,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: lightweightPriceFormat(priceFormat)
  });
  const legacy = lightweightLegacy(chart, options);
  series.setSeriesOrder(3);
  const model = new MtpModel();
  if (settings.indicatorOptions) model.styles = settings.indicatorOptions;
  model.styleKey = indicators.mtpAll ? "mtpAll" : undefined;
  const mtp = lightweightMtp(
    {
      timeScale: () => ({
        getVisibleLogicalRange: () => chart.timeScale().getVisibleLogicalRange(),
        logicalToCoordinate: (index) => chart.timeScale().logicalToCoordinate(index as Logical)
      })
    },
    {
      priceToCoordinate: (price) => series.priceToCoordinate(price),
      attachPrimitive: (primitive) => series.attachPrimitive(primitive),
      detachPrimitive: (primitive) => series.detachPrimitive(primitive)
    },
    model
  );
  const primitive: ISeriesPrimitive<Time> = {
    attached: (params) => {
      updateDrawings = params.requestUpdate;
    },
    paneViews: () =>
      (["back", "front"] as const).map((layer) => ({
        zOrder: () => (layer === "front" ? ("top" as const) : ("bottom" as const)),
        renderer: () => ({
          draw: (target) => {
            target.useBitmapCoordinateSpace((scope) => {
              const { context, horizontalPixelRatio: x, verticalPixelRatio: y, bitmapSize } = scope;
              context.save();
              context.scale(x, y);
              const range = chart.timeScale().getVisibleLogicalRange();
              if (
                layer === "back" &&
                settings.grid !== false &&
                range &&
                hasCalendarAxis(timeframe)
              )
                paintCalendarGrid(context, data, timeframe, {
                  from: range.from,
                  to: range.to,
                  width: bitmapSize.width / x,
                  height: bitmapSize.height / y,
                  coordinate: (index) =>
                    chart.timeScale().logicalToCoordinate(index as Logical) ?? NaN,
                  color: palette.grid,
                  pixelRatio: x,
                  display
                });
              options.paint(
                context,
                bitmapSize.width / x,
                bitmapSize.height / y,
                pointToPixel,
                layer
              );
              context.restore();
            });
          }
        })
      })),
    timeAxisPaneViews: () =>
      hasCalendarAxis(timeframe)
        ? [
            {
              zOrder: () => "normal" as const,
              renderer: () => ({
                draw: (target) =>
                  target.useBitmapCoordinateSpace((scope) => {
                    const range = chart.timeScale().getVisibleLogicalRange();
                    if (!range) return;
                    const {
                      context,
                      horizontalPixelRatio: x,
                      verticalPixelRatio: y,
                      bitmapSize
                    } = scope;
                    context.save();
                    context.scale(x, y);
                    paintCalendarAxis(context, data, timeframe, {
                      from: range.from,
                      to: range.to,
                      width: bitmapSize.width / x,
                      height: bitmapSize.height / y,
                      coordinate: (index) =>
                        chart.timeScale().logicalToCoordinate(index as Logical) ?? NaN,
                      color: palette.muted,
                      fontSize: settings.scaleFontSize ?? 11,
                      fontFamily:
                        '-apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif',
                      display
                    });
                    context.restore();
                  })
              })
            }
          ]
        : []
  };
  series.attachPrimitive(primitive);
  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range && range.from < 80) options.onNearStart();
    camera.nativeChanged();
  });
  chart.subscribeCrosshairMove((event) => {
    const bar = event.seriesData.get(series);
    if (bar && "open" in bar && typeof bar.time === "number")
      options.onCrosshair({
        timestamp: bar.time * 1000,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: 0
      });
    else options.onCrosshair(null);
  });
  function pointToPixel(point: DrawingPoint) {
    const x = chart
        .timeScale()
        .logicalToCoordinate(
          logicalForTime(data, point.timestamp, TIMEFRAMES[timeframe].ms) as Logical
        ),
      y = series.priceToCoordinate(point.value);
    return x == null || y == null ? null : { x, y };
  }
  const time = (bar: Candle): UTCTimestamp => Math.floor(bar.timestamp / 1000) as UTCTimestamp;
  function updateLastPriceLabel() {
    const bar = data.at(-1);
    if (!bar) {
      if (lastPriceLabel) series.removePriceLine(lastPriceLabel);
      lastPriceLabel = null;
      return;
    }
    const color =
      bar.close >= bar.open ? (settings.upColor ?? "#53b987") : (settings.downColor ?? "#eb4d5c");
    const label = {
      price: bar.close,
      color,
      axisLabelColor: color,
      axisLabelTextColor: "#fff",
      axisLabelVisible: true,
      lineVisible: settings.priceLine !== false,
      lineWidth: 1 as const,
      lineStyle: 2,
      title: ""
    };
    if (lastPriceLabel) lastPriceLabel.applyOptions(label);
    else lastPriceLabel = series.createPriceLine(label);
  }
  function restoreView() {
    if (settingData) return;
    const view = pendingView.take(data.length > 0 && chart.timeScale().width() > 0);
    if (!view) return;
    viewStaged = false;
    const scale = chart.timeScale(),
      spacing = view.camera?.barSpace ?? view.barSpace ?? scale.options().barSpacing;
    if (view.anchor || view.camera || view.barSpace) {
      // Public scale setters are queued until RAF. Compute the complete camera
      // from saved values instead of reading old geometry after queued writes.
      const rightOffset = view.anchor
        ? logicalForTime(data, view.anchor.timestamp, TIMEFRAMES[timeframe].ms) -
          (data.length - 1) +
          (scale.width() * (1 - view.anchor.xFraction) - 1) / spacing -
          0.5
        : view.camera?.rightOffsetBars;
      scale.applyOptions({ barSpacing: spacing, ...(rightOffset != null ? { rightOffset } : {}) });
    } else if (view.from != null && view.to != null && view.from < view.to) {
      scale.setVisibleRange({ from: view.from as UTCTimestamp, to: view.to as UTCTimestamp });
    }
    if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(() => {
      settleFrame = null;
    });
    updateDrawings();
  }
  function scheduleViewRestore() {
    if (settingData || !viewStaged || restoreFrame !== null) return;
    // The chart's preceding frame commits the initial fit and price-axis width.
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = null;
      restoreView();
    });
  }
  chart.timeScale().subscribeSizeChange(scheduleViewRestore);
  const adapter: ChartAdapter = {
    updatePriceFormat(metadata) {
      if (
        live.retired ||
        !instrumentUid ||
        metadata.uid !== instrumentUid ||
        live.source?.uid !== metadata.uid ||
        live.source.owner !== metadata.owner
      )
        return;
      const next = chartPriceFormat(
        { symbol: row.symbol, step: metadata.step, price: metadata.priceHint },
        priceFormat
      );
      if (next.minMove === priceFormat.minMove && next.precision === priceFormat.precision) return;
      camera.programmatic(() => series.applyOptions({ priceFormat: lightweightPriceFormat(next) }));
      priceFormat = next;
      technical.refreshNativeMetadata();
    },
    ...lightweightNavigation(
      chart,
      series,
      () => data.length,
      () => !settingData && !viewStaged && restoreFrame === null && settleFrame === null
    ),
    setData(next, fit) {
      if (live.retired) return;
      settingData = true;
      data = [...next];
      model.reset(data, activeMtpPeriods(indicators));
      series.setData(data.map((bar) => ({ ...bar, time: time(bar) })));
      updateLastPriceLabel();
      legacy.setData(data);
      technical.setData(data);
      mtp.update();
      updateDrawings();
      if (fit && data.length) {
        const first =
            data.find((bar) => bar.timestamp >= Date.now() - options.rangeDays * 86400000) ??
            data[0]!,
          last = data.at(-1)!;
        chart.timeScale().setVisibleRange({ from: time(first), to: time(last) });
      }
      settingData = false;
      scheduleViewRestore();
    },
    updateBar(bar) {
      if (live.retired) return;
      const index = data.findIndex((item) => item.timestamp === bar.timestamp);
      const historical = bar.timestamp < (data.at(-1)?.timestamp ?? bar.timestamp);
      if (index >= 0) data[index] = bar;
      else {
        data.push(bar);
        if (historical) data.sort((a, b) => a.timestamp - b.timestamp);
      }
      if (historical) model.reset(data, activeMtpPeriods(indicators));
      else model.update(data);
      if (historical && index < 0)
        series.setData(data.map((item) => ({ ...item, time: time(item) })));
      else series.update({ ...bar, time: time(bar) }, historical);
      updateLastPriceLabel();
      if (historical && index < 0) legacy.setData(data);
      else legacy.update(data, bar, historical);
      technical.setData(data);
      mtp.update();
    },
    getView() {
      if (!data.length || viewStaged || restoreFrame !== null || settleFrame !== null) return null;
      const scale = chart.timeScale(),
        range = scale.getVisibleLogicalRange();
      if (!range || !scale.width()) return null;
      const index = Math.max(0, Math.min(data.length - 1, Math.round((range.from + range.to) / 2))),
        bar = data[index],
        x = scale.logicalToCoordinate(index as Logical),
        view = scale.getVisibleRange();
      return {
        camera: { barSpace: scale.options().barSpacing, rightOffsetBars: scale.scrollPosition() },
        ...(bar && x != null
          ? { anchor: { timestamp: bar.timestamp, xFraction: x / scale.width() } }
          : {}),
        ...(view && typeof view.from === "number" && typeof view.to === "number"
          ? { from: view.from, to: view.to }
          : {})
      };
    },
    setView(view: ChartView) {
      pendingView.stage(view);
      viewStaged = true;
      scheduleViewRestore();
    },
    pointToPixel,
    technicalPaneMetrics: () => technical.metrics(),
    timeAxisTop: () => technical.timeAxisTop(),
    updateTechnicalIndicators: (instances, layout) => {
      if (!live.retired)
        camera.programmatic(() =>
          preserveLightweightCamera(chart, series, () => technical.update(instances, layout))
        );
    },
    focusPoints(points) {
      const timeScale = chart.timeScale(),
        visible = timeScale.getVisibleLogicalRange(),
        priceScale = series.priceScale(),
        priceRange = priceScale.getVisibleRange();
      if (!visible || !points.length) return;
      const horizontal = focusRange(
        points.map((point) => logicalForTime(data, point.timestamp, TIMEFRAMES[timeframe].ms)),
        visible
      );
      if (horizontal) timeScale.setVisibleLogicalRange(horizontal);
      if (priceRange) {
        const vertical = focusRange(
          points.map((point) => point.value),
          priceRange
        );
        if (horizontal || vertical) {
          priceScale.applyOptions({ autoScale: false });
          priceScale.setVisibleRange(vertical ?? priceRange);
        }
      }
    },
    beginPan() {
      const scale = series.priceScale(),
        range = scale.getVisibleRange();
      if (!range) return;
      scale.applyOptions({ autoScale: false });
      scale.setVisibleRange(range);
    },
    pixelToPoint(x, y) {
      const price = technical.metrics()[0];
      if (!price || x < 0 || x > price.width || y < 0 || y > price.height) return null;
      const index = chart.timeScale().coordinateToLogical(x),
        value = series.coordinateToPrice(y);
      if (index == null || value == null) return null;
      const timestamp = timeForLogical(data, index, TIMEFRAMES[timeframe].ms);
      return timestamp == null ? null : { timestamp, value };
    },
    plotSize: () => ({
      width: chart.timeScale().width(),
      height: technical.metrics()[0]?.height ?? container.clientHeight - 28
    }),
    fit() {
      series.priceScale().applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    },
    redrawDrawings: () => updateDrawings(),
    destroy() {
      if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      mtp.destroy();
      technical.dispose();
      chart.remove();
    }
  };
  const live = camera.wrap(adapter);
  const technical = lightweightTechnical(
    chart,
    options,
    () => !live.retired,
    () => series
  );
  technical.update(options.technicalIndicators ?? [], options.technicalPaneLayout);
  return live;
}
