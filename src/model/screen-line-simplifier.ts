export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Linear-time simplification of an increasing-X polyline, with a vertical error bound.
 * Every accepted actual endpoint lies in all preceding points' slope corridors.
 * On rejection, the previous accepted endpoint closes a proven valid segment.
 */
export class ScreenLineSimplifier {
  private anchorX = 0;
  private anchorY = 0;
  private previousX = 0;
  private previousY = 0;
  private lowerSlope = -Infinity;
  private upperSlope = Infinity;
  private exact = false;
  private pending = false;
  constructor(private readonly tolerance: number) {}
  reset(x: number, y: number): void {
    this.anchorX = this.previousX = x;
    this.anchorY = this.previousY = y;
    this.lowerSlope = -Infinity;
    this.upperSlope = Infinity;
    this.exact = false;
    this.pending = false;
  }
  push(x: number, y: number): ScreenPoint | null {
    const previousX = this.previousX,
      previousY = this.previousY;
    let emit = this.exact;
    if (!emit) {
      const deltaX = x - this.anchorX;
      const slope = (y - this.anchorY) / deltaX;
      if (
        !Number.isFinite(slope) ||
        x - previousX <= Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(previousX)) * 32
      ) {
        this.exact = true;
        emit = true;
      } else if (slope < this.lowerSlope || slope > this.upperSlope) emit = true;
    }
    if (emit) {
      this.anchorX = previousX;
      this.anchorY = previousY;
      this.lowerSlope = -Infinity;
      this.upperSlope = Infinity;
    }
    if (!this.exact) {
      const deltaX = x - this.anchorX;
      const deltaY = y - this.anchorY;
      this.lowerSlope = Math.max(this.lowerSlope, (deltaY - this.tolerance) / deltaX);
      this.upperSlope = Math.min(this.upperSlope, (deltaY + this.tolerance) / deltaX);
    }
    this.previousX = x;
    this.previousY = y;
    const wasPending = this.pending;
    this.pending = true;
    return emit && wasPending ? { x: previousX, y: previousY } : null;
  }
  finish(): ScreenPoint | null {
    return this.pending ? { x: this.previousX, y: this.previousY } : null;
  }
}
