import type { DrawingPoint, PixelPoint } from "./types.js";
import { MAX_DRAWING_POINTS } from "./drawing-tool-policy.js";

/** Bounded screen-distance sampling; no clock, DOM or chart dependency. */
export class DrawingStrokeSampler {
  private anchors: DrawingPoint[] = [];
  private pixels: PixelPoint[] = [];
  add(point: DrawingPoint, pixel: PixelPoint, endpoint = false): boolean {
    const last = this.pixels.at(-1);
    if (last && Math.hypot(pixel.x - last.x, pixel.y - last.y) < 2) {
      if (!endpoint) return false;
      if (this.anchors.length > 1) {
        this.anchors[this.anchors.length - 1] = point;
        this.pixels[this.pixels.length - 1] = pixel;
      }
      return true;
    }
    if (this.anchors.length >= MAX_DRAWING_POINTS) {
      this.anchors = this.anchors.filter(
        (_, index) => index % 2 === 0 || index === this.anchors.length - 1
      );
      this.pixels = this.pixels.filter(
        (_, index) => index % 2 === 0 || index === this.pixels.length - 1
      );
    }
    this.anchors.push(point);
    this.pixels.push(pixel);
    return true;
  }
  points(): DrawingPoint[] {
    return [...this.anchors];
  }
}
