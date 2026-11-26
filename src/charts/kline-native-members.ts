import { ActionType, IndicatorSeries, LineType, PolygonType, registerIndicator } from "klinecharts";
import type { Chart, IndicatorCreate, IndicatorFigureStylesCallbackData } from "klinecharts";
import type { TechnicalRenderData, TechnicalRenderOutput } from "./technical-render-data.js";
import type { PlotPrecisionPolicy } from "../model/technical-indicators/presentation-types.js";
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
import {
  eligiblePublicPlots,
  klineNativeDomain,
  neutralKlinePrecision
} from "./kline-native-domain.js";

type Compiled = ReturnType<TechnicalRenderData["compile"]>;
interface Plan {
  id: string;
  slot: number;
  paneId: string;
  policy: PlotPrecisionPolicy;
  outputs: readonly TechnicalRenderOutput[];
  context: Context;
}
interface Entry {
  plan: Plan;
  active: boolean;
  name: string;
  fillName?: string;
  precision: number;
}
interface Completion {
  active: boolean;
  epoch: number;
  notify: () => void;
}
interface PendingUpdate {
  compiled: Compiled;
  notify: () => void;
  resetLower: boolean;
}
function memberSettled(weak: WeakRef<Completion>, epoch: number) {
  return () => {
    const current = weak.deref();
    if (current?.active && current.epoch === epoch) current.notify();
  };
}
const registered = new Set<string>();
function family(slot: number, policy: PlotPrecisionPolicy, fill: boolean, active: boolean): string {
  if (slot >= 100) throw new RangeError("Too many native TA slots");
  const price = active && policy === "native-price";
  const name = `PERSONAL_TA_${fill ? "FILL_" : ""}${active ? (price ? "PRICE_" : "") : "IDLE_"}${slot}`;
  if (!registered.has(name)) {
    registered.add(name);
    registerIndicator<Row>({
      name,
      shortName: "",
      series: price ? IndicatorSeries.Price : IndicatorSeries.Normal,
      figures: [],
      calc: (_bars, indicator) => {
        const context = klineTechnicalContext(indicator);
        return active && !fill && context && !context.disposed ? context.rows : [];
      },
      draw: fill ? drawKlineTechnicalFills : drawKlineTechnical
    });
  }
  return name;
}
function primary(plan: Plan, active: boolean, precision: number): IndicatorCreate<Row> {
  const { outputs, context, policy } = plan;
  const visible = active ? outputs.filter((output) => output.style.visible) : [];
  return {
    name: family(plan.slot, policy, false, active),
    shortName: "",
    ...(!active || policy !== "native-price" ? { precision } : {}),
    series:
      active && (policy === "native-price" || plan.paneId === "candle_pane")
        ? IndicatorSeries.Price
        : IndicatorSeries.Normal,
    zLevel: 10 + (outputs[0]?.order ?? 0),
    extendData: { context },
    figures: [
      ...(active && context.columnsBase ? [klineColumnsBaseFigure(context.columnsBase)] : []),
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
    styles: {
      lines: visible
        .filter((o) => o.kind === "line")
        .map((output) => ({
          color: lineColor(output.style.color, output.style.opacity),
          size: output.style.width,
          style: output.style.lineStyle === "solid" ? LineType.Solid : LineType.Dashed,
          dashedValue: output.style.lineStyle === "dotted" ? [2, 3] : [6, 4],
          smooth: false
        })),
      bars: visible
        .filter((o) => o.kind === "histogram")
        .map((output) => ({
          upColor: lineColor(output.style.color, output.style.opacity),
          downColor: lineColor(output.style.color, output.style.opacity),
          noChangeColor: lineColor(output.style.color, output.style.opacity),
          style: PolygonType.Fill,
          borderSize: 0,
          borderStyle: LineType.Solid,
          borderDashedValue: []
        }))
    },
    // Data-free primary still paints declared reference levels through the existing domain.
    visible: active ? visible.length > 0 : context.levels.length > 0
  };
}
function companion(plan: Plan, active: boolean, precision: number): IndicatorCreate<Row> {
  return {
    name: family(plan.slot, plan.policy, true, active),
    shortName: "",
    figures: [],
    ...(!active || plan.policy !== "native-price" ? { precision } : {}),
    series:
      active && (plan.policy === "native-price" || plan.paneId === "candle_pane")
        ? IndicatorSeries.Price
        : IndicatorSeries.Normal,
    zLevel: -3 - (plan.outputs[0]?.order ?? 0),
    extendData: { context: plan.context },
    visible: plan.context.fills.some((fill) => fill.visible)
  };
}

/** Owns native members only; formulas, full rows and persisted layout stay with update(). */
export function klineNativeMembers(chart: Chart, alive: () => boolean, axisName: () => string) {
  const entries = new Map<string, Entry>(),
    slots = new Map<string, number>();
  let plans: Plan[] = [],
    writing = false,
    frame = 0,
    listening = false;
  let pendingUpdate: PendingUpdate | undefined;
  const staged = new Set<Entry>();
  const eligibility = new WeakMap<Plan, { first: number; end: number; value: boolean }>();
  const state: Completion = { active: true, epoch: 0, notify() {} };
  const weak = new WeakRef(state);
  const live = () => state.active && alive();
  const completion = () => memberSettled(weak, state.epoch);
  function removeNative(entry: Entry, clear = true) {
    entry.plan.context.disposed = true;
    if (clear) {
      entry.plan.context.rows = [];
      entry.plan.context.levels = [];
      entry.plan.context.outputs = [];
      entry.plan.context.fills = [];
      entry.plan.context.columnsBase = null;
    }
    if (entry.fillName) chart.removeIndicator(entry.plan.paneId, entry.fillName);
    chart.removeIndicator(entry.plan.paneId, entry.name);
  }
  function retire(id: string, entry: Entry) {
    removeNative(entry);
    entries.delete(id);
  }
  function install(plan: Plan, active: boolean, precision: number, force: boolean): boolean {
    const old = entries.get(plan.id);
    const replace =
      !old ||
      old.active !== active ||
      old.plan.paneId !== plan.paneId ||
      (active && old.plan.policy !== plan.policy);
    if (replace && old) {
      // Separate lifecycle tokens without rebuilding or mutating any numeric row/array.
      old.plan = { ...old.plan };
      plan.context = { ...plan.context, disposed: false };
      old.plan.context.disposed = true;
    }
    const value = primary(plan, active, precision),
      fill = plan.context.fills.length ? companion(plan, active, precision) : null;
    if (replace) {
      const exists = chart.getDom(plan.paneId) !== null;
      const next: Entry = {
        plan,
        active,
        name: value.name,
        ...(fill ? { fillName: fill.name } : {}),
        precision
      };
      staged.add(next);
      try {
        chart.createIndicator(
          value,
          true,
          {
            id: plan.paneId,
            ...(!exists && plan.paneId !== "candle_pane"
              ? { height: 80, minHeight: 30, dragEnabled: true, axisOptions: { name: axisName() } }
              : {})
          },
          completion()
        );
        if (!live()) return false;
        if (fill) chart.createIndicator(fill, true, { id: plan.paneId }, completion());
        if (!live()) return false;
        // New members are synchronously inserted by addInstance before its calc promise resolves.
        // Never remove the final native pane member during an active/idle role transition.
        if (old) removeNative(old, false);
        if (!live()) return false;
        entries.set(plan.id, next);
        return true;
      } finally {
        staged.delete(next);
      }
    }
    if (!old) return false;
    old.plan = plan;
    let changed = false;
    if (force) {
      chart.overrideIndicator(value, plan.paneId, completion());
      if (!live()) return false;
      changed = true;
    } else if (!active && old.precision !== precision) {
      chart.overrideIndicator({ name: old.name, precision }, plan.paneId, completion());
      if (!live()) return false;
      changed = true;
    }
    if (fill) {
      if (!old.fillName) {
        chart.createIndicator(fill, true, { id: plan.paneId }, completion());
        old.fillName = fill.name;
        changed = true;
      } else if (force || (!active && old.precision !== precision)) {
        chart.overrideIndicator(
          force ? fill : { name: old.fillName, precision },
          plan.paneId,
          completion()
        );
        changed = true;
      }
    } else if (old.fillName) {
      chart.removeIndicator(plan.paneId, old.fillName);
      delete old.fillName;
      changed = true;
    }
    old.precision = precision;
    return changed;
  }
  function refresh(force = false): void {
    if (!live() || writing) return;
    writing = true;
    try {
      const epoch = state.epoch,
        domain = klineNativeDomain(chart),
        owned = new Set(
          [...entries.values()].flatMap((e) => [e.name, ...(e.fillName ? [e.fillName] : [])])
        ),
        precisions = new Map<string, number>();
      const active = new Map<Plan, boolean>();
      for (const plan of plans) {
        const cached = eligibility.get(plan);
        const value =
          !domain ||
          (cached?.first === domain.first && cached.end === domain.end
            ? cached.value
            : eligiblePublicPlots(plan.outputs, domain));
        if (domain) eligibility.set(plan, { first: domain.first, end: domain.end, value });
        active.set(plan, value);
      }
      const activePlans = plans.filter((plan) => active.get(plan));
      if (domain)
        for (const plan of plans)
          if (!precisions.has(plan.paneId))
            precisions.set(
              plan.paneId,
              neutralKlinePrecision(chart, plan.paneId, domain, activePlans, owned)
            );
      for (const plan of plans) {
        if (!live() || epoch !== state.epoch) break;
        const eligible = active.get(plan) ?? true;
        install(plan, eligible, eligible ? 6 : (precisions.get(plan.paneId) ?? 0), force);
      }
    } finally {
      writing = false;
    }
    const pending = pendingUpdate;
    pendingUpdate = undefined;
    if (live() && pending) update(pending.compiled, pending.notify, pending.resetLower);
  }
  const queued = () => {
    if (!live() || frame || writing) return;
    const epoch = state.epoch;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (live() && epoch === state.epoch) refresh();
    });
  };
  function listen() {
    if (
      listening ||
      !klineNativeDomain(chart) ||
      !ActionType ||
      typeof chart.subscribeAction !== "function"
    )
      return;
    listening = true;
    chart.subscribeAction(ActionType.OnVisibleRangeChange, queued);
    chart.subscribeAction(ActionType.OnDataReady, queued);
  }
  function update(compiled: Compiled, notify: () => void, resetLower: boolean) {
    if (!live()) return;
    if (writing) {
      pendingUpdate = {
        compiled,
        notify,
        resetLower: resetLower || (pendingUpdate?.resetLower ?? false)
      };
      state.epoch++;
      return;
    }
    state.epoch++;
    state.notify = notify;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const active = new Set(compiled.outputs.map((output) => output.instanceId));
    for (const [id, entry] of entries)
      if (!active.has(id) || (resetLower && entry.plan.paneId !== "candle_pane")) retire(id, entry);
    for (const id of slots.keys()) if (!active.has(id)) slots.delete(id);
    const decorated = new Set<string>();
    plans = [];
    for (const group of compiled.groups)
      for (const instance of group.instances) {
        const outputs = compiled.outputs.filter((output) => output.instanceId === instance.id);
        if (!outputs.length) continue;
        let slot = slots.get(instance.id);
        if (slot === undefined) {
          const used = new Set(slots.values());
          slot = 0;
          while (used.has(slot)) slot++;
          if (slot >= 100) throw new RangeError("Too many native TA slots");
          slots.set(instance.id, slot);
        }
        const context: Context = entries.get(instance.id)?.plan.context ?? {
          rows: [],
          levels: [],
          outputs: [],
          fills: [],
          columnsBase: null,
          disposed: false
        };
        context.outputs = outputs;
        context.fills = compiled.fills.filter((fill) => fill.instanceId === instance.id);
        context.columnsBase = klineColumnsBase(outputs);
        context.rows = outputs[0]!.timestamps.map((_timestamp, index) => {
          const row = Object.assign(
            Object.fromEntries(
              outputs.map((output) => [output.outputId, output.values[index] ?? undefined])
            ),
            { [klineTechnicalIndex]: index }
          );
          const base = context.columnsBase;
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
        plans.push({
          id: instance.id,
          slot,
          paneId: group.key === "price" ? "candle_pane" : `technical:${group.key.slice(5)}`,
          policy: outputs[0]?.presentation?.precisionPolicy ?? "legacy-fixed-6",
          outputs,
          context
        });
      }
    listen();
    refresh(true);
  }
  return {
    refreshNativeMetadata: () => refresh(),
    update,
    dispose() {
      if (!state.active) return;
      state.active = false;
      state.epoch++;
      state.notify = () => {};
      pendingUpdate = undefined;
      if (frame) cancelAnimationFrame(frame);
      if (listening) {
        chart.unsubscribeAction(ActionType.OnVisibleRangeChange, queued);
        chart.unsubscribeAction(ActionType.OnDataReady, queued);
      }
      for (const entry of entries.values()) removeNative(entry);
      for (const entry of staged) removeNative(entry);
      entries.clear();
      slots.clear();
      plans = [];
    }
  };
}
