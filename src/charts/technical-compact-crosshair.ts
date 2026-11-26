import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";
import type { Chart, ActionType, DomPosition } from "klinecharts";
import type { TechnicalPaneMetric } from "./adapter.js";

interface Hover {
  key?: string | undefined;
  y?: number | undefined;
  clientY?: number | undefined;
}
interface Bridge<T> {
  capture: () => T;
  suppress: (saved: T) => void;
  restore: (saved: T) => void;
  subscribe: (hover: (event: Hover) => void) => () => void;
}
const noop = (): { refresh(metrics?: readonly TechnicalPaneMetric[]): void; dispose(): void } => ({
  refresh() {},
  dispose() {}
});

/** One owned native subscription. Geometry is read on hover/settlement, never polled per frame. */
export function compactTechnicalCrosshair<T>(
  container: HTMLElement,
  metrics: () => readonly TechnicalPaneMetric[],
  alive: () => boolean,
  bridge: Bridge<T>
) {
  let disposed = false,
    writing = false,
    saved: { value: T } | null = null;
  let clientY: number | null = null,
    chartY: number | null = null;
  let nativeKey: string | undefined;
  const write = (action: () => void) => {
    writing = true;
    try {
      action();
    } finally {
      writing = false;
    }
  };
  const refresh = (measured?: readonly TechnicalPaneMetric[]) => {
    if (disposed || writing || !alive()) return;
    const panes = measured ?? metrics();
    const y = clientY === null ? chartY : clientY - container.getBoundingClientRect().top;
    const pane =
      y === null
        ? panes.find((p) => p.key === nativeKey)
        : panes.find((p) => y >= p.top && y < p.top + p.height);
    const compact = !!pane?.key.startsWith("pane:") && pane.height > 0 && pane.height <= 30;
    if (compact && !saved) {
      const value = bridge.capture();
      saved = { value }; // Own state BEFORE native applyOptions/setStyles can re-enter.
      write(() => bridge.suppress(value));
    } else if (!compact && saved) {
      const value = saved.value;
      saved = null;
      write(() => bridge.restore(value));
    }
  };
  const leave = () => {
    if (disposed || writing || !alive()) return;
    clientY = chartY = null;
    nativeKey = undefined;
    refresh([]);
  };
  const unsubscribe = bridge.subscribe((event) => {
    if (disposed || writing || !alive()) return;
    if (!event.key) {
      leave();
      return;
    }
    const panes = metrics(),
      pane = panes.find((p) => p.key === event.key);
    if (!pane) {
      leave();
      return;
    }
    nativeKey = event.key;
    if (Number.isFinite(event.clientY)) clientY = event.clientY!;
    if (clientY === null) chartY = Number.isFinite(event.y) ? pane.top + event.y! : null;
    refresh(panes);
  });
  const move = (event: PointerEvent) => {
    if (disposed || writing || !alive() || !Number.isFinite(event.clientY)) return;
    const bounds = container.getBoundingClientRect(),
      panes = metrics();
    if (event.clientX < bounds.left || event.clientX >= bounds.left + (panes[0]?.width ?? 0)) {
      leave();
      return;
    }
    clientY = event.clientY;
    refresh(panes);
  };
  container.addEventListener("pointermove", move, true);
  container.addEventListener("pointerleave", leave);
  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      container.removeEventListener("pointermove", move, true);
      container.removeEventListener("pointerleave", leave);
      const state = saved;
      saved = null;
      if (state && alive()) write(() => bridge.restore(state.value));
    }
  };
}

export function lightweightCompactCrosshair(
  chart: IChartApi,
  container: HTMLElement,
  metrics: () => readonly TechnicalPaneMetric[],
  alive: () => boolean,
  keyForIndex: (index: number) => string | undefined
) {
  // Legacy controlled adapter fixtures expose only their used SDK surface.
  if (
    typeof chart.options !== "function" ||
    typeof chart.applyOptions !== "function" ||
    typeof chart.subscribeCrosshairMove !== "function" ||
    typeof chart.unsubscribeCrosshairMove !== "function"
  )
    return noop();
  return compactTechnicalCrosshair(container, metrics, alive, {
    capture() {
      const options = chart.options();
      const axes = (["left", "right"] as const)
        .filter((side) => options[`${side}PriceScale`].visible)
        .map((side) => {
          const minimum = options[`${side}PriceScale`].minimumWidth;
          return { side, minimum, held: Math.max(minimum, chart.priceScale(side).width()) };
        });
      return { label: options.crosshair.horzLine.labelVisible, axes };
    },
    suppress(saved) {
      chart.applyOptions({
        crosshair: { horzLine: { labelVisible: false } },
        ...Object.fromEntries(
          saved.axes.map((a) => [`${a.side}PriceScale`, { minimumWidth: a.held }])
        )
      });
    },
    restore(saved) {
      const current = chart.options();
      chart.applyOptions({
        crosshair: {
          horzLine: { labelVisible: current.crosshair.horzLine.labelVisible || saved.label }
        },
        ...Object.fromEntries(
          saved.axes
            .filter((a) => current[`${a.side}PriceScale`].minimumWidth === a.held)
            .map((a) => [`${a.side}PriceScale`, { minimumWidth: a.minimum }])
        )
      });
    },
    subscribe(hover) {
      const listener = (event: MouseEventParams<Time>) =>
        hover({
          key: event.paneIndex === undefined ? undefined : keyForIndex(event.paneIndex),
          y: event.point?.y,
          clientY: event.sourceEvent?.clientY
        });
      chart.subscribeCrosshairMove(listener);
      return () => chart.unsubscribeCrosshairMove(listener);
    }
  });
}

export function klineCompactCrosshair(
  chart: Chart,
  container: HTMLElement,
  metrics: () => readonly TechnicalPaneMetric[],
  alive: () => boolean,
  action: ActionType | undefined,
  axisPosition: DomPosition
) {
  if (
    action === undefined ||
    typeof chart.getStyles !== "function" ||
    !chart.getStyles().crosshair ||
    typeof chart.subscribeAction !== "function" ||
    typeof chart.unsubscribeAction !== "function"
  )
    return noop();
  return compactTechnicalCrosshair(container, metrics, alive, {
    capture() {
      const styles = chart.getStyles(),
        size = styles.yAxis.size;
      const width = chart.getSize("candle_pane", axisPosition)?.width;
      return {
        label: styles.crosshair.horizontal.text.show,
        size,
        held: size === "auto" && width !== undefined && width > 0 ? width : null
      };
    },
    suppress(saved) {
      chart.setStyles({
        crosshair: { horizontal: { text: { show: false } } },
        ...(saved.held === null ? {} : { yAxis: { size: saved.held } })
      });
    },
    restore(saved) {
      const current = chart.getStyles();
      chart.setStyles({
        crosshair: {
          horizontal: { text: { show: current.crosshair.horizontal.text.show || saved.label } }
        },
        ...(saved.held !== null && current.yAxis.size === saved.held
          ? { yAxis: { size: saved.size } }
          : {})
      });
    },
    subscribe(hover) {
      const listener = (value: unknown) => {
        const event =
          value && typeof value === "object" ? (value as { paneId?: unknown; y?: unknown }) : {};
        const id = typeof event.paneId === "string" ? event.paneId : undefined;
        hover({
          key: id?.startsWith("technical:")
            ? `pane:${id.slice(10)}`
            : id === "candle_pane"
              ? "price"
              : id === "volume_pane"
                ? "legacy:volume"
                : undefined,
          y: typeof event.y === "number" ? event.y : undefined
        });
      };
      chart.subscribeAction(action, listener);
      return () => chart.unsubscribeAction(action, listener);
    }
  });
}
