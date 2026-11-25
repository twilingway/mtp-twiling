import {
  DomPosition,
  IndicatorSeries,
  LineType,
  PolygonType,
  registerIndicator
} from "klinecharts";
import type { Chart, Indicator, IndicatorCreate, IndicatorDrawParams } from "klinecharts";
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

type Row = Record<string, number | undefined>;
interface Context {
  rows: Row[];
  levels: number[];
  disposed: boolean;
}
interface Entry {
  name: string;
  paneId: string;
  context: Context;
}
const registered = new Set<string>();
function contextOf(indicator: Indicator<Row>): Context | null {
  const value: unknown = indicator.extendData;
  return value && typeof value === "object" && "context" in value
    ? (value.context as Context)
    : null;
}
function referenceLevels({ ctx, indicator, yAxis, bounding }: IndicatorDrawParams<Row>) {
  const context = contextOf(indicator);
  if (!context || context.disposed || !context.levels.length) return false;
  ctx.save();
  ctx.strokeStyle = "#787b8666";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const value of context.levels) {
    const y = yAxis.convertToPixel(value);
    if (!Number.isFinite(y) || y < 0 || y > bounding.height) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(bounding.width, y);
    ctx.stroke();
  }
  ctx.restore();
  return false;
}
/** At most 100 reusable names; registry callbacks never close over a chart, source or dataset. */
function registerSlot(slot: number): string {
  const name = `PERSONAL_TA_${slot}`;
  if (!registered.has(name)) {
    registered.add(name);
    registerIndicator<Row>({
      name,
      shortName: "",
      series: IndicatorSeries.Normal,
      figures: [],
      calc: (_bars, indicator) => {
        const context = contextOf(indicator);
        return context && !context.disposed ? context.rows : [];
      },
      draw: referenceLevels
    });
  }
  return name;
}

export function klineTechnical(
  chart: Chart,
  options: ChartOptions,
  alive: () => boolean,
  legacyRatio: () => number | null,
  restoreLegacy: () => void = () => {},
  refreshCanvases: () => void = () => {}
) {
  const calculation = new TechnicalRenderData();
  const entries = new Map<string, Entry>(),
    slots = new Map<string, number>();
  let groups: TechnicalIndicatorGroup[] = [],
    paneOrder: string[] = [];
  let instances: readonly TechnicalIndicatorInstance[] = [],
    layout: readonly TechnicalPanePreference[] = [];
  let disposed = false,
    lastMetrics = "",
    applying = false;
  let events: ReturnType<typeof attachTechnicalPaneEvents> | undefined;
  const nativeId = (key: string) => (key === "price" ? "candle_pane" : `technical:${key.slice(5)}`);
  const height = (id: string) => chart.getSize(id, DomPosition.Main)?.height ?? 0;
  const timeHeight = () => chart.getSize("x_axis_pane", DomPosition.Main)?.height ?? 28;
  const metrics = (): TechnicalPaneMetric[] => {
    if (disposed) return [];
    const keys = ["price", ...(options.indicators.volume ? ["legacy:volume"] : []), ...paneOrder];
    let top = 0;
    return keys.map((key) => {
      const id = key === "legacy:volume" ? "volume_pane" : nativeId(key);
      const size = chart.getSize(id, DomPosition.Main),
        fallback = top;
      const dom = chart.getDom(id, DomPosition.Main);
      const y = dom
        ? dom.getBoundingClientRect().top - options.container.getBoundingClientRect().top
        : fallback;
      const value = { key, top: y, height: size?.height ?? 0, width: size?.width ?? 0 };
      top = fallback + value.height + 1;
      return value;
    });
  };
  const changed = () => {
    if (disposed || !alive()) return;
    const next = metrics(),
      signature = JSON.stringify(next);
    if (signature !== lastMetrics) {
      lastMetrics = signature;
      options.onTechnicalPaneMetrics?.(next);
    }
  };
  const apply = () => {
    if (disposed || !alive() || applying || events?.dragging()) return;
    if (!paneOrder.length) {
      restoreLegacy();
      return;
    }
    applying = true;
    try {
      const targets = technicalPaneGeometry(
        options.container.clientHeight,
        groups,
        options.indicators.volume ? { heightRatio: legacyRatio() } : null,
        timeHeight()
      );
      for (const target of targets) {
        if (target.key === "price") continue;
        const id = target.key === "legacy:volume" ? "volume_pane" : nativeId(target.key);
        if (Math.abs(height(id) - target.height) >= 1)
          chart.setPaneOptions({ id, height: target.height, minHeight: 30 });
      }
    } finally {
      applying = false;
    }
  };
  function listen() {
    if (
      events ||
      disposed ||
      (!options.onTechnicalPaneLayout && !options.onTechnicalPaneMetrics && !paneOrder.length)
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
  }
  const remove = (id: string, entry: Entry) => {
    entry.context.disposed = true;
    entry.context.rows = [];
    entry.context.levels = [];
    chart.removeIndicator(entry.paneId, entry.name);
    entries.delete(id);
  };
  function descriptor(
    id: string,
    outputs: readonly TechnicalRenderOutput[],
    context: Context
  ): IndicatorCreate<Row> {
    let slot = slots.get(id);
    if (slot === undefined) {
      const used = new Set(slots.values());
      slot = 0;
      while (used.has(slot)) slot++;
      slots.set(id, slot);
    }
    const visible = outputs.filter((output) => output.style.visible);
    const lines = visible
      .filter((output) => output.kind === "line")
      .map((output) => ({
        color: lineColor(output.style.color, output.style.opacity),
        size: output.style.width,
        style: output.style.lineStyle === "solid" ? LineType.Solid : LineType.Dashed,
        dashedValue: output.style.lineStyle === "dotted" ? [2, 3] : [6, 4],
        smooth: false
      }));
    const bars = visible
      .filter((output) => output.kind === "histogram")
      .map((output) => ({
        upColor: lineColor(output.style.color, output.style.opacity),
        downColor: lineColor(output.style.color, output.style.opacity),
        noChangeColor: lineColor(output.style.color, output.style.opacity),
        style: PolygonType.Fill,
        borderSize: 0,
        borderStyle: LineType.Solid,
        borderDashedValue: []
      }));
    return {
      name: registerSlot(slot),
      shortName: "",
      precision: 6,
      series: outputs[0]?.paneKey === "price" ? IndicatorSeries.Price : IndicatorSeries.Normal,
      zLevel: 10 + (outputs[0]?.order ?? 0),
      extendData: { context },
      figures: visible.map((output) => ({
        key: output.outputId,
        title: "",
        type: output.kind === "histogram" ? "bar" : "line",
        ...(output.kind === "histogram" ? { baseValue: 0 } : {})
      })),
      styles: { lines, bars },
      visible: visible.length > 0
    };
  }
  function reconcile() {
    if (disposed || !alive()) return;
    const compiled = calculation.compile(instances, layout);
    groups = compiled.groups;
    const nextOrder = groups.filter((group) => group.key !== "price").map((group) => group.key);
    const active = new Set(compiled.outputs.map((output) => output.instanceId));
    for (const [id, entry] of entries)
      if (!active.has(id)) {
        remove(id, entry);
        slots.delete(id);
      }
    if (nextOrder.join("\0") !== paneOrder.join("\0"))
      for (const [id, entry] of entries) if (entry.paneId !== "candle_pane") remove(id, entry);
    paneOrder = nextOrder;
    const decorated = new Set<string>();
    for (const group of groups)
      for (const instance of group.instances) {
        const outputs = compiled.outputs.filter((output) => output.instanceId === instance.id);
        const paneId = nativeId(group.key);
        let entry = entries.get(instance.id);
        if (entry && entry.paneId !== paneId) {
          remove(instance.id, entry);
          entry = undefined;
        }
        const context: Context = entry?.context ?? { rows: [], levels: [], disposed: false };
        context.rows = (outputs[0]?.timestamps ?? []).map((_timestamp, index) =>
          Object.fromEntries(
            outputs.map((output) => [output.outputId, output.values[index] ?? undefined])
          )
        );
        context.levels = [
          ...new Set(outputs.flatMap((output) => (output.style.visible ? output.levels : [])))
        ].filter((level) => {
          const key = `${group.key}:${level}`;
          if (decorated.has(key)) return false;
          decorated.add(key);
          return true;
        });
        const value = descriptor(instance.id, outputs, context);
        if (!entry) {
          chart.createIndicator(value, true, {
            id: paneId,
            height: 80,
            minHeight: 30,
            dragEnabled: true
          });
          entry = { name: value.name, paneId, context };
          entries.set(instance.id, entry);
        } else chart.overrideIndicator(value, paneId);
      }
    refreshCanvases();
    listen();
    for (const key of paneOrder) {
      const dom = chart.getDom(nativeId(key));
      if (dom) events?.observe(dom);
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
    apply,
    metrics,
    timeAxisTop: () => {
      if (disposed) return 0;
      const dom = chart.getDom("x_axis_pane", DomPosition.Main);
      return dom
        ? dom.getBoundingClientRect().top - options.container.getBoundingClientRect().top
        : options.container.clientHeight - timeHeight();
    },
    dispose() {
      disposed = true;
      events?.dispose();
      calculation.dispose();
      for (const [id, entry] of entries) remove(id, entry);
      instances = [];
      layout = [];
      groups = [];
      paneOrder = [];
      slots.clear();
    }
  };
}
