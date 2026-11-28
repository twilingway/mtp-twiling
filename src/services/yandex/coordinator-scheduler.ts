/** Retains an already scheduled automatic job when another operation occupies its deadline. */
export class YandexScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private maximumTimer: ReturnType<typeof setTimeout> | undefined;
  private maximumReached = false;
  private deferred = false;
  clear(): void {
    clearTimeout(this.timer);
    clearTimeout(this.maximumTimer);
    this.timer = undefined;
    this.maximumTimer = undefined;
    this.maximumReached = false;
    this.deferred = false;
  }
  schedule(run: () => Promise<void>, busy: () => boolean, dirty = false): void {
    clearTimeout(this.timer);
    const flush = (maximum = false) => {
      if (maximum) this.maximumReached = true;
      clearTimeout(this.timer);
      this.timer = undefined;
      if (busy()) this.deferred = true;
      else {
        this.clear();
        void run();
      }
    };
    if (!dirty) {
      clearTimeout(this.maximumTimer);
      this.maximumTimer = undefined;
      this.maximumReached = false;
    } else if (this.maximumReached) {
      flush(true);
      return;
    } else if (!this.maximumTimer)
      this.maximumTimer = setTimeout(() => {
        this.maximumTimer = undefined;
        flush(true);
      }, 5000);
    this.timer = setTimeout(() => flush(), 750);
  }
  complete(resume: () => void): void {
    if (!this.deferred) return;
    this.deferred = false;
    resume();
  }
}
