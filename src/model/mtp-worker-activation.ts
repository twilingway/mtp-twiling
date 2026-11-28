import type { MtpRasterEnvironment, MtpRasterFrame } from "./mtp-raster-types.js";
import type { MtpWorkerRasterCache } from "./mtp-worker-raster-cache.js";

type WorkerModule = { MtpWorkerRasterCache: typeof MtpWorkerRasterCache };
export type MtpWorkerMode = "auto" | "native" | "worker";
export function mtpWorkerMode(enabled: boolean, search: string): MtpWorkerMode {
  const value = new URLSearchParams(search).get("mtpRaster");
  return !enabled || value === "native" ? "native" : value === "worker" ? "worker" : "auto";
}

/** Auto activation performs no history traversal, prefix copies or SDK projection work. */
export function mtpWorkerEligible({
  scope,
  model,
  mode,
  from,
  to,
  uniformX
}: MtpRasterFrame): boolean {
  const size = scope.bitmapSize;
  const context = scope.context;
  const start = Math.max(0, Math.floor(from) - 1);
  const end = Math.min(model.data.length - 1, Math.ceil(to) + 1);
  return (
    uniformX === "lightweight" &&
    model.data.length > 0 &&
    model.periods.length >= 30 &&
    Math.max(0, end - start + 1) * model.periods.length >= 8192 &&
    (mode === 0 || mode === 2 || mode === 3) &&
    !!size &&
    [size.width, size.height, scope.horizontalPixelRatio, scope.verticalPixelRatio].every(
      Number.isFinite
    ) &&
    Number.isInteger(size.width) &&
    Number.isInteger(size.height) &&
    size.width > 0 &&
    size.height > 0 &&
    size.width <= 4096 &&
    size.height <= 4096 &&
    size.width * size.height <= 4 * 1024 * 1024 &&
    scope.horizontalPixelRatio > 0 &&
    scope.verticalPixelRatio > 0 &&
    context.globalCompositeOperation === "source-over" &&
    context.filter === "none" &&
    context.shadowBlur === 0 &&
    context.shadowOffsetX === 0 &&
    context.shadowOffsetY === 0
  );
}

/** One bounded module load; cancellation also rejects late completion after timeout/destroy. */
export function loadMtpWorker(
  environment: MtpRasterEnvironment,
  complete: (module: WorkerModule | undefined, reason?: string) => void
): () => void {
  let active = true;
  let timer: unknown;
  const cancel = () => {
    active = false;
    if (timer !== undefined) environment.cancel(timer);
    timer = undefined;
  };
  const finish = (module: WorkerModule | undefined, reason?: string) => {
    if (!active) return;
    cancel();
    complete(module, reason);
  };
  timer = environment.delay(() => finish(undefined, "worker-module-deadline"), 5000);
  void Promise.resolve()
    .then(() => environment.loadWorker?.() ?? import("./mtp-worker-raster-cache.js"))
    .then(
      (module) => finish(module),
      () => finish(undefined, "worker-module-load-error")
    );
  return cancel;
}
