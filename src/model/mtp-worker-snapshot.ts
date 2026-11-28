import type { MtpRasterFrame } from "./mtp-raster-cache.js";
import type { MtpWorkerFrame } from "./mtp-worker-protocol.js";

export interface MtpWorkerIntent {
  key: string;
  dataKey: string;
  revision: number;
  resetRevision: number;
  model: MtpRasterFrame["model"];
  priceHigh: number;
  frame: MtpWorkerFrame;
}

/** Capture SDK coordinates at the actual draw, never predict LW's X rounding. */
export function mtpWorkerIntent(source: MtpRasterFrame): MtpWorkerIntent | null {
  const { scope, model, mode } = source;
  const size = scope.bitmapSize;
  const horizontalRatio = scope.horizontalPixelRatio;
  const verticalRatio = scope.verticalPixelRatio;
  const context = scope.context;
  if (
    (mode !== 0 && mode !== 2 && mode !== 3) ||
    !size ||
    ![size.width, size.height, horizontalRatio, verticalRatio].every(Number.isFinite) ||
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > 4096 ||
    size.height > 4096 ||
    size.width * size.height > 4 * 1024 * 1024 ||
    horizontalRatio <= 0 ||
    verticalRatio <= 0 ||
    context.globalCompositeOperation !== "source-over" ||
    context.filter !== "none" ||
    context.shadowBlur !== 0 ||
    context.shadowOffsetX !== 0 ||
    context.shadowOffsetY !== 0 ||
    !model.periods.length
  )
    return null;
  const start = Math.max(0, Math.floor(source.from) - 1);
  const end = Math.min(model.data.length - 1, Math.ceil(source.to) + 1);
  if (end < start) return null;
  // Native SDK conversion of a nonfinite SMA is deliberately retained by the fallback path.
  if (!model.prefix.subarray(0, model.data.length + 1).every(Number.isFinite)) return null;
  const domain = model.extrema(start, end);
  if (!domain) return null;
  const low = domain.minValue;
  const high = domain.maxValue;
  const span = high - low;
  if (
    !Number.isFinite(span) ||
    span <= Math.max(1, Math.abs(low), Math.abs(high)) * Number.EPSILON * 32
  )
    return null;
  const middle = low + span / 2;
  const lowY = source.yFor(low);
  const highY = source.yFor(high);
  const middleY = source.yFor(middle);
  if (
    lowY === null ||
    highY === null ||
    middleY === null ||
    ![lowY, highY, middleY].every(Number.isFinite)
  )
    return null;
  const slope = (highY - lowY) / span;
  if (!Number.isFinite(slope) || Math.abs(lowY + (middle - low) * slope - middleY) > 1e-7)
    return null;
  const styles = model.paintStyles();
  // Dense lookup is O(bars), without repeating the worker's O(periods * samples) walk.
  const x = new Float64Array(end - start + 1);
  for (let index = start; index <= end; index++) x[index - start] = source.xFor(index) ?? NaN;
  const dataKey = JSON.stringify([
    model.revision,
    model.resetRevision,
    model.data.length,
    model.data[0]?.timestamp,
    model.data.at(-1)?.timestamp,
    model.data.at(-1)?.close
  ]);
  const factor = Math.min(
    1.4,
    Math.sqrt((4 * 1024 * 1024) / (size.width * size.height)),
    4096 / size.width,
    4096 / size.height
  );
  const padX = Math.floor((size.width * (factor - 1)) / 2);
  const padY = Math.floor((size.height * (factor - 1)) / 2);
  const frame: MtpWorkerFrame = {
    dataKey,
    length: model.data.length,
    start,
    end,
    x,
    priceOrigin: low,
    yOrigin: lowY,
    ySlope: slope,
    styles,
    width: size.width + padX * 2,
    height: size.height + padY * 2,
    padX,
    padY,
    horizontalRatio,
    verticalRatio,
    lineCap: context.lineCap,
    lineJoin: context.lineJoin,
    miterLimit: context.miterLimit,
    shadowColor: context.shadowColor
  };
  // Include exact visited X and affine anchors, not only an earlier event/camera token.
  const key = JSON.stringify([
    dataKey,
    source.from,
    source.to,
    mode,
    { ...frame, x: Array.from(x) },
    middleY,
    model.styleKey,
    model.styles
  ]);
  return {
    key,
    dataKey,
    model,
    priceHigh: high,
    revision: model.revision,
    resetRevision: model.resetRevision,
    frame
  };
}
