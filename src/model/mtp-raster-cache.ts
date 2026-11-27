import type { MtpBitmapScope, MtpModel } from "./mtp.js";

type Surface = HTMLCanvasElement | OffscreenCanvas;
interface Matrix {
  xScale: number;
  xOffset: number;
  yScale: number;
  yOffset: number;
}
export interface MtpRasterEnvironment {
  canvas(width: number, height: number): Surface | null;
  delay(action: () => void, milliseconds: number): unknown;
  cancel(timer: unknown): void;
}
const browser: MtpRasterEnvironment = {
  canvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  delay: (action, milliseconds) => setTimeout(action, milliseconds),
  cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
};
export interface MtpRasterFrame {
  scope: MtpBitmapScope;
  model: MtpModel;
  from: number;
  to: number;
  mode: number | undefined;
  xFor(index: number): number | null;
  yFor(price: number): number | null;
  paint(context: CanvasRenderingContext2D): void;
}
interface Cached {
  surface: Surface;
  signature: string;
  revision: number;
  resetRevision: number;
  length: number;
  firstTime: number | undefined;
  lastTime: number | undefined;
  lastClose: number | undefined;
  mode: number;
  width: number;
  height: number;
  horizontalRatio: number;
  verticalRatio: number;
  padX: number;
  padY: number;
  indices: number[];
  prices: number[];
  x: number[];
  y: number[];
  logicalFrom: number;
  logicalTo: number;
  priceLowY: number;
  priceHighY: number;
  fullHistory: boolean;
}
const finite = (values: readonly (number | null)[]): values is number[] =>
  values.every((value) => value !== null && Number.isFinite(value));
const sameMatrix = (a: Matrix, b: Matrix) =>
  Math.abs(a.xScale - b.xScale) < 1e-10 &&
  Math.abs(a.yScale - b.yScale) < 1e-10 &&
  Math.abs(a.xOffset - b.xOffset) < 1e-7 &&
  Math.abs(a.yOffset - b.yOffset) < 1e-7;
const identity: Matrix = { xScale: 1, xOffset: 0, yScale: 1, yOffset: 0 };

/** A single bounded, transparent MTP layer; settled frames always use native raster geometry. */
export class MtpRasterCache {
  private cached: Cached | undefined;
  private observed = identity;
  private timer: unknown;
  private ready = false;
  private disposed = false;
  private wheel = false;
  private pointers = new Set<number>();
  private stopInput = () => {};
  constructor(
    private readonly requestUpdate: () => void,
    container?: HTMLElement,
    private readonly environment = browser
  ) {
    if (!container) return;
    const view = container.ownerDocument.defaultView;
    if (!view) return;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.pointers.add(event.pointerId);
      this.cancelTimer();
    };
    const up = (event: PointerEvent) => {
      if (this.pointers.delete(event.pointerId) && !this.pointers.size) this.schedule();
    };
    const blur = () => {
      this.pointers.clear();
      this.schedule();
    };
    const wheel = (event: WheelEvent) => {
      if (!event.deltaX && !event.deltaY) return;
      this.wheel = true;
      this.schedule();
    };
    const passive = { capture: true, passive: true };
    container.addEventListener("pointerdown", down, passive);
    container.addEventListener("wheel", wheel, passive);
    view.addEventListener("pointerup", up, passive);
    view.addEventListener("pointercancel", up, passive);
    view.addEventListener("blur", blur, passive);
    this.stopInput = () => {
      container.removeEventListener("pointerdown", down, true);
      container.removeEventListener("wheel", wheel, true);
      view.removeEventListener("pointerup", up, true);
      view.removeEventListener("pointercancel", up, true);
      view.removeEventListener("blur", blur, true);
    };
  }
  private cancelTimer(): void {
    if (this.timer !== undefined) this.environment.cancel(this.timer);
    this.timer = undefined;
    this.ready = false;
  }
  private schedule(): void {
    this.cancelTimer();
    if (this.pointers.size || this.disposed) return;
    this.timer = this.environment.delay(() => {
      this.timer = undefined;
      this.wheel = false;
      this.ready = true;
      if (!this.disposed) this.requestUpdate();
    }, 180);
  }
  private release(): void {
    if (!this.cached) return;
    this.cached.surface.width = 0;
    this.cached.surface.height = 0;
    this.cached = undefined;
  }
  private matrix(frame: MtpRasterFrame, cached: Cached): Matrix | null {
    const x = cached.indices.map((index) => frame.xFor(index)),
      y = cached.prices.map((price) => frame.yFor(price));
    if (!finite(x) || !finite(y)) return null;
    const xScale = (x[1]! - x[0]!) / (cached.x[1]! - cached.x[0]!);
    const yScale = (y[1]! - y[0]!) / (cached.y[1]! - cached.y[0]!);
    const xOffset = x[0]! - xScale * cached.x[0]!;
    const yOffset = y[0]! - yScale * cached.y[0]!;
    if (
      ![xScale, yScale, xOffset, yOffset].every(Number.isFinite) ||
      xScale <= 0 ||
      yScale <= 0 ||
      Math.abs(xScale * cached.x[2]! + xOffset - x[2]!) > 1e-6 ||
      Math.abs(yScale * cached.y[2]! + yOffset - y[2]!) > 1e-6
    )
      return null;
    return { xScale, yScale, xOffset, yOffset };
  }
  private covers(frame: MtpRasterFrame, cached: Cached, matrix: Matrix): boolean {
    let left = -matrix.xOffset / matrix.xScale;
    let right = (cached.width - matrix.xOffset) / matrix.xScale;
    let top = -matrix.yOffset / matrix.yScale;
    let bottom = (cached.height - matrix.yOffset) / matrix.yScale;
    if (cached.fullHistory) {
      left = Math.max(left, cached.logicalFrom);
      right = Math.min(right, cached.logicalTo);
    }
    top = Math.max(top, cached.priceLowY);
    bottom = Math.min(bottom, cached.priceHighY);
    if (left > right || top > bottom) return true;
    const requiredFrom = Math.max(0, Math.floor(frame.from) - 1);
    const requiredTo = Math.min(frame.model.data.length - 1, Math.ceil(frame.to) + 1);
    return (
      left >= -cached.padX &&
      right <= cached.width + cached.padX &&
      top >= -cached.padY &&
      bottom <= cached.height + cached.padY &&
      (cached.fullHistory ||
        (requiredFrom >= cached.indices[0]! && requiredTo <= cached.indices[1]!))
    );
  }
  draw(frame: MtpRasterFrame): boolean {
    if (this.disposed) return false;
    const { scope, model, mode } = frame;
    const size = scope.bitmapSize;
    const horizontalRatio = scope.horizontalPixelRatio,
      verticalRatio = scope.verticalPixelRatio;
    if (
      (mode !== 0 && mode !== 2 && mode !== 3) ||
      !size ||
      ![size.width, size.height, horizontalRatio, verticalRatio].every(Number.isFinite) ||
      size.width <= 0 ||
      size.height <= 0 ||
      horizontalRatio <= 0 ||
      verticalRatio <= 0 ||
      size.width > 4096 ||
      size.height > 4096 ||
      size.width * size.height > 4 * 1024 * 1024 ||
      scope.context.globalCompositeOperation !== "source-over" ||
      scope.context.filter !== "none" ||
      scope.context.shadowBlur !== 0 ||
      scope.context.shadowOffsetX !== 0 ||
      scope.context.shadowOffsetY !== 0
    ) {
      this.release();
      return false;
    }
    const firstX = frame.xFor(0),
      nextX = frame.xFor(1);
    if (firstX === null || nextX === null || !(nextX > firstX && nextX - firstX < 1)) {
      this.release();
      return false;
    }
    const width = size.width / horizontalRatio,
      height = size.height / verticalRatio;
    const signature = JSON.stringify([
      model.styleKey,
      model.periods,
      model.styles,
      scope.context.lineCap,
      scope.context.lineJoin,
      scope.context.miterLimit
    ]);
    let cached = this.cached;
    const hardChange =
      cached &&
      (cached.signature !== signature ||
        cached.resetRevision !== model.resetRevision ||
        cached.length !== model.data.length ||
        cached.firstTime !== model.data[0]?.timestamp ||
        cached.lastTime !== model.data.at(-1)?.timestamp ||
        cached.mode !== mode ||
        cached.width !== width ||
        cached.height !== height ||
        cached.horizontalRatio !== horizontalRatio ||
        cached.verticalRatio !== verticalRatio);
    if (hardChange) {
      this.release();
      cached = undefined;
    }
    let matrix = cached ? this.matrix(frame, cached) : null;
    const changedData =
      cached &&
      (cached.revision !== model.revision || cached.lastClose !== model.data.at(-1)?.close);
    if (cached && matrix) {
      const changedGeometry = !sameMatrix(matrix, identity);
      const held = this.pointers.size > 0 || this.wheel;
      if (!sameMatrix(matrix, this.observed)) {
        this.observed = matrix;
        this.schedule();
      }
      const previewScale =
        matrix.xScale >= 0.5 && matrix.xScale <= 2 && matrix.yScale >= 0.5 && matrix.yScale <= 2;
      if (
        this.covers(frame, cached, matrix) &&
        previewScale &&
        ((!changedGeometry && !changedData) || (!this.ready && (!changedData || held)))
      ) {
        this.blit(scope.context, cached, matrix);
        return true;
      }
    }
    const domain = model.extrema(0, model.data.length - 1);
    if (!domain || !(domain.maxValue > domain.minValue) || model.data.length < 2) return false;
    const indices = [
      Math.max(0, Math.floor(frame.from) - 1),
      Math.min(model.data.length - 1, Math.ceil(frame.to) + 1)
    ];
    if (indices[1]! - indices[0]! < 2) return false;
    // LW's public logicalToCoordinate accepts bar indices; fractional probes can return zero.
    indices.push(Math.floor((indices[0]! + indices[1]!) / 2));
    const prices = [domain.minValue, domain.maxValue, (domain.minValue + domain.maxValue) / 2];
    const x = indices.map((index) => frame.xFor(index)),
      y = prices.map((price) => frame.yFor(price));
    if (!finite(x) || !finite(y) || x[0] === x[1] || y[0] === y[1]) return false;
    // Padding captures offscreen price geometry without changing the original sampling range.
    const factor = Math.min(
      1.4,
      Math.sqrt((4 * 1024 * 1024) / (size.width * size.height)),
      4096 / size.width,
      4096 / size.height
    );
    const padPixelsX = Math.floor((size.width * (factor - 1)) / 2);
    const padPixelsY = Math.floor((size.height * (factor - 1)) / 2);
    this.release(); // Never retain two full-size raster allocations.
    let surface: Surface | null;
    try {
      surface = this.environment.canvas(size.width + padPixelsX * 2, size.height + padPixelsY * 2);
    } catch {
      return false;
    }
    // Both surface implementations return a 2D drawing context for this literal selector.
    const context = surface?.getContext("2d") as CanvasRenderingContext2D | null | undefined;
    if (!surface || !context) {
      if (surface) {
        surface.width = 0;
        surface.height = 0;
      }
      return false;
    }
    context.setTransform(horizontalRatio, 0, 0, verticalRatio, padPixelsX, padPixelsY);
    context.lineCap = scope.context.lineCap;
    context.lineJoin = scope.context.lineJoin;
    context.miterLimit = scope.context.miterLimit;
    frame.paint(context);
    // Include stroke joins and antialiasing when proving that uncached regions are empty.
    const lineWidth = Math.max(
      1,
      ...Object.values(model.styles ?? {}).map((style) => style?.width || 1)
    );
    const margin =
      lineWidth * Math.max(1, scope.context.miterLimit) +
      1 / Math.min(horizontalRatio, verticalRatio);
    cached = {
      surface,
      signature,
      revision: model.revision,
      resetRevision: model.resetRevision,
      length: model.data.length,
      firstTime: model.data[0]?.timestamp,
      lastTime: model.data.at(-1)?.timestamp,
      lastClose: model.data.at(-1)?.close,
      mode,
      width,
      height,
      horizontalRatio,
      verticalRatio,
      padX: padPixelsX / horizontalRatio,
      padY: padPixelsY / verticalRatio,
      indices,
      prices,
      x,
      y,
      logicalFrom: x[0]! - margin,
      logicalTo: x[1]! + margin,
      priceLowY: Math.min(y[0]!, y[1]!) - margin,
      priceHighY: Math.max(y[0]!, y[1]!) + margin,
      fullHistory: indices[0] === 0 && indices[1] === model.data.length - 1
    };
    this.cached = cached;
    this.observed = identity;
    this.cancelTimer();
    matrix = identity;
    this.blit(scope.context, cached, matrix);
    return true;
  }
  private blit(context: CanvasRenderingContext2D, cached: Cached, matrix: Matrix): void {
    context.save();
    context.globalAlpha = 1;
    context.translate(
      matrix.xOffset - matrix.xScale * cached.padX,
      matrix.yOffset - matrix.yScale * cached.padY
    );
    context.scale(matrix.xScale, matrix.yScale);
    context.drawImage(
      cached.surface,
      0,
      0,
      cached.surface.width / cached.horizontalRatio,
      cached.surface.height / cached.verticalRatio
    );
    context.restore();
  }
  destroy(): void {
    this.disposed = true;
    this.stopInput();
    this.cancelTimer();
    this.pointers.clear();
    this.release();
  }
}
