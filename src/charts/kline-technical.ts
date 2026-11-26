import {
  DomPosition,
  IndicatorSeries,
  LineType,
  PolygonType,
  registerIndicator,
  registerYAxis
} from "klinecharts";
import type { Chart, IndicatorCreate, IndicatorFigureStylesCallbackData } from "klinecharts";
import type { Candle } from "../model/types.js";
import type { TechnicalIndicatorInstance } from "../model/technical-indicators/types.js";
import type { PlotPrecisionPolicy } from "../model/technical-indicators/presentation-types.js";
import type {
  TechnicalIndicatorGroup,
  TechnicalPanePreference
} from "../model/technical-indicator-layout.js";
import type { ChartOptions, TechnicalPaneMetric } from "./adapter.js";
import { TechnicalRenderData } from "./technical-render-data.js";
import { technicalCalculationContext } from "./technical-calculation-context.js";
import type { TechnicalRenderOutput } from "./technical-render-data.js";
import { capturedTechnicalLayout } from "./technical-pane-geometry.js";
import { klinePaneGeometry } from "./kline-pane-geometry.js";
import { attachTechnicalPaneEvents } from "./technical-pane-events.js";
import { lineColor } from "../model/candle-palette.js";
import {
  drawKlineTechnical,
  drawKlineTechnicalFills,
  klineTechnicalContext,
  klineTechnicalIndex,
  klineTechnicalColor,
  klineColumnsBase,
  klineColumnsBaseFigure
} from "./kline-technical-geometry.js";
import type {
  KlineTechnicalContext as Context,
  KlineTechnicalRow as Row
} from "./kline-technical-geometry.js";

const COMPACT_AXIS = "PERSONAL_TA_COMPACT_AXIS";
let compactAxisRegistered = false;
function technicalAxis(): string {
  if (!compactAxisRegistered) {
    registerYAxis({
      name: COMPACT_AXIS,
      createTicks: ({ bounding, defaultTicks }) => (bounding.height <= 30 ? [] : defaultTicks)
    });
    compactAxisRegistered = true;
  }
  return COMPACT_AXIS;
}

interface Entry {
  name: string;
  paneId: string;
  context: Context;
  policy: PlotPrecisionPolicy;
  fillName?: string;
}
interface Settlement {
  active: boolean;
  revision: number;
  schedule: () => void;
}
/** Native promises may outlive a removed pane or owner; never retain its chart in their callback. */
function nativeSettled(weak: WeakRef<Settlement>, revision: number): () => void {
  return () => {
    const target = weak.deref();
    if (target?.active && target.revision === revision) target.schedule();
  };
}
const registered = new Set<string>();
/** Four reusable families of at most 100 slots; callbacks retain no chart, owner or dataset. */
function registerSlot(slot: number, policy: PlotPrecisionPolicy, fill = false): string {
  if (slot >= 100) throw new RangeError("Too many native TA slots");
  const nativePrice = policy === "native-price";
  const name = `PERSONAL_TA_${fill ? "FILL_" : ""}${nativePrice ? "PRICE_" : ""}${slot}`;
  if (!registered.has(name)) {
    registered.add(name);
    registerIndicator<Row>({
      name,
      shortName: "",
      series: nativePrice ? IndicatorSeries.Price : IndicatorSeries.Normal,
      figures: [],
      calc: (_bars, indicator) => {
        const context = klineTechnicalContext(indicator);
        return context && !context.disposed && !fill ? context.rows : [];
      },
      draw: fill ? drawKlineTechnicalFills : drawKlineTechnical
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
  refreshCanvases: () => void = () => {},
  onSettled: () => void = () => {}
) {
  const calculation = new TechnicalRenderData(technicalCalculationContext(options.timeframe));
  const entries = new Map<string, Entry>(),
    slots = new Map<string, number>();
  let groups: TechnicalIndicatorGroup[] = [],
    paneOrder: string[] = [];
  let instances: readonly TechnicalIndicatorInstance[] = [],
    layout: readonly TechnicalPanePreference[] = [];
  let disposed = false,
    lastMetrics = "",
    applying = false;
  let settlementFrame = 0;
  const settlement: Settlement = {
    active: true,
    revision: 0,
    schedule: () => {
      if (disposed || !alive() || settlementFrame) return;
      settlementFrame = requestAnimationFrame(() => {
        if (disposed || !alive()) return;
        apply();
        refreshCanvases();
        // Applying a newly measured X-axis height can itself queue another native paint.
        settlementFrame = requestAnimationFrame(() => {
          settlementFrame = 0;
          if (disposed || !alive()) return;
          changed();
          onSettled();
        });
      });
    }
  };
  const weakSettlement = new WeakRef(settlement);
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
      const targets = klinePaneGeometry(
        options.container.clientHeight,
        groups,
        options.indicators.volume ? { heightRatio: legacyRatio() } : null,
        timeHeight()
      );
      for (const target of targets) {
        if (target.key === "price") continue;
        const id = target.key === "legacy:volume" ? "volume_pane" : nativeId(target.key);
        if (Math.abs(height(id) - target.height) > 1e-6)
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
    entry.context.outputs = [];
    entry.context.fills = [];
    entry.context.columnsBase = null;
    if (entry.fillName) chart.removeIndicator(entry.paneId, entry.fillName);
    chart.removeIndicator(entry.paneId, entry.name);
    entries.delete(id);
  };
  function descriptor(
    id: string,
    outputs: readonly TechnicalRenderOutput[],
    context: Context,
    policy: PlotPrecisionPolicy
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
      name: registerSlot(slot, policy),
      shortName: "",
      ...(policy === "native-price" ? {} : { precision: 6 }),
      series:
        policy === "native-price" || outputs[0]?.paneKey === "price"
          ? IndicatorSeries.Price
          : IndicatorSeries.Normal,
      zLevel: 10 + (outputs[0]?.order ?? 0),
      extendData: { context },
      figures: [
        ...(context.columnsBase ? [klineColumnsBaseFigure(context.columnsBase)] : []),
        ...visible.map((output) => ({
          key: output.outputId,
          title: "",
          type: output.kind === "histogram" ? "bar" : "line",
          ...(output.kind === "histogram" ? { baseValue: 0 } : {}),
          ...(output.presentation
            ? {
                styles: (data: IndicatorFigureStylesCallbackData<Row>) => {
                  const index = data.current.indicatorData?.[klineTechnicalIndex];
                  return index === undefined ? {} : { color: klineTechnicalColor(output, index) };
                }
              }
            : {})
        }))
      ],
      styles: { lines, bars },
      visible: visible.length > 0
    };
  }
  function reconcile() {
    if (disposed || !alive()) return;
    const complete = nativeSettled(weakSettlement, ++settlement.revision);
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
        const fills = compiled.fills.filter((fill) => fill.instanceId === instance.id);
        const policy = outputs[0]?.presentation?.precisionPolicy ?? "legacy-fixed-6";
        const paneId = nativeId(group.key);
        let entry = entries.get(instance.id);
        if (entry && (entry.paneId !== paneId || entry.policy !== policy)) {
          remove(instance.id, entry);
          entry = undefined;
        }
        const context: Context = entry?.context ?? {
          rows: [],
          levels: [],
          outputs: [],
          fills: [],
          columnsBase: null,
          disposed: false
        };
        context.outputs = outputs;
        context.fills = fills;
        context.columnsBase = klineColumnsBase(outputs);
        context.rows = (outputs[0]?.timestamps ?? []).map((_timestamp, index) => {
          const row = Object.assign(
              Object.fromEntries(
                outputs.map((output) => [output.outputId, output.values[index] ?? undefined])
              ),
              { [klineTechnicalIndex]: index }
            ),
            base = context.columnsBase;
          if (base && base.plots.some((output) => Number.isFinite(output.values[index])))
            Object.defineProperty(row, base.key, { value: base.value, enumerable: false });
          return row;
        });
        context.levels = [
          ...new Set(outputs.flatMap((output) => (output.style.visible ? output.levels : [])))
        ].filter((level) => {
          const key = `${group.key}:${level}`;
          if (decorated.has(key)) return false;
          decorated.add(key);
          return true;
        });
        const value = descriptor(instance.id, outputs, context, policy);
        if (!entry) {
          // v9.8.12 reapplies these options AFTER async calc when stacking into an existing pane.
          // Only the first instance may establish its height; subsequent ones must preserve it.
          const paneExists = chart.getDom(paneId) !== null;
          chart.createIndicator(
            value,
            true,
            {
              id: paneId,
              ...(!paneExists && group.key !== "price"
                ? {
                    height: 80,
                    minHeight: 30,
                    dragEnabled: true,
                    axisOptions: { name: technicalAxis() }
                  }
                : {})
            },
            complete
          );
          entry = { name: value.name, paneId, context, policy };
          entries.set(instance.id, entry);
        } else chart.overrideIndicator(value, paneId, complete);
        if (fills.length) {
          const fillName = registerSlot(slots.get(instance.id)!, policy, true);
          const fillValue: IndicatorCreate<Row> = {
            name: fillName,
            shortName: "",
            figures: [],
            ...(policy === "native-price" ? {} : { precision: 6 }),
            series:
              policy === "native-price" || group.key === "price"
                ? IndicatorSeries.Price
                : IndicatorSeries.Normal,
            zLevel: -3 - (outputs[0]?.order ?? 0),
            extendData: { context },
            visible: fills.some((fill) => fill.visible)
          };
          if (entry.fillName) chart.overrideIndicator(fillValue, paneId, complete);
          else {
            chart.createIndicator(fillValue, true, { id: paneId }, complete);
            entry.fillName = fillName;
          }
        } else if (entry.fillName) {
          chart.removeIndicator(paneId, entry.fillName);
          delete entry.fillName;
        }
      }
    refreshCanvases();
    listen();
    for (const key of paneOrder) {
      const dom = chart.getDom(nativeId(key));
      if (dom) events?.observe(dom);
    }
    apply();
    // Native calc uses promises even for synchronous common-core arrays. Its completion also
    // queues DOM/canvas paint; emit coherent DOM bounds only from the following native frame.
    settlement.schedule();
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
      settlement.active = false;
      settlement.schedule = () => {};
      if (settlementFrame) cancelAnimationFrame(settlementFrame);
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
