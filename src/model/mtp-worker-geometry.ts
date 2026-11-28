import type { MtpRasterFrame } from "./mtp-raster-cache.js";
import type { MtpWorkerIntent } from "./mtp-worker-snapshot.js";

export interface MtpWorkerMatrix {
  xScale: number;
  yScale: number;
  xOffset: number;
  yOffset: number;
}
export const MTP_IDENTITY: MtpWorkerMatrix = { xScale: 1, yScale: 1, xOffset: 0, yOffset: 0 };
export interface MtpWorkerGeometry {
  contentKey: string;
  from: number;
  to: number;
  fast: boolean;
  indices: number[];
  x: number[];
  prices: number[];
  y: number[];
  width: number;
  height: number;
  bitmapWidth: number;
  bitmapHeight: number;
  padX: number;
  padY: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  start: number;
  end: number;
  fullHistory: boolean;
}
const finite = (values: readonly (number | null)[]): values is number[] =>
  values.every((value) => value !== null && Number.isFinite(value));

/** History-independent metadata: styles/periods have the fixed, bounded MTP definition size. */
export function mtpWorkerContentKey(source: MtpRasterFrame): string | null {
  const { scope, model, mode } = source;
  const size = scope.bitmapSize;
  const context = scope.context;
  if (
    (mode !== 0 && mode !== 2 && mode !== 3) ||
    !size ||
    ![size.width, size.height, scope.horizontalPixelRatio, scope.verticalPixelRatio].every(
      Number.isFinite
    ) ||
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > 4096 ||
    size.height > 4096 ||
    size.width * size.height > 4 * 1024 * 1024 ||
    scope.horizontalPixelRatio <= 0 ||
    scope.verticalPixelRatio <= 0 ||
    context.globalCompositeOperation !== "source-over" ||
    context.filter !== "none" ||
    context.shadowBlur !== 0 ||
    context.shadowOffsetX !== 0 ||
    context.shadowOffsetY !== 0 ||
    !model.periods.length ||
    !model.data.length
  )
    return null;
  return JSON.stringify([
    model.revision,
    model.resetRevision,
    model.data.length,
    model.data[0]?.timestamp,
    model.data.at(-1)?.timestamp,
    model.data.at(-1)?.close,
    model.styleKey,
    model.styles,
    model.periods,
    mode,
    size.width,
    size.height,
    scope.horizontalPixelRatio,
    scope.verticalPixelRatio,
    context.lineCap,
    context.lineJoin,
    context.miterLimit,
    context.shadowColor,
    source.uniformX
  ]);
}

/** Called only beside a full snapshot, before its X buffer is transferred. */
export function mtpWorkerGeometry(
  source: MtpRasterFrame,
  intent: MtpWorkerIntent,
  contentKey: string
): MtpWorkerGeometry {
  const { frame } = intent;
  const middle = Math.floor((frame.start + frame.end) / 2);
  const indices = [frame.start, frame.end, middle];
  const x = indices.map((index) => frame.x[index - frame.start] ?? NaN);
  const prices = [frame.priceOrigin, intent.priceHigh, (frame.priceOrigin + intent.priceHigh) / 2];
  const y = prices.map((price) => source.yFor(price) ?? NaN);
  // The explicit LW contract plus unchanged logical range/dimensions identifies its exact
  // deterministic mapping, including SDK rounding. Generic callbacks never enter this path.
  const fast =
    source.uniformX === "lightweight" &&
    frame.end > frame.start &&
    frame.x.every(Number.isFinite) &&
    y.every(Number.isFinite) &&
    x[1]! > x[0]!;
  const margin =
    Math.max(1, ...frame.styles.map((style) => style.width)) * Math.max(1, frame.miterLimit) +
    1 / Math.min(frame.horizontalRatio, frame.verticalRatio);
  return {
    contentKey,
    from: source.from,
    to: source.to,
    fast,
    indices,
    x,
    prices,
    y,
    width: (frame.width - frame.padX * 2) / frame.horizontalRatio,
    height: (frame.height - frame.padY * 2) / frame.verticalRatio,
    bitmapWidth: frame.width / frame.horizontalRatio,
    bitmapHeight: frame.height / frame.verticalRatio,
    padX: frame.padX / frame.horizontalRatio,
    padY: frame.padY / frame.verticalRatio,
    left: x[0]! - margin,
    right: x[1]! + margin,
    top: Math.min(y[0]!, y[1]!) - margin,
    bottom: Math.max(y[0]!, y[1]!) + margin,
    start: frame.start,
    end: frame.end,
    fullHistory: frame.start === 0 && frame.end === frame.length - 1
  };
}

/** Three native X/Y probes validate the known LW mapping at this actual draw. */
export function mtpWorkerMatrix(
  source: MtpRasterFrame,
  geometry: MtpWorkerGeometry
): MtpWorkerMatrix | null {
  if (!geometry.fast || source.uniformX !== "lightweight") return null;
  const x = geometry.indices.map((index) => source.xFor(index));
  const y = geometry.prices.map((price) => source.yFor(price));
  if (!finite(x) || !finite(y)) return null;
  const xScale = (x[1]! - x[0]!) / (geometry.x[1]! - geometry.x[0]!);
  const yScale = (y[1]! - y[0]!) / (geometry.y[1]! - geometry.y[0]!);
  const xOffset = x[0]! - xScale * geometry.x[0]!;
  const yOffset = y[0]! - yScale * geometry.y[0]!;
  if (
    ![xScale, yScale, xOffset, yOffset].every(Number.isFinite) ||
    xScale <= 0 ||
    yScale <= 0 ||
    Math.abs(xScale * geometry.x[2]! + xOffset - x[2]!) > 1e-6 ||
    Math.abs(yScale * geometry.y[2]! + yOffset - y[2]!) > 1e-7
  )
    return null;
  return { xScale, yScale, xOffset, yOffset };
}

export function mtpWorkerExact(source: MtpRasterFrame, geometry: MtpWorkerGeometry): boolean {
  if (
    !geometry.fast ||
    source.uniformX !== "lightweight" ||
    source.from !== geometry.from ||
    source.to !== geometry.to
  )
    return false;
  return (
    geometry.indices.every((index, offset) => source.xFor(index) === geometry.x[offset]) &&
    geometry.prices.every((price, offset) => source.yFor(price) === geometry.y[offset])
  );
}

/** A preview may reveal only captured strokes or regions proven empty by the SMA bounds. */
export function mtpWorkerCovered(
  source: MtpRasterFrame,
  geometry: MtpWorkerGeometry,
  matrix: MtpWorkerMatrix
): boolean {
  const start = Math.max(0, Math.floor(source.from) - 1);
  const end = Math.min(source.model.data.length - 1, Math.ceil(source.to) + 1);
  if (
    start < geometry.start ||
    end > geometry.end ||
    matrix.xScale < 0.5 ||
    matrix.xScale > 2 ||
    matrix.yScale < 0.5 ||
    matrix.yScale > 2
  )
    return false;
  let left = -matrix.xOffset / matrix.xScale;
  let right = (geometry.width - matrix.xOffset) / matrix.xScale;
  if (geometry.fullHistory) {
    left = Math.max(left, geometry.left);
    right = Math.min(right, geometry.right);
  }
  const top = Math.max(-matrix.yOffset / matrix.yScale, geometry.top);
  const bottom = Math.min((geometry.height - matrix.yOffset) / matrix.yScale, geometry.bottom);
  return (
    left > right ||
    top > bottom ||
    (left >= -geometry.padX &&
      right <= geometry.width + geometry.padX &&
      top >= -geometry.padY &&
      bottom <= geometry.height + geometry.padY)
  );
}
