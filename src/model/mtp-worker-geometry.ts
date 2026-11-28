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
  previewHardKey: string;
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
  historyLeft: boolean;
  historyRight: boolean;
  captureLeft: number;
  captureRight: number;
  margin: number;
}
export interface MtpWorkerReadyBitmap {
  key: string;
  bitmap: ImageBitmap;
  geometry: MtpWorkerGeometry;
}
const finite = (values: readonly (number | null)[]): values is number[] =>
  values.every((value) => value !== null && Number.isFinite(value));

/** History-independent metadata: styles/periods have the fixed, bounded MTP definition size. */
export function mtpWorkerContentKey(source: MtpRasterFrame, preview = false): string | null {
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
    // Only held previews may ignore a tail update; exact work retains both values.
    ...(preview ? [] : [model.revision, model.data.at(-1)?.close]),
    model.resetRevision,
    model.data.length,
    model.data[0]?.timestamp,
    model.data.at(-1)?.timestamp,
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
  contentKey: string,
  previewHardKey: string
): MtpWorkerGeometry {
  const { frame } = intent;
  const middle = Math.floor((frame.start + frame.end) / 2);
  const indices = [frame.start, frame.end, middle];
  const x = indices.map((index) => frame.x[index - frame.captureStart] ?? NaN);
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
  const captureLeft = frame.x[0] ?? NaN;
  const captureRight = frame.x.at(-1) ?? NaN;
  const captureY = [intent.captureLow, intent.captureHigh].map(
    (price) => frame.yOrigin + (price - frame.priceOrigin) * frame.ySlope
  );
  return {
    contentKey,
    previewHardKey,
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
    left: captureLeft - margin,
    right: captureRight + margin,
    top: Math.min(...captureY) - margin,
    bottom: Math.max(...captureY) + margin,
    start: frame.captureStart,
    end: frame.captureEnd,
    fullHistory: frame.captureStart === 0 && frame.captureEnd === frame.length - 1,
    historyLeft: frame.captureStart === 0,
    historyRight: frame.captureEnd === frame.length - 1,
    captureLeft,
    captureRight,
    margin
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
  if (geometry.historyLeft) left = Math.max(left, geometry.left);
  if (geometry.historyRight) right = Math.min(right, geometry.right);
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

export interface MtpWorkerPreviewPlan {
  matrix: MtpWorkerMatrix;
  covered: boolean;
  refill: boolean;
  uncovered: boolean;
  clip: { x: number; y: number; width: number; height: number } | null;
}

/** Missing captured bars invalidate only that part of the preview, not the whole fan. */
export function mtpWorkerPreview(
  source: MtpRasterFrame,
  geometry: MtpWorkerGeometry
): MtpWorkerPreviewPlan | undefined {
  const matrix = mtpWorkerMatrix(source, geometry);
  if (!matrix) return undefined;
  const covered = mtpWorkerCovered(source, geometry, matrix);
  const safeLeft = Math.max(-geometry.padX, geometry.captureLeft + geometry.margin);
  const safeRight = Math.min(
    geometry.width + geometry.padX,
    geometry.captureRight - geometry.margin
  );
  const leftReserve = Math.max(0, -safeLeft);
  const rightReserve = Math.max(0, safeRight - geometry.width);
  // Only real history beyond this capture can replenish a side. A history boundary or
  // zero usable allocation must not produce an identical stationary refill loop.
  const prefetch =
    (!geometry.historyLeft &&
      leftReserve > 0 &&
      -(safeLeft * matrix.xScale + matrix.xOffset) <= Math.min(48, leftReserve / 2)) ||
    (!geometry.historyRight &&
      rightReserve > 0 &&
      safeRight * matrix.xScale + matrix.xOffset - geometry.width <=
        Math.min(48, rightReserve / 2));
  if (covered) return { matrix, covered, refill: prefetch, uncovered: false, clip: null };
  const start = Math.max(0, Math.floor(source.from) - 1);
  const end = Math.min(source.model.data.length - 1, Math.ceil(source.to) + 1);
  const margin = geometry.margin;
  // A new continuation can alter the old endpoint's cap/join. Do not expose those pixels.
  const capturedLeft = start < geometry.start ? geometry.captureLeft + margin : -geometry.padX;
  const capturedRight =
    end > geometry.end ? geometry.captureRight - margin : geometry.width + geometry.padX;
  const left = Math.max(0, Math.max(-geometry.padX, capturedLeft) * matrix.xScale + matrix.xOffset);
  const right = Math.min(
    geometry.width,
    Math.min(geometry.width + geometry.padX, capturedRight) * matrix.xScale + matrix.xOffset
  );
  const top = Math.max(0, -geometry.padY * matrix.yScale + matrix.yOffset);
  const bottom = Math.min(
    geometry.height,
    (geometry.height + geometry.padY) * matrix.yScale + matrix.yOffset
  );
  const finite = [left, right, top, bottom].every(Number.isFinite);
  const clip =
    finite && right > left && bottom > top
      ? { x: left, y: top, width: right - left, height: bottom - top }
      : null;
  const epsilon = 1e-7;
  const uncovered =
    !clip ||
    clip.x > epsilon ||
    clip.y > epsilon ||
    clip.x + clip.width < geometry.width - epsilon ||
    clip.y + clip.height < geometry.height - epsilon;
  // Scale limits request a sharper raster; a finite affine, clipped image remains a valid
  // temporary projection at coarser resolution while that worker job is pending.
  const coarse =
    matrix.xScale < 0.5 || matrix.xScale > 2 || matrix.yScale < 0.5 || matrix.yScale > 2;
  return { matrix, covered: false, clip, uncovered, refill: uncovered || coarse || prefetch };
}

export function mtpWorkerPreviewScore(source: MtpRasterFrame, geometry: MtpWorkerGeometry): number {
  const plan = mtpWorkerPreview(source, geometry);
  return plan?.covered
    ? 1
    : plan?.clip
      ? (plan.clip.width * plan.clip.height) / (geometry.width * geometry.height)
      : 0;
}
