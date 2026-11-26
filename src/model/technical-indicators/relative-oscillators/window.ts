import { add, blend, multiply, subtract, times, ZERO, type Scalar } from "./numeric.js";

interface Summary {
  readonly count: number;
  readonly mean: Scalar;
  readonly weighted: Scalar;
  readonly variance: Scalar;
}
const EMPTY: Summary = { count: 0, mean: ZERO, weighted: ZERO, variance: ZERO };
function merge(a: Summary, b: Summary): Summary {
  if (a.count === 0) return b;
  if (b.count === 0) return a;
  const count = a.count + b.count;
  const weight = b.count / count;
  const bLinearWeight = a.count * b.count + (b.count * (b.count + 1)) / 2;
  const bMean = blend(b.mean, b.weighted, (b.count * (b.count + 1)) / 2 / bLinearWeight);
  const delta = subtract(a.mean, b.mean);
  return {
    count,
    mean: blend(a.mean, b.mean, weight),
    weighted: blend(a.weighted, bMean, bLinearWeight / ((count * (count + 1)) / 2)),
    variance: add(
      blend(a.variance, b.variance, weight),
      times(multiply(delta, delta), (1 - weight) * weight)
    )
  };
}
/** Last L known observations; null ignores insertion and carries a ready window. */
export class ObservationWindow {
  private readonly size: number;
  private readonly tree: Summary[];
  private next = 0;
  private count = 0;
  constructor(private readonly length: number) {
    this.size = 2 ** Math.ceil(Math.log2(length));
    this.tree = Array<Summary>(this.size * 2).fill(EMPTY);
  }
  private query(start: number, end: number): Summary {
    let left = EMPTY;
    let right = EMPTY;
    for (let a = start + this.size, b = end + this.size; a < b; a >>= 1, b >>= 1) {
      if (a & 1) left = merge(left, this.tree[a++]!);
      if (b & 1) right = merge(this.tree[--b]!, right);
    }
    return merge(left, right);
  }
  push(value: Scalar | null): Summary | null {
    if (value !== null) {
      let index = this.size + this.next;
      this.tree[index] = { count: 1, mean: value, weighted: value, variance: ZERO };
      while (index > 1) {
        index >>= 1;
        this.tree[index] = merge(this.tree[index * 2]!, this.tree[index * 2 + 1]!);
      }
      this.next = (this.next + 1) % this.length;
      this.count = Math.min(this.count + 1, this.length);
    }
    if (this.count < this.length) return null;
    return merge(this.query(this.next, this.length), this.query(0, this.next));
  }
}
