import { ActionType, DomPosition, TooltipShowRule, dispose, init } from "klinecharts";
import type { Coordinate, Point } from "klinecharts";
import { MtpModel, activeMtpPeriods } from "../model/mtp.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import type { Candle, ChartView, DrawingPoint } from "../model/types.js";
import { logicalForTime, timeForLogical } from "./adapter.js";
import { chartPriceFormat } from "./price-format.js";
import type { ChartAdapter, ChartOptions } from "./adapter.js";
import { beginKlinePan, freezeKlinePriceScale } from "./kline-price-scale.js";
import { focusRange } from "./navigation.js";
import { PendingChartView } from "./view-camera.js";
import { drawingToolbarSettings } from "../model/drawing-toolbar.js";
import { stablePriceAxisWidth } from "./price-axis-layout.js";
import { chartPalette } from "../model/theme.js";
import { klineLastPrice } from "./kline-last-price.js";
import { klineAxisLabels } from "./kline-axis-labels.js";
import { attachKlineFrontProjection } from "./kline-front-projection.js";
import { attachCalendarXAxis } from "./kline-calendar-axis.js";
import { klineDateFormatter } from "../i18n/chart-formatters.js";
import { intlLocale } from "../i18n/preferences.js";
import { resolveTimeZone } from "../i18n/timezones.js";
import { calendarAxisDisplay } from "../i18n/calendar-axis.js";
import { initializeKlineIndicators } from "./kline-indicators.js";
import { attachVolumePaneLayout } from "./kline-pane-layout.js";
import { attachKlineCanvasResize } from "./kline-canvas-resize.js";
import { klineNavigation } from "./kline-navigation.js";
import { UserCameraEvents } from "./camera-events.js";
import {
  registerKlineDrawingIndicators,
  bindKlineDrawingIndicators,
  redrawKlineDrawingIndicator,
  disposeKlineDrawingContext
} from "./kline-drawing-indicators.js";
import type { KlineDrawingContext } from "./kline-drawing-indicators.js";
import { klineTechnical } from "./kline-technical.js";
import { preserveKlineCamera, readKlineCameraOffset } from "./kline-preserve-camera.js";
import { klineLink } from "./kline-link.js";
import {
  getKlineManualPriceRange,
  setKlineManualPriceRange,
  zoomKlineSelection
} from "./kline-selection-zoom.js";
import { selectionZoomBounds } from "./selection-zoom.js";
import { klineBarStyle, klineMainStyle } from "./kline-main-style.js";

export function makeKline(options: ChartOptions): ChartAdapter {
  const camera = new UserCameraEvents(options);
  const instrumentUid = options.row.uid;
  let priceFormat = chartPriceFormat(options.row);
  let priceHint = options.row.price;
  const { container, settings, timeframe, indicators } = options;
  let data: Candle[] = [],
    dataReady = false,
    fittingLoaded = false;
  const pendingView = new PendingChartView();
  let pendingPriceRange: { from: number; to: number } | undefined;
  let axisWidth = stablePriceAxisWidth(
    options.row,
    settings.scaleFontSize ?? 11,
    container.clientWidth
  );
  const palette = chartPalette(settings);
  const candleStyle = klineMainStyle(settings);
  const lastPrice = klineLastPrice(settings);
  const model = new MtpModel();
  if (settings.indicatorOptions) model.styles = settings.indicatorOptions;
  model.styleKey = indicators.mtpAll ? "mtpAll" : undefined;
  registerKlineDrawingIndicators();
  const drawingContext: KlineDrawingContext = {
    model,
    getData: () => data,
    timeframe,
    paint: options.paint,
    disposed: false
  };
  const chart = init(container, {
    locale: intlLocale(options.locale),
    timezone: resolveTimeZone(options.timeZone),
    customApi: { formatDate: klineDateFormatter(timeframe, options) },
    styles: {
      crosshair: {
        show: drawingToolbarSettings(settings).cursor === "crosshair",
        horizontal: {
          line: { color: palette.crosshair },
          text: { color: palette.labelText, backgroundColor: palette.labelBackground }
        },
        vertical: {
          line: { color: palette.crosshair },
          text: { color: palette.labelText, backgroundColor: palette.labelBackground }
        }
      },
      grid: {
        show: settings.grid !== false,
        horizontal: { color: palette.grid },
        vertical: { color: palette.grid }
      },
      indicator: { tooltip: { showRule: TooltipShowRule.None } },
      candle: {
        ...candleStyle,
        bar: klineBarStyle(settings, candleStyle.bar),
        tooltip: { showRule: TooltipShowRule.None },
        priceMark: {
          last: lastPrice.styles()
        }
      },
      xAxis: {
        axisLine: { color: palette.border },
        tickLine: { color: palette.border },
        tickText: { color: palette.text, size: settings.scaleFontSize ?? 11 }
      },
      yAxis: {
        size: axisWidth,
        axisLine: { color: palette.border },
        tickLine: { color: palette.border },
        tickText: { color: palette.text, size: settings.scaleFontSize ?? 11 }
      },
      separator: { color: palette.border, fill: true, activeBackgroundColor: palette.grid }
    }
  });
  if (!chart) throw new Error("Не удалось создать KLineChart.");
  const axisLabels = klineAxisLabels(
    chart,
    lastPrice,
    settings,
    () => data,
    () => priceFormat,
    pointToPixel,
    (timestamp) =>
      toPixel({ dataIndex: logicalForTime(data, timestamp, TIMEFRAMES[timeframe].ms) }).x ?? null,
    () => chart.getSize("candle_pane", DomPosition.Main) ?? { width: 0, height: 0 },
    paintFront
  );
  const detachCalendarXAxis = attachCalendarXAxis(
    chart,
    () => data,
    timeframe,
    calendarAxisDisplay(timeframe, options)
  );
  const volumeLayout = attachVolumePaneLayout(chart, {
    enabled: indicators.volume,
    layout: options.indicatorPaneLayout,
    onChange: options.onIndicatorLayout
  });
  chart.setPriceVolumePrecision(priceFormat.precision, 0);
  const front = document.createElement("canvas");
  front.className = "foreground-canvas";
  container.parentElement?.append(front);
  function toPixel(point: Partial<Point>, absolute = true): Partial<Coordinate> {
    const result = chart!.convertToPixel([point], { paneId: "candle_pane", absolute });
    return Array.isArray(result) ? (result[0] ?? {}) : result;
  }
  function fromPixel(point: Partial<Coordinate>): Partial<Point> {
    const result = chart!.convertFromPixel([point], { paneId: "candle_pane", absolute: true });
    return Array.isArray(result) ? (result[0] ?? {}) : result;
  }
  function pointToPixel(point: DrawingPoint) {
    if (!chart) return null;
    const pixel = toPixel({
      dataIndex: logicalForTime(data, point.timestamp, TIMEFRAMES[timeframe].ms),
      value: point.value
    });
    return pixel.x == null || pixel.y == null ? null : { x: pixel.x, y: pixel.y };
  }
  function paintFront() {
    if (!chart) return;
    const size = chart.getSize("candle_pane", DomPosition.Main);
    if (!size) return;
    const dpr = devicePixelRatio || 1,
      width = Math.round(size.width * dpr),
      height = Math.round(size.height * dpr);
    if (front.width !== width || front.height !== height) {
      front.width = width;
      front.height = height;
      front.style.width = `${size.width}px`;
      front.style.height = `${size.height}px`;
    }
    const ctx = front.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    lastPrice.paint(
      ctx,
      data.at(-1),
      size.width,
      size.height,
      (bar) => pointToPixel({ timestamp: bar.timestamp, value: bar.close })?.y
    );
    options.paint(ctx, size.width, size.height, pointToPixel, "front");
  }
  const resize = new ResizeObserver(() => {
    const width = stablePriceAxisWidth(
      { ...options.row, price: priceHint },
      settings.scaleFontSize ?? 11,
      container.clientWidth,
      priceFormat.precision
    );
    if (width !== axisWidth) {
      axisWidth = width;
      chart.setStyles({ yAxis: { size: axisWidth } });
    }
    chart.resize();
    volumeLayout.apply();
    technical?.apply();
    flushView();
    paintFront();
  });
  resize.observe(container);
  chart.subscribeAction(ActionType.OnVisibleRangeChange, (range: { from: number }) => {
    if (!fittingLoaded && range.from < 80) options.onNearStart();
    paintFront();
  });
  function restoreView(view: ChartView) {
    if (!chart) return;
    if (view.camera) chart.setBarSpace(view.camera.barSpace);
    else if (view.barSpace) chart.setBarSpace(view.barSpace);
    if (view.anchor) {
      const size = chart.getSize("candle_pane", DomPosition.Main),
        point = toPixel({
          dataIndex: logicalForTime(data, view.anchor.timestamp, TIMEFRAMES[timeframe].ms)
        });
      if (size && point.x != null)
        chart.scrollByDistance(size.width * view.anchor.xFraction - point.x, 0);
    } else if (view.camera)
      chart.setOffsetRightDistance(view.camera.rightOffsetBars * chart.getBarSpace());
    else if (view.offsetRight != null) chart.setOffsetRightDistance(view.offsetRight);
    paintFront();
  }
  function flushView() {
    if (!chart || !dataReady || !chart.getSize("candle_pane", DomPosition.Main)?.width) return;
    const view = pendingView.take(true);
    if (view) restoreView(view);
    if (pendingPriceRange) {
      const range = pendingPriceRange;
      pendingPriceRange = undefined;
      setKlineManualPriceRange(chart, range);
      paintFront();
    }
  }
  chart.subscribeAction(ActionType.OnDataReady, () => {
    dataReady = data.length > 0 && chart.getDataList().length > 0;
    flushView();
    paintFront();
  });
  chart.subscribeAction(ActionType.OnZoom, () => {
    paintFront();
    camera.nativeChanged();
  });
  chart.subscribeAction(ActionType.OnScroll, () => {
    paintFront();
    camera.nativeChanged();
  });
  const link = klineLink(chart, timeframe, (point) => toPixel(point, false));
  chart.subscribeAction(ActionType.OnCrosshairChange, (value: unknown) => {
    link.acceptNativeCrosshair();
    const index =
      value &&
      typeof value === "object" &&
      "realDataIndex" in value &&
      typeof value.realDataIndex === "number"
        ? value.realDataIndex
        : -1;
    options.onCrosshair(data[index] ?? null);
  });
  initializeKlineIndicators(chart, options, volumeLayout.height());
  bindKlineDrawingIndicators(chart, drawingContext);
  volumeLayout.apply();
  const detachCanvasResize = attachKlineCanvasResize(chart, () => axisWidth);
  const navigation = klineNavigation(
    chart,
    () => data.length,
    () => dataReady
  );
  const adapter: ChartAdapter = {
    setDrawingAxisLabels(next) {
      if (!live.retired) axisLabels.setDrawings(next);
    },
    setCandleCountdown(next) {
      if (!live.retired) camera.programmatic(() => axisLabels.setCountdown(next));
    },
    setLastPriceLabelColors(colors) {
      if (!live.retired) camera.programmatic(() => axisLabels.setColors(colors));
    },
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
        { ...options.row, step: metadata.step, price: metadata.priceHint },
        priceFormat
      );
      const changed = next.precision !== priceFormat.precision;
      priceFormat = next;
      priceHint = metadata.priceHint ?? priceHint;
      if (!changed) return;
      camera.programmatic(() => {
        chart.setPriceVolumePrecision(next.precision, 0);
        technical?.refreshNativeMetadata();
        // KLine 9.8 updates only its precision store; invalidate native labels via public API.
        axisWidth = stablePriceAxisWidth(
          { ...options.row, price: priceHint },
          settings.scaleFontSize ?? 11,
          container.clientWidth,
          next.precision
        );
        chart.setStyles({ yAxis: { size: axisWidth } });
        axisLabels.refresh();
      });
    },
    ...navigation,
    setData(next, fit) {
      if (live.retired) return;
      dataReady = false;
      data = [...next];
      axisLabels.refresh();
      model.reset(data, activeMtpPeriods(indicators));
      technical?.setData(data);
      chart.applyNewData(data);
      if (fit) {
        const count = data.filter(
          (bar) => bar.timestamp >= Date.now() - options.rangeDays * 86400000
        ).length;
        chart.setBarSpace(
          Math.max(0.2, Math.min(30, (container.clientWidth - 70) / Math.max(20, count)))
        );
        chart.scrollToRealTime();
      }
      paintFront();
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
      axisLabels.refresh();
      technical?.setData(data);
      if (historical) {
        camera.programmatic(() => preserveKlineCamera(chart, () => chart.applyNewData(data)));
      } else chart.updateData(bar);
    },
    getView() {
      if (!dataReady || !data.length) return null;
      const size = chart.getSize("candle_pane", DomPosition.Main),
        ownData = chart.getDataList(),
        point = fromPixel({ x: (size?.width ?? 500) / 2 }),
        index = Math.max(0, Math.min(ownData.length - 1, point.dataIndex ?? 0)),
        bar = ownData[index],
        pixel = toPixel({ dataIndex: index }),
        lastPixel = toPixel({ dataIndex: data.length - 1 }),
        barSpace = chart.getBarSpace(),
        visible = chart.getVisibleRange(),
        first = ownData[Math.max(0, Math.ceil(visible.from))],
        last = ownData[Math.min(ownData.length - 1, Math.ceil(visible.to) - 1)];
      return {
        ...(size && lastPixel.x != null
          ? {
              camera: {
                barSpace,
                rightOffsetBars: readKlineCameraOffset(chart)
              }
            }
          : {}),
        barSpace,
        offsetRight: chart.getOffsetRightDistance(),
        ...(first && last ? { from: first.timestamp / 1000, to: last.timestamp / 1000 } : {}),
        ...(bar && pixel.x != null
          ? { anchor: { timestamp: bar.timestamp, xFraction: pixel.x / (size?.width ?? 500) } }
          : {})
      };
    },
    setView(view) {
      pendingView.stage(view);
      flushView();
    },
    getManualPriceRange: () =>
      dataReady && !live.retired ? getKlineManualPriceRange(chart) : null,
    setManualPriceRange(range) {
      if (live.retired) return;
      pendingPriceRange = range;
      camera.programmatic(flushView);
    },
    setLinkedCrosshair(timestamp) {
      if (!live.retired) link.setCrosshair(dataReady ? data : [], timestamp);
    },
    setLinkedTimeWindow(window) {
      if (!live.retired && dataReady) camera.programmatic(() => link.setTimeWindow(data, window));
    },
    zoomToSelection(from, to) {
      if (live.retired || !dataReady) return;
      const bounds = selectionZoomBounds(
        { data, timeframe, minMove: priceFormat.minMove },
        from,
        to
      );
      if (bounds && zoomKlineSelection(chart, bounds, (dataIndex) => toPixel({ dataIndex }).x))
        paintFront();
    },
    pointToPixel,
    technicalPaneMetrics: () => technical?.metrics() ?? [],
    setTechnicalPaneFocus(focus) {
      if (!live.retired)
        camera.programmatic(() => preserveKlineCamera(chart, () => technical?.setFocus(focus)));
    },
    timeAxisTop: () => technical?.timeAxisTop() ?? container.clientHeight - 28,
    updateTechnicalInputs(inputs) {
      if (!live.retired)
        camera.programmatic(() =>
          preserveKlineCamera(chart, () => technical?.updateInputs(inputs))
        );
    },
    updateTechnicalIndicators(instances, layout) {
      if (live.retired) return;
      camera.programmatic(() =>
        preserveKlineCamera(chart, () => technical?.update(instances, layout))
      );
    },
    beginPan: (start) => beginKlinePan(chart, start),
    focusPoints(points) {
      const size = chart.getSize("candle_pane", DomPosition.Main);
      if (!size || !points.length) return;
      const pixels = points.flatMap((point) => {
        const pixel = pointToPixel(point);
        return pixel ? [pixel.x] : [];
      });
      const target = focusRange(pixels, { from: 0, to: size.width });
      if (target) {
        freezeKlinePriceScale(chart);
        chart.scrollByDistance(-target.from, 0);
        paintFront();
      }
    },
    pixelToPoint(x, y) {
      const size = chart.getSize("candle_pane", DomPosition.Main);
      if (!size || x < 0 || x > size.width || y < 0 || y > size.height) return null;
      const point = fromPixel({ x, y });
      if (point.dataIndex == null || point.value == null) return null;
      const timestamp = timeForLogical(data, point.dataIndex, TIMEFRAMES[timeframe].ms);
      return timestamp == null ? null : { timestamp, value: point.value };
    },
    plotSize() {
      const size = chart.getSize("candle_pane", DomPosition.Main);
      return {
        width: size?.width ?? container.clientWidth - 65,
        height: size?.height ?? container.clientHeight - 28
      };
    },
    fit() {
      if (live.retired) return;
      fittingLoaded = true;
      try {
        navigation.fit();
      } finally {
        fittingLoaded = false;
      }
    },
    redrawDrawings() {
      redrawKlineDrawingIndicator(chart, drawingContext);
      paintFront();
    },
    destroy() {
      stopFrontProjection();
      axisLabels.dispose();
      technical?.dispose();
      disposeKlineDrawingContext(drawingContext);
      detachCanvasResize();
      volumeLayout.dispose();
      detachCalendarXAxis();
      resize.disconnect();
      front.remove();
      dispose(container);
    }
  };
  const live = camera.wrap(adapter);
  const technical = klineTechnical(
    chart,
    options,
    () => !live.retired,
    volumeLayout.ratio,
    volumeLayout.apply,
    detachCanvasResize.refresh,
    paintFront
  );
  technical.update(options.technicalIndicators ?? [], options.technicalPaneLayout);
  const stopFrontProjection = attachKlineFrontProjection(chart, paintFront, () => !live.retired);
  return live;
}
