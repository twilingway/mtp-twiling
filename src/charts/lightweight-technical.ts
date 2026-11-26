import { lightweightReferenceContext } from "./lightweight-reference-context.js";
import { lightweightReferenceLevels } from "./lightweight-reference-levels.js";
import { HistogramSeries, LineSeries } from "lightweight-charts";
import type {
  IChartApi,
  IPaneApi,
  IPriceLine,
  ISeriesApi,
  AutoscaleInfoProvider,
  Time,
  UTCTimestamp
} from "lightweight-charts";
import type { Candle } from "../model/types.js";
import type { TechnicalIndicatorInstance } from "../model/technical-indicators/types.js";
import type {
  TechnicalIndicatorGroup,
  TechnicalPanePreference
} from "../model/technical-indicator-layout.js";
import type { ChartOptions, TechnicalPaneMetric, TechnicalSupplementalInputs } from "./adapter.js";
import { TechnicalRenderData } from "./technical-render-data.js";
import { hasVisibleAverage, technicalCalculationContext } from "./technical-calculation-context.js";
import type { TechnicalRenderOutput } from "./technical-render-data.js";
import { captureTechnicalPaneLayout, technicalPaneGeometry } from "./technical-pane-geometry.js";
import { attachTechnicalPaneEvents } from "./technical-pane-events.js";
import { lineColor } from "../model/candle-palette.js";
import { chartPalette } from "../model/theme.js";
import { presentationColor } from "../model/technical-indicators/presentation.js";
import { LightweightTechnicalPrimitive } from "./lightweight-technical-primitives.js";
import { lightweightCompactCrosshair } from "./technical-compact-crosshair.js";
import { lightweightCalendarRegions } from "./lightweight-calendar-regions.js";

type Series = ISeriesApi<"Line"> | ISeriesApi<"Histogram">;
interface Entry {
  series: Series;
  kind: string;
  presented: boolean;
  levels: IPriceLine[];
  levelKey: string;
  primitive?: LightweightTechnicalPrimitive;
}

export function lightweightTechnical(
  chart: IChartApi,
  options: ChartOptions,
  alive: () => boolean,
  primary?: () => ISeriesApi<"Candlestick"> | ISeriesApi<"Line">
) {
  const calculation = new TechnicalRenderData(
    technicalCalculationContext(options.timeframe, options.row)
  );
  const calendar = lightweightCalendarRegions(chart, options, alive, primary);
  const owned = new Map<string, Entry>(),
    panes = new Map<string, IPaneApi<Time>>();
  const fills = new Map<string, { primitive: LightweightTechnicalPrimitive; series: Series }>();
  let instances: readonly TechnicalIndicatorInstance[] = [],
    layout: readonly TechnicalPanePreference[] = [];
  let groups: TechnicalIndicatorGroup[] = [],
    disposed = false,
    lastMetrics = "",
    candleCount = 0,
    projected = false,
    viewportFrame = 0;
  let candleTail: { index: number; timestamp: number } | undefined;
  let events: ReturnType<typeof attachTechnicalPaneEvents> | undefined;
  const nativePanes = () => (typeof chart.panes === "function" ? chart.panes() : []);
  const referenceContext = lightweightReferenceContext(chart, () => primary?.());
  const referenceLevels = lightweightReferenceLevels(
    chart,
    referenceContext,
    () => !disposed && alive()
  );
  const timeHeight = () =>
    typeof chart.timeScale().height === "function" ? chart.timeScale().height() : 28;
  const metrics = (): TechnicalPaneMetric[] => {
    if (disposed) return [];
    const all = nativePanes();
    const width = chart.timeScale().width();
    if (!all.length)
      return [
        {
          key: "price",
          top: 0,
          height: Math.max(0, options.container.clientHeight - timeHeight()),
          width
        }
      ];
    const reverse = new Map([...panes].map(([key, pane]) => [pane, key]));
    let top = 0;
    return all.flatMap((pane, index) => {
      const height = pane.getHeight(),
        y = top;
      top += height + (index < all.length - 1 ? 1 : 0);
      const key = index === 0 ? "price" : reverse.get(pane);
      // New model panes get their widgets on LW's next animation frame.
      // Their shared time-scale width is already available; paneSize can throw here.
      return key ? [{ key, top: y, height, width }] : [];
    });
  };
  const crosshair = lightweightCompactCrosshair(
    chart,
    options.container,
    metrics,
    alive,
    (index) => {
      if (index === 0) return "price";
      const pane = nativePanes()[index];
      return [...panes].find(([, value]) => value === pane)?.[0];
    }
  );
  const changed = () => {
    if (disposed || !alive()) return;
    const next = metrics(),
      key = JSON.stringify(next);
    crosshair.refresh(next);
    if (key !== lastMetrics) {
      lastMetrics = key;
      options.onTechnicalPaneMetrics?.(next);
    }
  };
  const apply = () => {
    if (disposed || !alive() || events?.dragging() || !panes.size) return;
    const targets = technicalPaneGeometry(
      options.container.clientHeight,
      groups,
      null,
      timeHeight()
    );
    const price = nativePanes()[0];
    for (const item of targets) {
      const pane = item.key === "price" ? price : panes.get(item.key);
      pane?.setStretchFactor(item.height);
    }
  };
  function listen() {
    if (
      events ||
      disposed ||
      (!options.onTechnicalPaneMetrics && !options.onTechnicalPaneLayout && !groups.length)
    )
      return;
    events = attachTechnicalPaneEvents(options.container, {
      metrics,
      apply,
      changed,
      capture(before, after) {
        if (disposed || !alive()) return;
        const next = captureTechnicalPaneLayout(layout, before, after);
        if (next) {
          layout = next.layout;
          groups = calculation.compile(instances, layout).groups;
          options.onTechnicalPaneLayout?.(next.layout, next.context);
        }
      }
    });
    for (const pane of nativePanes()) {
      const element = pane.getHTMLElement();
      if (element) events.observe(element);
    }
  }
  const primitivePlot = (output: TechnicalRenderOutput) =>
    output.presentation?.precisionPolicy === "fixed-2" ||
    output.presentation?.geometry.kind === "cross" ||
    output.presentation?.geometry.kind === "range-bars" ||
    output.presentation?.geometry.kind === "candles" ||
    output.presentation?.geometry.kind === "marker" ||
    (output.presentation?.geometry.kind === "line" &&
      output.presentation.geometry.gaps === "break");
  function outputOptions(output: TechnicalRenderOutput, fillCarrier = false) {
    const policy = output.presentation?.precisionPolicy;
    const original: AutoscaleInfoProvider = (original) =>
      !disposed && alive() && output.style.visible ? original() : null;
    const autoscaleInfoProvider =
      policy === "fixed-2"
        ? referenceContext.autoscale(
            output.instanceId,
            output.paneKey,
            () => referenceContext.first(output.values, output.timestamps, false),
            null,
            original
          )
        : original;
    return {
      ...(policy === "fixed-2"
        ? { priceFormat: { type: "price" as const, precision: 2, minMove: 0.01 } }
        : policy === "compact-number" && output.paneKey !== "price"
          ? { priceFormat: { type: "volume" as const, precision: 2, minMove: 0.01 } }
          : (policy === "native-price" || policy === "compact-number") && primary
            ? { priceFormat: primary().options().priceFormat }
            : {}),
      color: lineColor(output.style.color, output.style.opacity),
      visible: output.style.visible || fillCarrier,
      priceScaleId: "right",
      lastValueVisible: false,
      priceLineVisible: false,
      ...(output.presentation ? { autoscaleInfoProvider } : {}),
      ...(output.kind === "line"
        ? {
            lineWidth: output.style.width as 1 | 2 | 3 | 4,
            crosshairMarkerVisible: false,
            ...(output.presentation
              ? {
                  lineVisible: output.style.visible && !primitivePlot(output),
                  pointMarkersVisible: false,
                  lastPriceAnimation: 0
                }
              : {}),
            lineStyle:
              output.style.lineStyle === "dashed" ? 2 : output.style.lineStyle === "dotted" ? 1 : 0
          }
        : {
            base: 0,
            ...(output.presentation && !output.style.visible ? { color: "transparent" } : {})
          })
    };
  }
  function removeEntry(entry: Entry) {
    if (entry.primitive) {
      entry.primitive.dispose();
      entry.series.detachPrimitive(entry.primitive);
    }
    for (const [key, fill] of fills)
      if (fill.series === entry.series) {
        fill.primitive.dispose();
        fill.series.detachPrimitive(fill.primitive);
        fills.delete(key);
      }
    chart.removeSeries(entry.series);
  }
  const readViewport = () => {
    const range = chart.timeScale().getVisibleLogicalRange?.();
    return calculation.setVisibleBars(range?.from ?? Infinity, range?.to ?? -Infinity);
  };
  const onViewportChange = () => {
    if (disposed || !alive() || viewportFrame || !hasVisibleAverage(instances)) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (!disposed && alive() && hasVisibleAverage(instances) && readViewport()) reconcile();
    });
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange?.(onViewportChange);
  function reconcile() {
    if (disposed || !alive()) return;
    if (hasVisibleAverage(instances)) readViewport();
    const compiled = calculation.compile(instances, layout);
    projected = compiled.outputs.some((output) => output.timestamps.length > candleCount);
    calendar.update(compiled.priceRegions, candleTail);
    groups = compiled.groups;
    const lower = groups.filter((group) => group.key !== "price");
    const activePanes = new Set(lower.map((group) => group.key));
    const activeSeries = new Set(compiled.outputs.map((output) => output.key));
    for (const [key, entry] of owned)
      if (!activeSeries.has(key)) {
        removeEntry(entry);
        owned.delete(key);
      }
    for (const group of lower) if (!panes.has(group.key)) panes.set(group.key, chart.addPane(true));
    const decorated = new Set<string>();
    for (const output of compiled.outputs) {
      const pane = output.paneKey === "price" ? nativePanes()[0]! : panes.get(output.paneKey)!;
      let entry = owned.get(output.key);
      if (entry && (entry.kind !== output.kind || entry.presented !== !!output.presentation)) {
        removeEntry(entry);
        owned.delete(output.key);
        entry = undefined;
      }
      if (!entry) {
        const series =
          output.kind === "histogram"
            ? chart.addSeries(HistogramSeries, outputOptions(output), pane.paneIndex())
            : chart.addSeries(LineSeries, outputOptions(output), pane.paneIndex());
        entry = {
          series,
          kind: output.kind,
          presented: !!output.presentation,
          levels: [],
          levelKey: ""
        };
        owned.set(output.key, entry);
      }
      if (entry.series.getPane() !== pane) entry.series.moveToPane(pane.paneIndex());
      const fillCarrier = compiled.fills.some(
        (fill) => fill.scalePlotKey === output.key && fill.visible
      );
      entry.series.applyOptions(outputOptions(output, fillCarrier));
      if (primitivePlot(output)) {
        if (!entry.primitive) {
          entry.primitive = new LightweightTechnicalPrimitive(chart, entry.series, alive);
          entry.series.attachPrimitive(entry.primitive);
        }
        entry.primitive.updatePlot(
          output,
          output.presentation?.precisionPolicy === "fixed-2"
            ? (value) => referenceContext.project(output.instanceId, output.paneKey, value)
            : undefined
        );
      } else if (entry.primitive) {
        entry.primitive.dispose();
        entry.series.detachPrimitive(entry.primitive);
        delete entry.primitive;
      }
      entry.series.setData(
        output.timestamps.map((timestamp, index) => {
          const time = Math.floor(timestamp / 1000) as UTCTimestamp,
            value = output.values[index];
          if (value === null || value === undefined || !Number.isFinite(value)) return { time };
          const color =
            output.presentation?.geometry.kind === "columns"
              ? output.style.visible
                ? (presentationColor(output.presentation, index) ?? "transparent")
                : "transparent"
              : null;
          return color
            ? { time, value, color: lineColor(color, output.style.opacity) }
            : { time, value };
        })
      );
      const levels = output.style.visible
        ? output.levels.filter((price) => {
            const key = `${output.paneKey}:${price}`;
            if (decorated.has(key)) return false;
            decorated.add(key);
            return true;
          })
        : [];
      const levelKey = JSON.stringify(levels);
      if (levelKey !== entry.levelKey) {
        for (const level of entry.levels) entry.series.removePriceLine(level);
        entry.levels = levels.map((price) =>
          entry.series.createPriceLine({
            price,
            color: "#787b8666",
            lineStyle: 2,
            lineWidth: 1,
            axisLabelVisible: false,
            title: ""
          })
        );
        entry.levelKey = levelKey;
      }
    }
    referenceContext.update(
      compiled.outputs,
      new Map([...owned].map(([key, entry]) => [key, entry.series]))
    );
    referenceLevels.update(compiled.references ?? [], compiled.fills, (key) =>
      key === "price" ? 0 : panes.get(key)!.paneIndex()
    );
    const activeFills = new Set(
      compiled.fills.filter((fill) => fill.extent !== "pane").map((fill) => fill.key)
    );
    for (const [key, fill] of fills)
      if (!activeFills.has(key)) {
        fill.primitive.dispose();
        fill.series.detachPrimitive(fill.primitive);
        fills.delete(key);
      }
    for (const fill of compiled.fills) {
      if (fill.extent === "pane") continue;
      const carrier = owned.get(fill.scalePlotKey);
      if (!carrier) continue;
      let entry = fills.get(fill.key);
      if (!entry || entry.series !== carrier.series) {
        if (entry) {
          entry.primitive.dispose();
          entry.series.detachPrimitive(entry.primitive);
        }
        const primitive = new LightweightTechnicalPrimitive(chart, carrier.series, alive);
        carrier.series.attachPrimitive(primitive);
        entry = { primitive, series: carrier.series };
        fills.set(fill.key, entry);
      }
      const coordinates = [
        carrier.series,
        ...compiled.outputs
          .filter(
            (output) =>
              output.instanceId === fill.instanceId &&
              output.paneKey === fill.paneKey &&
              output.key !== fill.scalePlotKey
          )
          .map((output) => owned.get(output.key)!.series)
      ];
      entry.primitive.updateFill(fill, (value) => {
        for (const series of coordinates) {
          const coordinate = series.priceToCoordinate(value);
          if (coordinate !== null && Number.isFinite(coordinate)) return coordinate;
        }
        return null;
      });
    }
    for (const [key, pane] of panes)
      if (!activePanes.has(key)) {
        chart.removePane(pane.paneIndex());
        panes.delete(key);
      }
    lower.forEach((group, index) => {
      const pane = panes.get(group.key)!;
      if (pane.paneIndex() !== index + 1) pane.moveTo(index + 1);
      // Keep a collapsed strip's range and width; it has no visible data scale to label.
      const axis = pane.priceScale("right"),
        color = group.preference?.collapsed ? "transparent" : chartPalette(options.settings).text;
      if (axis.options().textColor !== color) axis.applyOptions({ textColor: color });
    });
    const allOwned = new Set([...owned.values()].map((entry) => entry.series));
    for (const group of groups) {
      const pane = group.key === "price" ? nativePanes()[0]! : panes.get(group.key)!;
      const base = pane.getSeries().filter((series) => !allOwned.has(series as Series)).length;
      compiled.outputs
        .filter((output) => output.paneKey === group.key)
        .forEach((output, index) => owned.get(output.key)!.series.setSeriesOrder(base + index));
    }
    listen();
    for (const pane of nativePanes()) {
      const element = pane.getHTMLElement();
      if (element) events?.observe(element);
    }
    apply();
    changed();
    events?.schedule();
  }
  return {
    updateInputs(inputs: TechnicalSupplementalInputs) {
      if (!disposed && alive() && calculation.setSupplementalInputs(inputs, options.row.uid))
        reconcile();
    },
    setData(data: readonly Candle[]) {
      if (disposed || !alive()) return;
      candleCount = data.length;
      const last = data.at(-1);
      candleTail =
        last === undefined ? undefined : { index: data.length - 1, timestamp: last.timestamp };
      calculation.setData(data);
      reconcile();
    },
    update(
      next: readonly TechnicalIndicatorInstance[],
      nextLayout: readonly TechnicalPanePreference[] = []
    ) {
      if (disposed || !alive()) return;
      events?.cancel();
      instances = next;
      layout = nextLayout;
      reconcile();
    },
    metrics,
    hasProjectedPlots: () => projected,
    timeAxisTop: () => {
      if (disposed) return 0;
      const all = nativePanes();
      return all.length
        ? all.reduce((sum, pane) => sum + pane.getHeight(), 0) + all.length - 1
        : options.container.clientHeight - timeHeight();
    },
    refreshNativeMetadata: reconcile,
    dispose() {
      calendar.dispose();
      referenceLevels.dispose();
      crosshair.dispose();
      disposed = true;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange?.(onViewportChange);
      if (viewportFrame) cancelAnimationFrame(viewportFrame);
      events?.dispose();
      calculation.dispose();
      for (const entry of owned.values()) removeEntry(entry);
      for (const pane of [...panes.values()].sort((a, b) => b.paneIndex() - a.paneIndex()))
        chart.removePane(pane.paneIndex());
      owned.clear();
      panes.clear();
      instances = [];
      layout = [];
      groups = [];
    }
  };
}
