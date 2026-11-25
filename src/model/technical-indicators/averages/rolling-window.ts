import { finiteOrNull } from "../primitives.js";
import type { NumericValue } from "../types.js";

interface Observation {
  value: number;
  weight: number;
}

class CompensatedSum {
  value = 0;
  private correction = 0;

  add(term: number): void {
    const adjusted = term - this.correction,
      updated = this.value + adjusted;
    this.correction = updated - this.value - adjusted;
    this.value = updated;
  }

  scale(factor: number): void {
    this.value *= factor;
    this.correction *= factor;
  }

  reset(): void {
    this.value = 0;
    this.correction = 0;
  }
}

class RollingMaximum {
  private entries: { index: number; value: number }[] = [];
  private head = 0;

  push(index: number, value: number, length: number): void {
    while (this.head < this.entries.length && this.entries[this.head]!.index <= index - length)
      this.head++;
    while (this.entries.length > this.head && this.entries.at(-1)!.value <= value)
      this.entries.pop();
    this.entries.push({ index, value });
    if (this.head > 1024 && this.head * 2 > this.entries.length) {
      this.entries.splice(0, this.head);
      this.head = 0;
    }
  }

  get value(): number {
    return this.entries[this.head]?.value ?? 0;
  }
}

/** Internal shared rolling engine. Counters permit deterministic complexity regression tests. */
export class RollingAverageWindow {
  private readonly observations: Observation[] = [];
  private readonly sum = new CompensatedSum();
  private readonly weighted = new CompensatedSum();
  private readonly priceMaximum = new RollingMaximum();
  private readonly volumeMaximum = new RollingMaximum();
  private position = 0;
  private ordinal = 0;
  private sinceRebase = 0;
  private priceScale = 0;
  private volumeScale = 0;
  private extremeProductsUntil = 0;
  workUnits = 0;
  rebaseCount = 0;

  constructor(
    private readonly length: number,
    private readonly positional: boolean
  ) {}

  push(value: number, weight = 1): NumericValue {
    this.workUnits++;
    const priceMagnitude = weight === 0 ? 0 : Math.abs(value);
    this.priceMaximum.push(this.ordinal, priceMagnitude, this.length);
    if (!this.positional) this.volumeMaximum.push(this.ordinal, weight, this.length);
    this.ordinal++;
    this.growScale(priceMagnitude, weight);
    const incoming = this.normalized({ value, weight });
    if (!this.positional && value !== 0 && weight !== 0 && incoming.product === 0)
      this.extremeProductsUntil = this.ordinal + this.length;
    if (this.observations.length < this.length) {
      this.observations.push({ value, weight });
      this.weighted.add(
        this.positional ? incoming.price * this.observations.length : incoming.product
      );
      this.sum.add(this.positional ? incoming.price : incoming.volume);
    } else {
      const outgoing = this.normalized(this.observations[this.position]!);
      if (this.positional) {
        // Shift every old weight down by one, then give the new observation weight length.
        this.weighted.add(-this.sum.value);
        this.weighted.add(this.length * incoming.price);
      } else {
        this.weighted.add(-outgoing.product);
        this.weighted.add(incoming.product);
      }
      this.sum.add(this.positional ? -outgoing.price : -outgoing.volume);
      this.sum.add(this.positional ? incoming.price : incoming.volume);
      this.observations[this.position] = { value, weight };
      this.position = (this.position + 1) % this.length;
    }
    this.sinceRebase++;
    // Periodic O(length) rebuilding is amortized O(bars); drastic scale loss is a defensive fallback.
    if (
      this.sinceRebase >= this.length ||
      this.priceMaximum.value < this.priceScale * 1e-6 ||
      (!this.positional && this.volumeMaximum.value < this.volumeScale * 1e-6)
    )
      this.rebase();
    if (this.observations.length !== this.length) return null;
    if (!this.positional && this.volumeMaximum.value === 0) return null;
    if (this.priceMaximum.value === 0) return 0;
    if (!this.positional && this.ordinal <= this.extremeProductsUntil)
      return this.extremeVolumeMean();
    if (!this.positional && this.sum.value <= 0) this.rebase();
    const denominator = this.positional ? (this.length * (this.length + 1)) / 2 : this.sum.value;
    if (denominator <= 0) return null;
    // Nonnegative weights make a convex mean; clamp a rounding overshoot at Number.MAX_VALUE.
    return finiteOrNull(
      Math.max(-1, Math.min(1, this.weighted.value / denominator)) * this.priceScale
    );
  }

  private normalized(item: Observation) {
    const price = this.priceScale === 0 || item.weight === 0 ? 0 : item.value / this.priceScale,
      volume = this.volumeScale === 0 ? 0 : item.weight / this.volumeScale;
    return { price, volume, product: price * volume };
  }

  private growScale(price: number, volume: number): void {
    if (price > this.priceScale) {
      const factor = this.priceScale / price;
      if (!this.positional && factor === 0 && this.weighted.value !== 0)
        this.extremeProductsUntil = this.ordinal + this.length;
      this.weighted.scale(factor);
      if (this.positional) this.sum.scale(factor);
      this.priceScale = price;
    }
    if (!this.positional && volume > this.volumeScale) {
      const factor = this.volumeScale / volume;
      if (factor === 0 && this.weighted.value !== 0)
        this.extremeProductsUntil = this.ordinal + this.length;
      this.weighted.scale(factor);
      this.sum.scale(factor);
      this.volumeScale = volume;
    }
  }

  /** Rare O(length) fallback when independent price/volume scales underflow a representable mean. */
  private extremeVolumeMean(): NumericValue {
    this.workUnits += this.observations.length * 2;
    const volumeScale = this.volumeMaximum.value,
      product = ({ value, weight }: Observation) => {
        const relativeVolume = weight / volumeScale;
        return relativeVolume === 0 ? (value * weight) / volumeScale : value * relativeVolume;
      };
    let scale = 0;
    for (const item of this.observations) scale = Math.max(scale, Math.abs(product(item)));
    if (scale === 0) return 0;
    const numerator = new CompensatedSum(),
      denominator = new CompensatedSum();
    for (const item of this.observations) {
      numerator.add(product(item) / scale);
      denominator.add(item.weight / volumeScale);
    }
    const result = (numerator.value / denominator.value) * scale;
    return finiteOrNull(
      Math.max(-this.priceMaximum.value, Math.min(this.priceMaximum.value, result))
    );
  }

  private rebase(): void {
    this.rebaseCount++;
    this.workUnits += this.observations.length;
    this.priceScale = this.priceMaximum.value;
    if (!this.positional) this.volumeScale = this.volumeMaximum.value;
    this.weighted.reset();
    this.sum.reset();
    for (let index = 0; index < this.observations.length; index++) {
      const item = this.observations[(this.position + index) % this.observations.length]!,
        normalized = this.normalized(item);
      this.sum.add(this.positional ? normalized.price : normalized.volume);
      this.weighted.add(this.positional ? normalized.price * (index + 1) : normalized.product);
    }
    this.sinceRebase = 0;
  }
}
