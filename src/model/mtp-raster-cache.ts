import type { MtpWorkerRasterCache, MtpWorkerStatus } from "./mtp-worker-raster-cache.js";
import type {
  MtpRasterCached as Cached,
  MtpRasterEnvironment,
  MtpRasterFrame,
  MtpRasterMatrix as Matrix
} from "./mtp-raster-types.js";
export type { MtpRasterEnvironment, MtpRasterFrame } from "./mtp-raster-types.js";

declare const __MTP_RASTER_DEV__: boolean;

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
  private worker: MtpWorkerRasterCache | undefined;
  private workerLoading = false;
  private workerLoadError: string | undefined;
  private workerLoadTimer: unknown;
  private forceRequested = false;
  private interactionEpoch = false;
  private workerCamera: { signature: string; prices: number[] } | undefined;
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
    if (
      typeof __MTP_RASTER_DEV__ !== "undefined" &&
      __MTP_RASTER_DEV__ &&
      typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("mtpRaster") === "worker"
    ) {
      this.workerLoading = true;
      const fail = (reason = "worker-module-load-error") => {
        if (!this.workerLoading || this.disposed) return;
        this.finishWorkerLoad(reason);
        this.requestUpdate();
      };
      this.workerLoadTimer = this.environment.delay(() => fail("worker-module-deadline"), 5000);
      void Promise.resolve()
        .then(() => this.environment.loadWorker?.() ?? import("./mtp-worker-raster-cache.js"))
        .then(
          ({ MtpWorkerRasterCache }) => {
            if (!this.workerLoading || this.disposed) return;
            this.finishWorkerLoad();
            this.worker = new MtpWorkerRasterCache(this.requestUpdate);
            this.requestUpdate();
          },
          () => fail()
        );
    }
    if (!container) return;
    const view = container.ownerDocument.defaultView;
    if (!view) return;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.interactionEpoch = true;
      this.pointers.add(event.pointerId);
      this.cancelTimer();
      this.worker?.setInteraction(true);
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
      this.interactionEpoch = true;
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
  private finishWorkerLoad(reason?: string): void {
    if (this.workerLoadTimer !== undefined) this.environment.cancel(this.workerLoadTimer);
    this.workerLoadTimer = undefined;
    this.workerLoading = false;
    this.workerLoadError = reason;
  }
  private cancelTimer(): void {
    if (this.timer !== undefined) this.environment.cancel(this.timer);
    this.timer = undefined;
    this.ready = false;
  }
  private schedule(): void {
    this.cancelTimer();
    this.worker?.setInteraction(true);
    if (this.pointers.size || this.disposed) return;
    this.timer = this.environment.delay(() => {
      this.timer = undefined;
      this.wheel = false;
      this.ready = true;
      this.worker?.setInteraction(false);
      if (!this.disposed) this.requestUpdate();
    }, 180);
  }
  private release(): void {
    if (!this.cached) return;
    this.cached.surface.width = 0;
    this.cached.surface.height = 0;
    this.cached = undefined;
  }
  private trackWorkerMotion(frame: MtpRasterFrame): void {
    if (!this.interactionEpoch) return;
    const price = frame.model.data[0]?.close ?? 0;
    const prices = this.workerCamera?.prices ?? [
      price,
      price + Math.max(1, Math.abs(price)) * 0.01
    ];
    const signature = JSON.stringify([
      frame.from,
      frame.to,
      frame.scope.bitmapSize,
      frame.scope.horizontalPixelRatio,
      frame.scope.verticalPixelRatio,
      frame.mode,
      frame.xFor(0),
      frame.xFor(1),
      prices.map((value) => frame.yFor(value))
    ]);
    if (this.workerCamera && signature !== this.workerCamera.signature) this.schedule();
    else if (this.ready && !this.pointers.size && !this.wheel && this.timer === undefined) {
      this.interactionEpoch = false;
      this.workerCamera = undefined;
      return;
    }
    this.workerCamera = { signature, prices };
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
    const requiredFrom = Math.max(0, Math.floor(frame.from) - 1);
    const requiredTo = Math.min(frame.model.data.length - 1, Math.ceil(frame.to) + 1);
    if (requiredFrom < cached.indices[0]! || requiredTo > cached.indices[1]!) return false;
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
    return (
      left >= -cached.padX &&
      right <= cached.width + cached.padX &&
      top >= -cached.padY &&
      bottom <= cached.height + cached.padY
    );
  }
  draw(frame: MtpRasterFrame): boolean {
    if (this.disposed) return false;
    if (this.worker || this.workerLoading) this.trackWorkerMotion(frame);
    if (this.workerLoading) return true;
    if (this.forceRequested && this.worker) {
      this.worker.forceRender();
      this.forceRequested = false;
    }
    if (
      this.worker?.draw(
        frame,
        this.interactionEpoch || this.pointers.size > 0 || this.wheel || this.timer !== undefined
      )
    ) {
      this.release();
      return true;
    }
    const { scope, model, mode } = frame;
    if (!model.periods.length) {
      this.release();
      return false;
    }
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
    const start = Math.max(0, Math.floor(frame.from) - 1),
      end = Math.min(model.data.length - 1, Math.ceil(frame.to) + 1);
    const heavy = model.periods.length >= 30 && (end - start + 1) * model.periods.length >= 8192;
    if (
      firstX === null ||
      nextX === null ||
      !Number.isFinite(firstX) ||
      !Number.isFinite(nextX) ||
      nextX <= firstX ||
      (nextX - firstX >= 1 && !heavy)
    ) {
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
      const covered = this.covers(frame, cached, matrix) && previewScale;
      // A settled ordinary frame draws its exact native range, but keeps the padded capture
      // available for the next gesture until coverage or data actually changes.
      if (covered && cached.previewOnly && !changedData && (this.ready || !changedGeometry))
        return false;
      if (
        covered &&
        ((!changedGeometry && !changedData) || (!this.ready && (!changedData || held)))
      ) {
        // Extra offscreen segments can affect wide stroke joins. Settled ordinary frames must
        // use precisely the caller's native range; keep the expanded raster for movement only.
        if (cached.previewOnly && !changedGeometry) return false;
        this.blit(scope.context, cached, matrix);
        return true;
      }
    }
    // Padding captures offscreen price geometry at unchanged device resolution.
    const factor = Math.min(
      1.4,
      Math.sqrt((4 * 1024 * 1024) / (size.width * size.height)),
      4096 / size.width,
      4096 / size.height
    );
    let padPixelsX = Math.floor((size.width * (factor - 1)) / 2);
    const padPixelsY = Math.floor((size.height * (factor - 1)) / 2);
    const ordinary = nextX - firstX >= 1;
    if (ordinary && end - start <= 3000) {
      // Keep the existing Y reserve; use the remaining bounded surface for up to one X screen
      // per side. Tall high-DPR panes receive less horizontal padding rather than more memory.
      const rasterWidth = Math.min(
        size.width * 3,
        4096,
        Math.floor((4 * 1024 * 1024) / (size.height + padPixelsY * 2))
      );
      padPixelsX = Math.max(0, Math.floor((rasterWidth - size.width) / 2));
    }
    // Extend only unsampled ordinary-spacing paths: changing a dense sampling phase is unsafe.
    const extra =
      ordinary && end - start <= 3000
        ? Math.min(
            Math.ceil(padPixelsX / horizontalRatio / (nextX - firstX)),
            Math.floor((3000 - (end - start)) / 2)
          )
        : 0;
    const captureStart = Math.max(0, start - extra),
      captureEnd = Math.min(model.data.length - 1, end + extra);
    const extend = extra > 0 && captureEnd - captureStart <= 3000;
    const indices = extend ? [captureStart, captureEnd] : [start, end];
    if (indices[1]! - indices[0]! < 2) return false;
    // SMA warmup remains in the prefix; only bounds for actually captured geometry are needed.
    // Dense sampling keeps its original whole-history domain and phase.
    const domain = ordinary
      ? model.extrema(indices[0]!, indices[1]!)
      : model.extrema(0, model.data.length - 1);
    if (!domain || !(domain.maxValue > domain.minValue) || model.data.length < 2) return false;
    // LW's public logicalToCoordinate accepts bar indices; fractional probes can return zero.
    indices.push(Math.floor((indices[0]! + indices[1]!) / 2));
    const prices = [domain.minValue, domain.maxValue, (domain.minValue + domain.maxValue) / 2];
    const x = indices.map((index) => frame.xFor(index)),
      y = prices.map((price) => frame.yFor(price));
    if (!finite(x) || !finite(y) || x[0] === x[1] || y[0] === y[1]) return false;
    this.release(); // Never retain two full-size raster allocations.
    let surface: HTMLCanvasElement | OffscreenCanvas | null;
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
    frame.paint(
      context,
      extend ? frame.from - extra : frame.from,
      extend ? frame.to + extra : frame.to
    );
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
      fullHistory: indices[0] === 0 && indices[1] === model.data.length - 1,
      previewOnly: indices[0] !== start || indices[1] !== end
    };
    this.cached = cached;
    this.observed = identity;
    this.cancelTimer();
    if (cached.previewOnly) return false;
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
    this.finishWorkerLoad();
    this.worker?.destroy();
    this.stopInput();
    this.cancelTimer();
    this.pointers.clear();
    this.release();
  }
  pending(): boolean {
    return !this.disposed && (this.workerLoading || (this.worker?.pending() ?? false));
  }
  invalidate(active = false): void {
    this.worker?.invalidate(active);
  }
  forceRender(): void {
    this.forceRequested = true;
    this.wheel = false;
    this.cancelTimer();
    this.interactionEpoch = this.pointers.size > 0;
    this.workerCamera = undefined;
  }
  workerStatus(): MtpWorkerStatus {
    return (
      this.worker?.status() ?? {
        state: this.disposed
          ? "destroyed"
          : this.workerLoading
            ? "loading"
            : this.workerLoadError !== undefined
              ? "fallback"
              : "off",
        pending: this.pending(),
        dispatched: 0,
        completed: 0,
        stale: 0,
        ...(this.workerLoadError === undefined ? {} : { reason: this.workerLoadError })
      }
    );
  }
}
