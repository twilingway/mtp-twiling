import { lineColor } from "../model/candle-palette.js";
import { slopedPriceAt } from "../model/technical-indicators/catalog-expansion/auto-sloped-geometry.js";
import type {
  TechnicalSlopedBand,
  TechnicalSlopedDecoration,
  TechnicalSlopedLine
} from "../model/technical-indicators/catalog-expansion/auto-sloped-geometry.js";
import type { PitchforkLine } from "../model/technical-indicators/ta-batch-fib-geometry.js";

interface SlopedStyle {
  readonly color: string;
  readonly opacity: number;
  readonly width: number;
  readonly lineStyle: "solid" | "dashed" | "dotted";
}
export type RenderedSlopedDecoration = TechnicalSlopedDecoration & SlopedStyle;

export interface SlopedViewport {
  readonly width: number;
  readonly height: number;
  readonly firstIndex: number;
  readonly lastIndex: number;
  x(index: number): number | null;
  y(value: number): number | null;
}

/** Use the native candle origin and bar spacing, including fractional and future slots. */
export function slopedViewportX(
  width: number,
  index: number,
  coordinate: number | null,
  spacing: number
): Pick<SlopedViewport, "firstIndex" | "lastIndex" | "x"> | null {
  if (
    coordinate === null ||
    !Number.isFinite(coordinate) ||
    !Number.isFinite(spacing) ||
    spacing <= 0
  )
    return null;
  return {
    firstIndex: index - coordinate / spacing,
    lastIndex: index + (width - coordinate) / spacing,
    x: (target) => coordinate + (target - index) * spacing
  };
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

const dashes = { solid: [], dashed: [5, 4], dotted: [2, 3] };
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

function sampleLine(
  line: PitchforkLine,
  index: number,
  viewport: SlopedViewport
): ScreenPoint | null {
  const value = slopedPriceAt(line, index);
  if (!Number.isFinite(value)) return null;
  const y = viewport.y(value),
    x = viewport.x(index);
  return finite(x) && finite(y) ? { x, y } : null;
}

function* sampleIndices(region: TechnicalSlopedDecoration, viewport: SlopedViewport) {
  const first = Math.max(region.startIndex ?? -Infinity, viewport.firstIndex);
  const last = Math.min(region.endIndex ?? Infinity, viewport.lastIndex);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last) return;
  const left = viewport.x(first),
    right = viewport.x(last);
  if (!finite(left) || !finite(right)) return;
  const steps = Math.max(1, Math.min(256, Math.ceil(Math.abs(right - left) / 8)));
  for (let step = 0; step <= steps; step++)
    yield step === steps ? last : first + (last - first) * (step / steps);
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  region: TechnicalSlopedLine & SlopedStyle,
  viewport: SlopedViewport
) {
  ctx.strokeStyle = lineColor(region.color, region.opacity);
  ctx.lineWidth = region.width;
  ctx.setLineDash(dashes[region.lineStyle]);
  ctx.beginPath();
  let previous = false;
  for (const index of sampleIndices(region, viewport)) {
    const point = sampleLine(region.line, index, viewport);
    if (!point) {
      previous = false;
      continue;
    }
    if (previous) ctx.lineTo(point.x, point.y);
    else ctx.moveTo(point.x, point.y);
    previous = true;
  }
  ctx.stroke();
}

function fillBand(
  ctx: CanvasRenderingContext2D,
  region: TechnicalSlopedBand & SlopedStyle,
  viewport: SlopedViewport
) {
  ctx.fillStyle = lineColor(region.color, region.fillOpacity * region.opacity);
  let pairs: { upper: ScreenPoint; lower: ScreenPoint }[] = [];
  const fill = () => {
    if (pairs.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pairs[0]!.upper.x, pairs[0]!.upper.y);
      for (const { upper } of pairs.slice(1)) ctx.lineTo(upper.x, upper.y);
      for (let i = pairs.length - 1; i >= 0; i--) {
        const { lower } = pairs[i]!;
        ctx.lineTo(lower.x, lower.y);
      }
      ctx.closePath();
      ctx.fill();
    }
    pairs = [];
  };
  for (const index of sampleIndices(region, viewport)) {
    const upper = sampleLine(region.upper, index, viewport);
    const lower = sampleLine(region.lower, index, viewport);
    if (upper && lower) pairs.push({ upper, lower });
    else fill();
  }
  fill();
}

export function paintTechnicalSloped(
  ctx: CanvasRenderingContext2D,
  regions: readonly RenderedSlopedDecoration[],
  viewport: SlopedViewport
): void {
  if (!regions.length || viewport.width <= 0 || viewport.height <= 0) return;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, viewport.width, viewport.height);
    ctx.clip();
    for (const region of regions)
      if (region.kind === "sloped-band") fillBand(ctx, region, viewport);
    for (const region of regions)
      if (region.kind === "sloped-line") strokeLine(ctx, region, viewport);
  } finally {
    ctx.restore();
  }
}
