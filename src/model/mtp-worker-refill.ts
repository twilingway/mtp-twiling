import type { MtpWorkerEnvironment } from "./mtp-worker-raster-cache.js";

/** A refill grants one dispatch, never work from the timer/response callback itself. */
export class MtpWorkerRefill {
  private last = -Infinity;
  private timer: unknown;
  private wanted = false;
  constructor(
    private readonly environment: MtpWorkerEnvironment,
    private readonly requestUpdate: () => void
  ) {}
  private now(): number {
    return this.environment.now?.() ?? performance.now();
  }
  private cancel(): void {
    if (this.timer !== undefined) this.environment.cancel(this.timer);
    this.timer = undefined;
  }
  allow(wanted: boolean): boolean {
    this.wanted = wanted;
    if (!wanted) {
      this.cancel();
      return false;
    }
    const remaining = 150 - (this.now() - this.last);
    if (remaining <= 0) {
      this.cancel();
      return true;
    }
    if (this.timer === undefined)
      this.timer = this.environment.delay(() => {
        this.timer = undefined;
        if (this.wanted) this.requestUpdate();
      }, remaining);
    return false;
  }
  sent(): void {
    this.last = this.now();
    this.clear();
  }
  clear(): void {
    this.wanted = false;
    this.cancel();
  }
}
