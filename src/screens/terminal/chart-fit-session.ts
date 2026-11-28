export interface FitScheduler {
  frame(callback: () => void): number;
  cancel(id: number): void;
  now?(): number;
}
export interface FitOperation {
  current(): boolean;
  apply(): void;
  signature(): string | null;
  pending?(): boolean;
  watch(cancel: () => void): () => void;
}
export type FitResult = "completed" | "cancelled";
interface Job {
  result: Promise<FitResult>;
  cancelled: boolean;
  frame?: number | undefined;
  resume?: ((current: boolean) => void) | undefined;
  stop?: (() => void) | undefined;
}
const browserScheduler: FitScheduler = {
  frame: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id)
};

/** Only transitions publish; market ticks never become React progress updates. */
export class ChartFitSession {
  private job: Job | undefined;
  private busy = false;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly scheduler: FitScheduler = browserScheduler) {}
  getSnapshot = (): boolean => this.busy;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    for (const listener of this.listeners) listener();
  }
  cancel = (): void => {
    const job = this.job;
    if (!job) return;
    job.cancelled = true;
    if (job.frame !== undefined) this.scheduler.cancel(job.frame);
    job.frame = undefined;
    job.stop?.();
    job.stop = undefined;
    job.resume?.(false);
    job.resume = undefined;
    this.job = undefined;
    this.publish(false);
  };
  private frame(job: Job, operation: FitOperation): Promise<boolean> {
    if (job.cancelled || !operation.current()) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      job.resume = resolve;
      job.frame = this.scheduler.frame(() => {
        job.frame = undefined;
        job.resume = undefined;
        try {
          resolve(!job.cancelled && operation.current());
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
  request(operation: FitOperation): Promise<FitResult> {
    if (this.job) return this.job.result;
    if (!operation.current()) return Promise.resolve("cancelled");
    let resolve!: (result: FitResult) => void;
    let reject!: (error: unknown) => void;
    const job: Job = {
      cancelled: false,
      result: new Promise<FitResult>((accept, fail) => {
        resolve = accept;
        reject = fail;
      })
    };
    this.job = job;
    this.publish(true);
    void this.execute(job, operation).then(resolve, reject);
    return job.result;
  }
  private async execute(job: Job, operation: FitOperation): Promise<FitResult> {
    try {
      job.stop = operation.watch(() => {
        if (!operation.current() && this.job === job) this.cancel();
      });
      // An awaited RAF resumes before paint. The intervening frame can paint the overlay.
      if (!(await this.frame(job, operation)) || !(await this.frame(job, operation)))
        return "cancelled";
      if (job.cancelled || !operation.current()) return "cancelled";
      operation.apply();
      let previous: string | null = null;
      // SDK scale writes/paint can themselves be queued. Observe at least two frames.
      const now = () => this.scheduler.now?.() ?? performance.now();
      const deadline = now() + 10_000;
      for (let attempt = 0; ;) {
        if (!(await this.frame(job, operation))) return "cancelled";
        if (job.cancelled || !operation.current()) return "cancelled";
        const signature = operation.signature();
        if (operation.pending?.()) {
          if (now() >= deadline) return "cancelled";
          attempt = 0;
          previous = null;
          continue;
        }
        if (attempt > 0 && signature !== null && signature === previous) break;
        if (attempt >= 7) break;
        attempt++;
        previous = signature;
      }
      return "completed";
    } finally {
      job.stop?.();
      job.stop = undefined;
      if (this.job === job) {
        this.job = undefined;
        this.publish(false);
      }
    }
  }
}
