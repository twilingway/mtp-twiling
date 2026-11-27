import type { ChartAdapter } from "../../charts/adapter.js";

class ChartAdapterReadySignal {
  private version = 0;
  private readonly listeners = new Set<() => void>();
  getSnapshot = (): number => this.version;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  publish = (): void => {
    this.version++;
    for (const listener of this.listeners) listener();
  };
}

const signals = new WeakMap<object, ChartAdapterReadySignal>();
/** Adapter lifecycle boundaries are independent from portable chart revisions and market ticks. */
export function chartAdapterReadySignal(controller: object): ChartAdapterReadySignal {
  let signal = signals.get(controller);
  if (!signal) {
    signal = new ChartAdapterReadySignal();
    signals.set(controller, signal);
  }
  return signal;
}
/** SDK layout can settle after setData. Retry only at lifecycle/data readiness boundaries. */
export function observeChartAdapterReady(
  controller: object,
  adapter: () => ChartAdapter | null,
  valid: () => boolean
) {
  const signal = chartAdapterReadySignal(controller);
  let frame = 0,
    attempts = 0,
    ready = false,
    stopped = false;
  const cancel = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const publish = (next: boolean) => {
    if (ready === next) return;
    ready = next;
    signal.publish();
  };
  const probe = () => {
    frame = 0;
    if (stopped || !valid()) return;
    const chart = adapter();
    if (!chart || chart.retired || chart.persistView === false) {
      publish(false);
      return;
    }
    if (chart.getView()) {
      publish(true);
      return;
    }
    publish(false);
    if (attempts++ < 120) frame = requestAnimationFrame(probe);
  };
  return {
    check: () => {
      if (stopped) return;
      cancel();
      attempts = 0;
      probe();
    },
    stop: () => {
      stopped = true;
      cancel();
      publish(false);
    }
  };
}
