import type { Subscription } from "./types.js";

const seriesKey = (uid: string, interval: string) => `${uid}:${interval}`;

/** The primary chart and any number of retained views can share one provider topic. */
export class CandleLeases<T extends Subscription> {
  private primary: T | null = null;
  private readonly retained = new Map<string, { series: T; count: number }>();

  constructor(private readonly change: (added: T[], removed: T[]) => void) {}

  private members(): Map<string, T> {
    const all = new Map<string, T>();
    if (this.primary) all.set(seriesKey(this.primary.uid, this.primary.timeframe), this.primary);
    for (const [key, lease] of this.retained) all.set(key, lease.series);
    return all;
  }

  get values(): T[] {
    return [...this.members().values()];
  }

  has(uid: string, timeframe: string): boolean {
    return (
      (this.primary?.uid === uid && this.primary.timeframe === timeframe) ||
      this.retained.has(seriesKey(uid, timeframe))
    );
  }

  private update(mutate: () => void): void {
    const before = this.members();
    mutate();
    const after = this.members();
    const added = [...after].filter(([key]) => !before.has(key)).map(([, value]) => value);
    const removed = [...before].filter(([key]) => !after.has(key)).map(([, value]) => value);
    if (added.length || removed.length) this.change(added, removed);
  }

  select(series: T | null): void {
    this.update(() => {
      this.primary = series;
    });
  }

  retain(series: T): () => void {
    const key = seriesKey(series.uid, series.timeframe);
    const entry = this.retained.get(key) ?? { series, count: 0 };
    this.update(() => {
      entry.count++;
      this.retained.set(key, entry);
    });
    let released = false;
    return () => {
      if (released || this.retained.get(key) !== entry) return;
      released = true;
      this.update(() => {
        if (--entry.count === 0) this.retained.delete(key);
      });
    };
  }

  remove(uid: string): void {
    this.update(() => {
      if (this.primary?.uid === uid) this.primary = null;
      for (const [key, lease] of this.retained)
        if (lease.series.uid === uid) this.retained.delete(key);
    });
  }
}
