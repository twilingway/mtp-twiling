import { ActionType, DomPosition, registerYAxis } from "klinecharts";
import type { Chart } from "klinecharts";
import type { Candle } from "../model/types.js";
import type { TechnicalIndicatorInstance } from "../model/technical-indicators/types.js";
import type {
  TechnicalIndicatorGroup,
  TechnicalPanePreference
} from "../model/technical-indicator-layout.js";
import type { ChartOptions, TechnicalPaneMetric, TechnicalSupplementalInputs } from "./adapter.js";
import { TechnicalRenderData } from "./technical-render-data.js";
import { hasVisibleAverage, technicalCalculationContext } from "./technical-calculation-context.js";
import { captureTechnicalPaneLayout } from "./technical-pane-geometry.js";
import { klinePaneGeometry } from "./kline-pane-geometry.js";
import { attachTechnicalPaneEvents } from "./technical-pane-events.js";
import { klineCompactCrosshair } from "./technical-compact-crosshair.js";
import { klineNativeMembers } from "./kline-native-members.js";
import { klineCalendarRegions } from "./kline-calendar-regions.js";

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
interface Settlement {
  active: boolean;
  revision: number;
  schedule: () => void;
}
/** Native promises may outlive a removed pane or owner; retain only weak settlement metadata. */
function nativeSettled(weak: WeakRef<Settlement>, revision: number): () => void {
  return () => {
    const target = weak.deref();
    if (target?.active && target.revision === revision) target.schedule();
  };
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
  const calculation = new TechnicalRenderData(
    technicalCalculationContext(options.timeframe, options.row)
  );
  const calendar = klineCalendarRegions(chart, options, alive);
  let groups: TechnicalIndicatorGroup[] = [],
    paneOrder: string[] = [];
  let instances: readonly TechnicalIndicatorInstance[] = [],
    layout: readonly TechnicalPanePreference[] = [];
  let disposed = false,
    lastMetrics = "",
    applying = false,
    settlementFrame = 0,
    viewportFrame = 0;
  const members = klineNativeMembers(chart, () => !disposed && alive(), technicalAxis);
  const settlement: Settlement = {
    active: true,
    revision: 0,
    schedule: () => {
      if (disposed || !alive() || settlementFrame) return;
      settlementFrame = requestAnimationFrame(() => {
        if (disposed || !alive()) return;
        apply();
        refreshCanvases();
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
  const crosshair = klineCompactCrosshair(
    chart,
    options.container,
    metrics,
    alive,
    ActionType?.OnCrosshairChange,
    DomPosition.YAxis
  );
  const changed = () => {
    if (disposed || !alive()) return;
    const next = metrics(),
      signature = JSON.stringify(next);
    crosshair.refresh(next);
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
        const next = captureTechnicalPaneLayout(layout, before, after);
        if (next) {
          layout = next.layout;
          groups = calculation.compile(instances, layout).groups;
          options.onTechnicalPaneLayout?.(next.layout, next.context);
        }
      }
    });
  }
  const readViewport = () => {
    const range = chart.getVisibleRange?.();
    return calculation.setVisibleBars(range?.from ?? Infinity, (range?.to ?? -Infinity) - 1);
  };
  const onViewportChange = () => {
    if (disposed || !alive() || viewportFrame || !hasVisibleAverage(instances)) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (!disposed && alive() && hasVisibleAverage(instances) && readViewport()) reconcile();
    });
  };
  if (ActionType?.OnVisibleRangeChange)
    chart.subscribeAction?.(ActionType.OnVisibleRangeChange, onViewportChange);
  function reconcile() {
    if (disposed || !alive()) return;
    if (hasVisibleAverage(instances)) readViewport();
    const complete = nativeSettled(weakSettlement, ++settlement.revision);
    const compiled = calculation.compile(instances, layout);
    calendar.update(compiled.priceRegions);
    groups = compiled.groups;
    const nextOrder = groups.filter((group) => group.key !== "price").map((group) => group.key);
    const resetLower = nextOrder.join("\0") !== paneOrder.join("\0");
    paneOrder = nextOrder;
    members.update(compiled, complete, resetLower);
    refreshCanvases();
    listen();
    for (const key of paneOrder) {
      const dom = chart.getDom(nativeId(key));
      if (dom) events?.observe(dom);
    }
    apply();
    settlement.schedule();
  }
  return {
    updateInputs(inputs: TechnicalSupplementalInputs) {
      if (!disposed && alive() && calculation.setSupplementalInputs(inputs, options.row.uid))
        reconcile();
    },
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
    refreshNativeMetadata: members.refreshNativeMetadata,
    apply,
    metrics,
    timeAxisTop: () => {
      if (disposed) return 0;
      const dom = chart.getDom("x_axis_pane", DomPosition.Main);
      return dom
        ? dom.getBoundingClientRect().top - options.container.getBoundingClientRect().top
        : options.container.clientHeight - 28;
    },
    dispose() {
      calendar.dispose();
      crosshair.dispose();
      disposed = true;
      if (ActionType?.OnVisibleRangeChange)
        chart.unsubscribeAction?.(ActionType.OnVisibleRangeChange, onViewportChange);
      if (viewportFrame) cancelAnimationFrame(viewportFrame);
      settlement.active = false;
      settlement.schedule = () => {};
      if (settlementFrame) cancelAnimationFrame(settlementFrame);
      events?.dispose();
      calculation.dispose();
      members.dispose();
      instances = [];
      layout = [];
      groups = [];
      paneOrder = [];
    }
  };
}
