import type { ChartView } from "../model/types.js";
import type { ChartAdapter, ChartOptions } from "./adapter.js";

interface Scheduler {
  frame(action: () => void): number;
  cancelFrame(id: number): void;
  delay(action: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  cancelDelay(id: ReturnType<typeof setTimeout>): void;
}
const browserScheduler: Scheduler = {
  frame: (action) => requestAnimationFrame(action),
  cancelFrame: (id) => cancelAnimationFrame(id),
  delay: (action, milliseconds) => setTimeout(action, milliseconds),
  cancelDelay: (id) => clearTimeout(id)
};
/** Stable X-camera, excluding quote-dependent candle timestamps/visible boundaries. */
export function cameraSignature(view: ChartView | null): string | null {
  if (!view) return null;
  if (
    view.camera &&
    (!Number.isFinite(view.camera.barSpace) ||
      view.camera.barSpace <= 0 ||
      !Number.isFinite(view.camera.rightOffsetBars))
  )
    return null;
  const rounded = (value: number) => Math.round(value * 1e7) / 1e7;
  return view.camera
    ? JSON.stringify([rounded(view.camera.barSpace), rounded(view.camera.rightOffsetBars)])
    : JSON.stringify([view.barSpace, view.offsetRight, view.anchor, view.from, view.to]);
}

/** Input opens an epoch. Native callbacks alone, including quote/render callbacks, cannot dirty it. */
export class UserCameraEvents {
  private adapter: ChartAdapter | undefined;
  private armed = false;
  private inputChanged = false;
  private baseline: string | null = null;
  private muted = 0;
  private disposed = false;
  private rebasePending = false;
  private frame: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly callbacks: Pick<
      ChartOptions,
      "onCameraIntent" | "onCameraChange" | "onCameraIdle"
    >,
    private readonly scheduler = browserScheduler
  ) {}
  private read(): ChartView | null {
    try {
      return this.adapter?.getView() ?? null;
    } catch {
      return null;
    }
  }
  private clear(): void {
    if (this.frame !== undefined) this.scheduler.cancelFrame(this.frame);
    if (this.timer !== undefined) this.scheduler.cancelDelay(this.timer);
    this.frame = undefined;
    this.timer = undefined;
  }
  begin = (changed = false): void => {
    if (this.disposed || (!this.callbacks.onCameraIntent && !this.callbacks.onCameraChange)) return;
    this.callbacks.onCameraIntent?.(); // Before native input and before any RAF/readback.
    if (!this.armed) {
      this.baseline = cameraSignature(this.read());
      this.armed = true;
    }
    this.inputChanged ||= changed;
    if (changed) this.rebasePending = false;
    if (this.inputChanged) this.schedule();
  };
  end = (): void => {
    if (this.disposed) return;
    if (this.inputChanged) this.schedule();
    else {
      this.clear();
      this.armed = false;
      this.callbacks.onCameraIdle?.("unchanged");
    }
  };
  nativeChanged = (): void => {
    if (!this.disposed && !this.muted && this.armed && this.inputChanged) this.schedule();
  };
  programmatic<T>(action: () => T): T {
    const before = this.armed ? cameraSignature(this.read()) : null;
    this.muted++;
    try {
      return action();
    } finally {
      this.muted--;
      if (this.armed && before === this.baseline) {
        const after = cameraSignature(this.read());
        if (after !== null) this.baseline = after;
        else this.rebasePending = true;
      }
    }
  }
  private schedule(): void {
    this.clear();
    this.timer = this.scheduler.delay(() => {
      this.timer = undefined;
      this.settle(0);
    }, 250);
  }
  private settle(attempt: number): void {
    this.frame = this.scheduler.frame(() => {
      this.frame = undefined;
      if (this.disposed || !this.armed || !this.inputChanged) return;
      // A second frame lets Lightweight Charts finish queued public scale writes.
      if (attempt === 0) {
        this.settle(1);
        return;
      }
      const view = this.read(),
        signature = cameraSignature(view);
      if (!view || signature === null) {
        if (attempt < 6) this.settle(attempt + 1);
        else {
          this.armed = false;
          this.inputChanged = false;
          this.callbacks.onCameraIdle?.("unavailable");
        }
        return;
      }
      const changed = !this.rebasePending && this.baseline !== null && signature !== this.baseline;
      this.rebasePending = false;
      this.baseline = signature;
      this.armed = false;
      this.inputChanged = false;
      if (changed) this.callbacks.onCameraChange?.(view);
      else this.callbacks.onCameraIdle?.("unchanged");
    });
  }
  wrap(adapter: ChartAdapter): ChartAdapter {
    const run = (action: () => void) => {
      this.begin(true);
      try {
        action();
      } finally {
        this.end();
      }
    };
    const wrapped: ChartAdapter = {
      ...adapter,
      beginViewInteraction: this.begin,
      endViewInteraction: this.end,
      setData: (data, fit) => this.programmatic(() => adapter.setData(data, fit)),
      updateBar: (bar) => this.programmatic(() => adapter.updateBar(bar)),
      setView: (view) => this.programmatic(() => adapter.setView(view)),
      fit: () => run(() => adapter.fit()),
      ...(adapter.focusPoints
        ? {
            focusPoints: (points: Parameters<NonNullable<ChartAdapter["focusPoints"]>>[0]) =>
              run(() => adapter.focusPoints?.(points))
          }
        : {}),
      destroy: () => {
        this.disposed = true;
        wrapped.retired = true;
        this.clear();
        this.callbacks.onCameraIdle?.("cancelled");
        adapter.destroy();
      }
    };
    this.adapter = wrapped;
    return wrapped;
  }
}
