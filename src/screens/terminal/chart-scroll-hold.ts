import type { ChartAdapter } from "../../charts/adapter.js";
import type { TerminalController } from "./controller.js";
import { chartNavigationReady } from "./chart-navigation-state.js";

type Direction = -1 | 1;
interface Scheduler {
  now(): number;
  frame(action: (time: number) => void): number;
  cancel(id: number): void;
}
const browser: Scheduler = {
  now: () => performance.now(),
  frame: (action) => requestAnimationFrame(action),
  cancel: (id) => cancelAnimationFrame(id)
};
interface Press {
  chart: ChartAdapter;
  direction: Direction;
  token: string;
  valid(): boolean;
  release(): void;
  due: number;
  last: number;
  started: boolean;
}

/** One owned interaction, fractional public scroll commands, and no timers after release. */
export class ChartScrollHold {
  private press: Press | undefined;
  private frame: number | undefined;
  private suppressed: Direction | undefined;
  private clickScope: Press | undefined;
  constructor(
    private readonly controller: Pick<TerminalController, "chart" | "getSnapshot" | "sessionKey">,
    private readonly scheduler = browser
  ) {}
  start(direction: Direction, token: string, release: () => void = () => {}): boolean {
    const chart = this.controller.chart;
    if (this.press || !chartNavigationReady(this.controller.getSnapshot(), chart) || !chart.scroll)
      return false;
    const source = { ...chart.source! },
      session = this.controller.sessionKey(),
      revision = this.controller.getSnapshot().chartRevision,
      due = this.scheduler.now() + 180;
    this.suppressed = undefined;
    this.clickScope = undefined;
    this.press = {
      chart,
      direction,
      token,
      release,
      due,
      last: due,
      started: false,
      valid: () => {
        try {
          return (
            this.controller.chart === chart &&
            this.controller.sessionKey() === session &&
            this.controller.getSnapshot().chartRevision === revision &&
            chart.source?.owner === source.owner &&
            chart.source?.uid === source.uid &&
            chart.source?.viewKey === source.viewKey &&
            chartNavigationReady(this.controller.getSnapshot(), chart)
          );
        } catch {
          return false;
        }
      }
    };
    this.frame = this.scheduler.frame(this.step);
    return true;
  }
  private step = (time: number): void => {
    this.frame = undefined;
    const press = this.press;
    if (!press) return;
    if (!press.valid()) {
      this.cancel();
      return;
    }
    if (time >= press.due) {
      const elapsed = Math.min(50, Math.max(0, time - press.last));
      press.last = time;
      if (elapsed > 0) {
        try {
          if (!press.started) {
            press.started = true;
            press.chart.beginViewInteraction?.(true, true);
            press.chart.beginPan?.();
          }
          press.chart.scroll?.(press.direction, elapsed / 300);
        } catch {
          this.cancel();
          return;
        }
      }
    }
    if (this.press === press) this.frame = this.scheduler.frame(this.step);
  };
  validate(): void {
    if (this.press && !this.press.valid()) this.cancel();
    if (this.clickScope && !this.clickScope.valid()) this.cancel();
  }
  finish(token: string): "short" | "held" | "none" {
    if (this.press?.token !== token) return "none";
    if (!this.press.valid()) {
      this.cancel();
      return "none";
    }
    const press = this.press;
    const result = this.press.started ? "held" : "short";
    if (result === "short") this.clickScope = press;
    this.stop(false);
    if (result === "short" && token.startsWith("key:")) {
      this.suppressed = press.direction;
      this.clickScope = undefined;
    }
    return result;
  }
  cancel(token?: string): void {
    if (token !== undefined && this.press?.token !== token) return;
    this.stop(true);
  }
  private stop(cancelled: boolean): void {
    const press = this.press;
    this.press = undefined;
    if (this.frame !== undefined) this.scheduler.cancel(this.frame);
    this.frame = undefined;
    if (cancelled && this.clickScope) {
      this.suppressed = this.clickScope.direction;
      this.clickScope = undefined;
    }
    if (!press) return;
    if (cancelled || press.started) this.suppressed = press.direction;
    if (press.started) {
      press.chart.endPan?.();
      press.chart.endViewInteraction?.(true);
    }
    press.release();
  }
  click(direction: Direction): boolean {
    if (this.suppressed === direction) {
      this.suppressed = undefined;
      this.clickScope = undefined;
      return false;
    }
    if (this.clickScope?.direction === direction) {
      const valid = this.clickScope.valid();
      this.clickScope = undefined;
      return valid;
    }
    return true;
  }
}
