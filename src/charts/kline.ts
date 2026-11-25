import {
  ActionType,
  DomPosition,
  IndicatorSeries,
  LineType,
  TooltipShowRule,
  dispose,
  init,
  registerIndicator
} from "klinecharts";
import type { Coordinate, Indicator, IndicatorDrawParams, Point } from "klinecharts";
import { MtpModel, activeMtpPeriods } from "../model/mtp.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import type { Candle, ChartView, DrawingPoint } from "../model/types.js";
import { logicalForTime, precision, timeForLogical } from "./adapter.js";
import type { ChartAdapter, ChartOptions } from "./adapter.js";
import { lineColor } from "../model/candle-palette.js";
import { beginKlinePan, freezeKlinePriceScale, resetKlinePriceScale } from "./kline-price-scale.js";
import { focusRange } from "./navigation.js";
import { PendingChartView, signedRightOffset } from "./view-camera.js";
import { drawingToolbarSettings } from "../model/drawing-toolbar.js";
import { stablePriceAxisWidth } from "./price-axis-layout.js";
import { chartPalette } from "../model/theme.js";

export function makeKline(options: ChartOptions): ChartAdapter {
  const { container, settings, timeframe, indicators } = options;
  let data: Candle[] = [],
    dataReady = false;
  const pendingView = new PendingChartView();
  let axisWidth = stablePriceAxisWidth(
    options.row,
    settings.scaleFontSize ?? 11,
    container.clientWidth
  );
  const palette = chartPalette(settings);
  const model = new MtpModel();
  if (settings.indicatorOptions) model.styles = settings.indicatorOptions;
  registerIndicator({
    name: "MTP_PERSONAL",
    shortName: "",
    series: IndicatorSeries.Price,
    zLevel: -1,
    figures: [
      { key: "mtpLow", title: "", type: "line" },
      { key: "mtpHigh", title: "", type: "line" }
    ],
    calc: () => model.bounds,
    draw: ({ ctx, visibleRange, xAxis, yAxis }) => {
      model.draw(
        ctx,
        visibleRange.from,
        visibleRange.to,
        (index) => xAxis.convertToPixel(index),
        (price) => (price == null ? null : yAxis.convertToPixel(price))
      );
      return true;
    }
  });
  const drawObjects = ({
    ctx,
    bounding,
    xAxis,
    yAxis
  }: Pick<IndicatorDrawParams<Indicator>, "ctx" | "bounding" | "xAxis" | "yAxis">) => {
    options.paint(
      ctx,
      bounding.width,
      bounding.height,
      (point) => ({
        x: xAxis.convertToPixel(logicalForTime(data, point.timestamp, TIMEFRAMES[timeframe].ms)),
        y: yAxis.convertToPixel(point.value)
      }),
      "back"
    );
    return true;
  };
  registerIndicator({
    name: "DRAWINGS_PERSONAL",
    shortName: "",
    series: IndicatorSeries.Price,
    zLevel: -2,
    figures: [],
    calc: () => [],
    draw: drawObjects
  });
  const chart = init(container, {
    locale: "ru-RU",
    timezone: "Europe/Moscow",
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
        bar: {
          noChangeColor:
            settings.bodyVisible === false ? "transparent" : (settings.upColor ?? "#53b987"),
          noChangeBorderColor:
            settings.borderVisible === false
              ? "transparent"
              : (settings.borderUpColor ?? "#53b987"),
          noChangeWickColor:
            settings.wickVisible === false ? "transparent" : (settings.wickUpColor ?? "#336854"),
          upColor: settings.bodyVisible === false ? "transparent" : (settings.upColor ?? "#53b987"),
          downColor:
            settings.bodyVisible === false ? "transparent" : (settings.downColor ?? "#eb4d5c"),
          upBorderColor:
            settings.borderVisible === false
              ? "transparent"
              : (settings.borderUpColor ?? "#53b987"),
          downBorderColor:
            settings.borderVisible === false
              ? "transparent"
              : (settings.borderDownColor ?? "#eb4d5c"),
          upWickColor:
            settings.wickVisible === false ? "transparent" : (settings.wickUpColor ?? "#336854"),
          downWickColor:
            settings.wickVisible === false ? "transparent" : (settings.wickDownColor ?? "#7f323f")
        },
        tooltip: { showRule: TooltipShowRule.None },
        priceMark: {
          last: {
            show: settings.priceLine !== false,
            upColor: settings.upColor ?? "#53b987",
            downColor: settings.downColor ?? "#eb4d5c",
            noChangeColor: settings.upColor ?? "#53b987"
          }
        }
      },
      xAxis: {
        axisLine: { color: palette.border },
        tickLine: { color: palette.border },
        tickText: { color: palette.muted, size: settings.scaleFontSize ?? 11 }
      },
      yAxis: {
        size: axisWidth,
        axisLine: { color: palette.border },
        tickLine: { color: palette.border },
        tickText: { color: palette.muted, size: settings.scaleFontSize ?? 11 }
      },
      separator: { color: palette.border, fill: true, activeBackgroundColor: palette.grid }
    }
  });
  if (!chart) throw new Error("Не удалось создать KLineChart.");
  chart.setPriceVolumePrecision(precision(options.row), 0);
  const front = document.createElement("canvas");
  front.className = "foreground-canvas";
  container.parentElement?.append(front);
  function toPixel(point: Partial<Point>): Partial<Coordinate> {
    const result = chart!.convertToPixel([point], { paneId: "candle_pane", absolute: true });
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
    options.paint(ctx, size.width, size.height, pointToPixel, "front");
  }
  const resize = new ResizeObserver(() => {
    const width = stablePriceAxisWidth(
      options.row,
      settings.scaleFontSize ?? 11,
      container.clientWidth
    );
    if (width !== axisWidth) {
      axisWidth = width;
      chart.setStyles({ yAxis: { size: axisWidth } });
    }
    chart.resize();
    flushView();
    paintFront();
  });
  resize.observe(container);
  chart.subscribeAction(ActionType.OnVisibleRangeChange, (range: { from: number }) => {
    if (range.from < 80) options.onNearStart();
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
    const view = pendingView.take(
      dataReady && (chart?.getSize("candle_pane", DomPosition.Main)?.width ?? 0) > 0
    );
    if (view) restoreView(view);
  }
  chart.subscribeAction(ActionType.OnDataReady, () => {
    dataReady = data.length > 0 && chart.getDataList().length > 0;
    flushView();
    paintFront();
  });
  chart.subscribeAction(ActionType.OnZoom, () => paintFront());
  chart.subscribeAction(ActionType.OnScroll, () => paintFront());
  chart.subscribeAction(ActionType.OnCrosshairChange, (value: unknown) => {
    const index =
      value &&
      typeof value === "object" &&
      "dataIndex" in value &&
      typeof value.dataIndex === "number"
        ? Math.round(value.dataIndex)
        : -1;
    options.onCrosshair(data[index] ?? null);
  });
  return {
    setData(next, fit) {
      dataReady = false;
      data = next;
      model.reset(data, activeMtpPeriods(indicators));
      chart.applyNewData(data);
      for (const name of ["MA", "EMA", "VOL", "MTP_PERSONAL", "DRAWINGS_PERSONAL"])
        chart.removeIndicator(name === "VOL" ? "volume_pane" : "candle_pane", name);
      if (indicators.ma)
        chart.createIndicator(
          {
            name: "MA",
            calcParams: [20],
            zLevel: -1,
            styles: {
              lines: [
                {
                  color: lineColor(
                    settings.indicatorOptions?.ma?.color ?? "#ddad56",
                    settings.indicatorOptions?.ma?.opacity
                  ),
                  size: settings.indicatorOptions?.ma?.width ?? 1,
                  style: LineType.Solid,
                  dashedValue: [],
                  smooth: false
                }
              ]
            }
          },
          true,
          { id: "candle_pane" }
        );
      if (indicators.ema)
        chart.createIndicator(
          {
            name: "EMA",
            calcParams: [50],
            zLevel: -1,
            styles: {
              lines: [
                {
                  color: lineColor(
                    settings.indicatorOptions?.ema?.color ?? "#7b8fff",
                    settings.indicatorOptions?.ema?.opacity
                  ),
                  size: settings.indicatorOptions?.ema?.width ?? 1,
                  style: LineType.Solid,
                  dashedValue: [],
                  smooth: false
                }
              ]
            }
          },
          true,
          { id: "candle_pane" }
        );
      if (indicators.volume)
        chart.createIndicator("VOL", false, {
          id: "volume_pane",
          height: 95,
          dragEnabled: !drawingToolbarSettings(settings).indicatorsLocked
        });
      if (activeMtpPeriods(indicators).length)
        chart.createIndicator("MTP_PERSONAL", true, { id: "candle_pane" });
      chart.createIndicator("DRAWINGS_PERSONAL", true, { id: "candle_pane" });
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
      const index = data.findIndex((item) => item.timestamp === bar.timestamp);
      if (index >= 0) data[index] = bar;
      else data.push(bar);
      model.update(data);
      chart.updateData(bar);
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
                rightOffsetBars: signedRightOffset(size.width, lastPixel.x, barSpace)
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
    pointToPixel,
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
      resetKlinePriceScale(chart);
      chart.setBarSpace(6);
      chart.scrollToRealTime();
    },
    redrawDrawings() {
      chart.overrideIndicator(
        { name: "DRAWINGS_PERSONAL", draw: (args) => drawObjects(args) },
        "candle_pane"
      );
      paintFront();
    },
    destroy() {
      resize.disconnect();
      front.remove();
      dispose(container);
    }
  };
}
