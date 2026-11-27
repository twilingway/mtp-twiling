/** Retains an already scheduled automatic job when another operation occupies its deadline. */
export class YandexScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deferred = false;
  clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.deferred = false;
  }
  schedule(run: () => Promise<void>, busy: () => boolean): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (busy()) this.deferred = true;
      else void run();
    }, 750);
  }
  complete(resume: () => void): void {
    if (!this.deferred) return;
    this.deferred = false;
    resume();
  }
}
