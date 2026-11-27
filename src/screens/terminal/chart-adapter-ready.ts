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
