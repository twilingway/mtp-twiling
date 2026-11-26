import type { DrawingPoint } from "../../model/types.js";

type Selection =
  | { phase: "idle" | "armed" }
  | { phase: "tracking"; from: DrawingPoint; to: DrawingPoint | null }
  | { phase: "result"; from: DrawingPoint; to: DrawingPoint };

const idle = { phase: "idle" } as const;

class ChartMeasurementSession {
  private current: Selection = idle;
  private listeners = new Set<() => void>();
  get = (): Selection => this.current;
  isActive = (): boolean => this.current.phase !== "idle";
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(next: Selection): void {
    if (next === this.current) return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }
  dismiss = (): void => this.update(idle);
  toggle = (): void => this.update(this.isActive() ? idle : { phase: "armed" });
  select(point: DrawingPoint): void {
    const current = this.current;
    this.update(
      current.phase === "tracking"
        ? { phase: "result", from: current.from, to: point }
        : { phase: "tracking", from: point, to: null }
    );
  }
  preview(point: DrawingPoint): void {
    const current = this.current;
    if (
      current.phase === "tracking" &&
      (current.to?.timestamp !== point.timestamp || current.to.value !== point.value)
    )
      this.update({ ...current, to: point });
  }
}

const sessions = new WeakMap<object, ChartMeasurementSession>();
export function chartMeasurement(controller: object): ChartMeasurementSession {
  let session = sessions.get(controller);
  if (!session) {
    session = new ChartMeasurementSession();
    sessions.set(controller, session);
  }
  return session;
}
