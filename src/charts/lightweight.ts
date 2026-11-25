import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart
} from "lightweight-charts";
import type { ISeriesPrimitive, Logical, Time, UTCTimestamp } from "lightweight-charts";
import { MtpModel, activeMtpPeriods, lightweightMtp } from "../model/mtp.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import type { Candle, ChartView, DrawingPoint } from "../model/types.js";
import { logicalForTime, movingAverage, precision, timeForLogical } from "./adapter.js";
import type { ChartAdapter, ChartOptions } from "./adapter.js";
import { lineColor } from "../model/candle-palette.js";
import { focusRange } from "./navigation.js";
import { PendingChartView } from "./view-camera.js";

export function makeLightweight(options: ChartOptions): ChartAdapter {
  const { container, row, settings, indicators, timeframe } = options;
  let data: Candle[] = [],
    updateDrawings = () => {};
  const pendingView = new PendingChartView();
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: settings.background ?? "#131722" },
      textColor: "#9598a1",
      fontFamily: '-apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif',
      fontSize: settings.scaleFontSize ?? 11,
      attributionLogo: false
    },
    grid: {
      vertLines: { color: "#2a2e39", visible: settings.grid !== false },
      horzLines: { color: "#2a2e39", visible: settings.grid !== false }
    },
    rightPriceScale: { borderColor: "#2a2e39", scaleMargins: { top: 0.08, bottom: 0.22 } },
    timeScale: {
      borderColor: "#2a2e39",
      timeVisible: !["1d", "1w"].includes(timeframe),
      rightOffset: 8
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "#647086", style: 2 },
      horzLine: { color: "#647086", style: 2 }
    },
    localization: { locale: "ru-RU" }
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
    priceLineVisible: settings.priceLine !== false,
    priceFormat: { type: "price", precision: precision(row), minMove: row.step ?? 0.01 }
  });
  const volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    lastValueVisible: false,
    priceLineVisible: false
  });
  volume
    .priceScale()
    .applyOptions({ scaleMargins: { top: 0.83, bottom: 0 }, borderVisible: false });
  const sma = chart.addSeries(LineSeries, {
    color: lineColor(
      settings.indicatorOptions?.ma?.color ?? "#ddad56",
      settings.indicatorOptions?.ma?.opacity
    ),
    lineWidth: (settings.indicatorOptions?.ma?.width ?? 1) as 1 | 2 | 3 | 4,
    priceLineVisible: false,
    lastValueVisible: false
  });
  const ema = chart.addSeries(LineSeries, {
    color: lineColor(
      settings.indicatorOptions?.ema?.color ?? "#7b8fff",
      settings.indicatorOptions?.ema?.opacity
    ),
    lineWidth: (settings.indicatorOptions?.ema?.width ?? 1) as 1 | 2 | 3 | 4,
    priceLineVisible: false,
    lastValueVisible: false
  });
  series.setSeriesOrder(3);
  const model = new MtpModel();
  if (settings.indicatorOptions) model.styles = settings.indicatorOptions;
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
        zOrder: () => (layer === "front" ? ("normal" as const) : ("bottom" as const)),
        renderer: () => ({
          draw: (target) => {
            target.useBitmapCoordinateSpace((scope) => {
              const { context, horizontalPixelRatio: x, verticalPixelRatio: y, bitmapSize } = scope;
              context.save();
              context.scale(x, y);
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
      }))
  };
  series.attachPrimitive(primitive);
  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range && range.from < 80) options.onNearStart();
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
  function averages() {
    sma.setData(
      indicators.ma
        ? movingAverage(data, 20).map((p) => ({ ...p, time: p.time as UTCTimestamp }))
        : []
    );
    ema.setData(
      indicators.ema
        ? movingAverage(data, 50, true).map((p) => ({ ...p, time: p.time as UTCTimestamp }))
        : []
    );
  }
  function restoreView() {
    const view = pendingView.take(data.length > 0 && chart.timeScale().width() > 0);
    if (!view) return;
    const scale = chart.timeScale(),
      camera = view.camera;
    if (camera) {
      scale.applyOptions({ barSpacing: camera.barSpace });
      scale.scrollToPosition(camera.rightOffsetBars, false);
    } else if (view.barSpace) scale.applyOptions({ barSpacing: view.barSpace });
    if (view.anchor) {
      const index = logicalForTime(data, view.anchor.timestamp, TIMEFRAMES[timeframe].ms),
        x = scale.logicalToCoordinate(index as Logical);
      if (x != null)
        scale.scrollToPosition(
          scale.scrollPosition() +
            (x - scale.width() * view.anchor.xFraction) / scale.options().barSpacing,
          false
        );
    } else if (!camera && view.from != null && view.to != null && view.from < view.to) {
      scale.setVisibleRange({ from: view.from as UTCTimestamp, to: view.to as UTCTimestamp });
    }
    updateDrawings();
  }
  chart.timeScale().subscribeSizeChange(restoreView);
  return {
    setData(next, fit) {
      data = next;
      model.reset(data, activeMtpPeriods(indicators));
      series.setData(data.map((bar) => ({ ...bar, time: time(bar) })));
      volume.setData(
        indicators.volume
          ? data.map((bar) => ({
              time: time(bar),
              value: bar.volume,
              color: bar.close >= bar.open ? "#08998144" : "#f2364544"
            }))
          : []
      );
      averages();
      mtp.update();
      updateDrawings();
      if (fit && data.length) {
        const first =
            data.find((bar) => bar.timestamp >= Date.now() - options.rangeDays * 86400000) ??
            data[0]!,
          last = data.at(-1)!;
        chart.timeScale().setVisibleRange({ from: time(first), to: time(last) });
      }
      restoreView();
    },
    updateBar(bar) {
      const index = data.findIndex((item) => item.timestamp === bar.timestamp);
      if (index >= 0) data[index] = bar;
      else data.push(bar);
      model.update(data);
      series.update({ ...bar, time: time(bar) });
      if (indicators.volume)
        volume.update({
          time: time(bar),
          value: bar.volume,
          color: bar.close >= bar.open ? "#08998144" : "#f2364544"
        });
      averages();
      mtp.update();
    },
    getView() {
      if (!data.length) return null;
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
      restoreView();
    },
    pointToPixel,
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
      const index = chart.timeScale().coordinateToLogical(x),
        value = series.coordinateToPrice(y);
      if (index == null || value == null) return null;
      const timestamp = timeForLogical(data, index, TIMEFRAMES[timeframe].ms);
      return timestamp == null ? null : { timestamp, value };
    },
    plotSize: () => ({ width: chart.timeScale().width(), height: container.clientHeight - 28 }),
    fit() {
      series.priceScale().applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    },
    redrawDrawings: () => updateDrawings(),
    destroy() {
      mtp.destroy();
      chart.remove();
    }
  };
}
