import type { NumericValue } from "../types.js";

/** Positional extrema ignore null without extending the bar window. */
export class ExtremeWindow {
  private entries: { index: number; value: number }[] = [];
  private head = 0;
  constructor(private readonly maximum: boolean) {}
  push(index: number, value: NumericValue, length: number): NumericValue {
    while (this.head < this.entries.length && this.entries[this.head]!.index <= index - length)
      this.head++;
    if (value !== null) {
      while (
        this.entries.length > this.head &&
        (this.maximum ? this.entries.at(-1)!.value <= value : this.entries.at(-1)!.value >= value)
      )
        this.entries.pop();
      this.entries.push({ index, value });
    }
    if (this.head > 1024 && this.head * 2 > this.entries.length) {
      this.entries.splice(0, this.head);
      this.head = 0;
    }
    return this.entries[this.head]?.value ?? null;
  }
}

/** Stable centered/scaled population moments over accepted observations. */
export class RollingMoments {
  private window: number[] = [];
  private maximum = new ExtremeWindow(true);
  private position = 0;
  private ordinal = 0;
  private sinceRebase = 0;
  private anchor = 0;
  private scale = 0;
  private mean = 0;
  private m2 = 0;
  private sum = 0;
  private correction = 0;
  workUnits = 0;

  constructor(private readonly length: number) {}

  reset(): void {
    this.window = [];
    this.maximum = new ExtremeWindow(true);
    this.position = 0;
    this.ordinal = 0;
    this.sinceRebase = 0;
    this.anchor = 0;
    this.scale = 0;
    this.mean = 0;
    this.m2 = 0;
    this.sum = 0;
    this.correction = 0;
  }

  push(value: number) {
    this.workUnits++;
    if (this.window.length === 0) this.anchor = value;
    const maximum = this.maximum.push(this.ordinal++, Math.abs(value), this.length)!;
    if (Math.abs(value) > this.scale) {
      const factor = this.scale / Math.abs(value);
      this.mean *= factor;
      this.m2 *= factor * factor;
      this.sum *= factor;
      this.correction *= factor;
      this.scale = Math.abs(value);
    }
    if (this.window.length === this.length) {
      this.addToSum(this.scale === 0 ? 0 : -this.window[this.position]! / this.scale);
      const old = this.normalized(this.window[this.position]!);
      if (this.length === 1) {
        this.mean = 0;
        this.m2 = 0;
      } else {
        const remainingMean = this.mean + (this.mean - old) / (this.length - 1);
        this.m2 -= (old - this.mean) * (old - remainingMean);
        this.mean = remainingMean;
      }
      this.window[this.position] = value;
      this.position = (this.position + 1) % this.length;
    } else this.window.push(value);
    const normalized = this.normalized(value),
      delta = normalized - this.mean;
    this.addToSum(this.scale === 0 ? 0 : value / this.scale);
    this.mean += delta / this.window.length;
    this.m2 += delta * (normalized - this.mean);
    this.sinceRebase++;
    if (this.sinceRebase >= this.length || maximum < this.scale * 1e-6 || this.m2 < 0)
      this.rebase(maximum);
    if (this.window.length < this.length) return null;
    const normalizedMean = (this.sum + this.correction) / this.window.length;
    return {
      mean: Math.max(-1, Math.min(1, normalizedMean)) * this.scale,
      normalizedMean,
      normalizedDeviation: Math.sqrt(Math.max(0, this.m2) / this.length),
      currentDeviation: this.normalized(value) - this.mean,
      scale: this.scale
    };
  }

  private normalized(value: number): number {
    if (this.scale === 0) return 0;
    const difference = value - this.anchor;
    return Number.isFinite(difference)
      ? difference / this.scale
      : value / this.scale - this.anchor / this.scale;
  }

  private addToSum(value: number): void {
    const updated = this.sum + value;
    this.correction +=
      Math.abs(this.sum) >= Math.abs(value)
        ? this.sum - updated + value
        : value - updated + this.sum;
    this.sum = updated;
  }

  private rebase(scale: number): void {
    this.workUnits += this.window.length;
    this.anchor = this.window[0]!;
    this.scale = scale;
    this.mean = 0;
    this.m2 = 0;
    this.sum = 0;
    this.correction = 0;
    for (let index = 0; index < this.window.length; index++) {
      const value = this.normalized(this.window[index]!),
        delta = value - this.mean;
      this.mean += delta / (index + 1);
      this.m2 += delta * (value - this.mean);
      this.addToSum(this.scale === 0 ? 0 : this.window[index]! / this.scale);
    }
    this.sinceRebase = 0;
  }
}
