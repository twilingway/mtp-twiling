import { HistogramSeries, LineSeries } from "lightweight-charts";
import type {
  IChartApi,
  IPaneApi,
  IPriceLine,
  ISeriesApi,
  Time,
  UTCTimestamp
} from "lightweight-charts";
import type { Candle } from "../model/types.js";
import type { TechnicalIndicatorInstance } from "../model/technical-indicators/types.js";
import type {
  TechnicalIndicatorGroup,
  TechnicalPanePreference
} from "../model/technical-indicator-layout.js";
import type { ChartOptions, TechnicalPaneMetric } from "./adapter.js";
import { TechnicalRenderData } from "./technical-render-data.js";
import type { TechnicalRenderOutput } from "./technical-render-data.js";
import { capturedTechnicalLayout, technicalPaneGeometry } from "./technical-pane-geometry.js";
import { attachTechnicalPaneEvents } from "./technical-pane-events.js";
import { lineColor } from "../model/candle-palette.js";

type Series = ISeriesApi<"Line"> | ISeriesApi<"Histogram">;
interface Entry {
  series: Series;
  kind: string;
  levels: IPriceLine[];
  levelKey: string;
}

export function lightweightTechnical(
  chart: IChartApi,
  options: ChartOptions,
  alive: () => boolean
) {
  const calculation = new TechnicalRenderData();
  const owned = new Map<string, Entry>(),
    panes = new Map<string, IPaneApi<Time>>();
  let instances: readonly TechnicalIndicatorInstance[] = [],
    layout: readonly TechnicalPanePreference[] = [];
  let groups: TechnicalIndicatorGroup[] = [],
    disposed = false,
    lastMetrics = "";
  let events: ReturnType<typeof attachTechnicalPaneEvents> | undefined;
  const nativePanes = () => (typeof chart.panes === "function" ? chart.panes() : []);
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
  const changed = () => {
    if (disposed || !alive()) return;
    const next = metrics(),
      key = JSON.stringify(next);
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
        const next = capturedTechnicalLayout(layout, before, after);
        if (next) {
          layout = next;
          groups = calculation.compile(instances, layout).groups;
          options.onTechnicalPaneLayout?.(next);
        }
      }
    });
    for (const pane of nativePanes()) {
      const element = pane.getHTMLElement();
      if (element) events.observe(element);
    }
  }
  function outputOptions(output: TechnicalRenderOutput) {
    return {
      color: lineColor(output.style.color, output.style.opacity),
      visible: output.style.visible,
      priceScaleId: "right",
      lastValueVisible: false,
      priceLineVisible: false,
      ...(output.kind === "line"
        ? {
            lineWidth: output.style.width as 1 | 2 | 3 | 4,
            crosshairMarkerVisible: false,
            lineStyle:
              output.style.lineStyle === "dashed" ? 2 : output.style.lineStyle === "dotted" ? 1 : 0
          }
        : { base: 0 })
    };
  }
  function reconcile() {
    if (disposed || !alive()) return;
    const compiled = calculation.compile(instances, layout);
    groups = compiled.groups;
    const lower = groups.filter((group) => group.key !== "price");
    const activePanes = new Set(lower.map((group) => group.key));
    const activeSeries = new Set(compiled.outputs.map((output) => output.key));
    for (const [key, entry] of owned)
      if (!activeSeries.has(key)) {
        chart.removeSeries(entry.series);
        owned.delete(key);
      }
    for (const group of lower) if (!panes.has(group.key)) panes.set(group.key, chart.addPane(true));
    const decorated = new Set<string>();
    for (const output of compiled.outputs) {
      const pane = output.paneKey === "price" ? nativePanes()[0]! : panes.get(output.paneKey)!;
      let entry = owned.get(output.key);
      if (entry && entry.kind !== output.kind) {
        chart.removeSeries(entry.series);
        owned.delete(output.key);
        entry = undefined;
      }
      if (!entry) {
        const series =
          output.kind === "histogram"
            ? chart.addSeries(HistogramSeries, outputOptions(output), pane.paneIndex())
            : chart.addSeries(LineSeries, outputOptions(output), pane.paneIndex());
        entry = { series, kind: output.kind, levels: [], levelKey: "" };
        owned.set(output.key, entry);
      }
      if (entry.series.getPane() !== pane) entry.series.moveToPane(pane.paneIndex());
      entry.series.applyOptions(outputOptions(output));
      entry.series.setData(
        output.timestamps.map((timestamp, index) => {
          const time = Math.floor(timestamp / 1000) as UTCTimestamp,
            value = output.values[index];
          return value === null || value === undefined ? { time } : { time, value };
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
    for (const [key, pane] of panes)
      if (!activePanes.has(key)) {
        chart.removePane(pane.paneIndex());
        panes.delete(key);
      }
    lower.forEach((group, index) => {
      const pane = panes.get(group.key)!;
      if (pane.paneIndex() !== index + 1) pane.moveTo(index + 1);
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
    setData(data: readonly Candle[]) {
      if (disposed || !alive()) return;
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
    timeAxisTop: () => {
      if (disposed) return 0;
      const all = nativePanes();
      return all.length
        ? all.reduce((sum, pane) => sum + pane.getHeight(), 0) + all.length - 1
        : options.container.clientHeight - timeHeight();
    },
    dispose() {
      disposed = true;
      events?.dispose();
      calculation.dispose();
      for (const entry of owned.values()) chart.removeSeries(entry.series);
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
