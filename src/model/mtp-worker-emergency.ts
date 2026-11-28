import type { MtpRasterFrame } from "./mtp-raster-types.js";
import type { MtpPaintStyle } from "./mtp-worker-protocol.js";

export const MTP_EMERGENCY_POINT_LIMIT = 32;
export const MTP_EMERGENCY_VERTEX_LIMIT = 4096;
export interface MtpEmergencyStats {
  attempts: number;
  paints: number;
  vertices: number;
  lastVertices: number;
  timeMs: number;
  maxMs: number;
  rejected: number;
  cancelled: number;
}
interface Line {
  style: MtpPaintStyle;
  indices: number[];
  values: (number | null)[];
}
interface Prepared {
  lines: Line[];
  x: Map<number, number | null>;
  low: number;
  lowY: number;
  slope: number;
  current(): boolean;
}

function prepare(source: MtpRasterFrame, allowed: () => boolean): Prepared | null {
  const { model, scope, mode } = source;
  const size = scope.bitmapSize;
  const ctx = scope.context;
  if (
    source.uniformX !== "lightweight" ||
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
    ctx.globalCompositeOperation !== "source-over" ||
    ctx.filter !== "none" ||
    ctx.shadowBlur !== 0 ||
    ctx.shadowOffsetX !== 0 ||
    ctx.shadowOffsetY !== 0 ||
    !model.periods.length ||
    model.periods.length > MTP_EMERGENCY_VERTEX_LIMIT / 2 ||
    !model.data.length ||
    !Number.isFinite(source.from) ||
    !Number.isFinite(source.to) ||
    !allowed()
  )
    return null;
  const data = model.data,
    prefix = model.prefix,
    revision = model.revision,
    reset = model.resetRevision,
    length = data.length,
    from = source.from,
    to = source.to,
    width = size.width,
    height = size.height,
    horizontalRatio = scope.horizontalPixelRatio,
    verticalRatio = scope.verticalPixelRatio,
    lineCap = ctx.lineCap,
    lineJoin = ctx.lineJoin,
    miterLimit = ctx.miterLimit,
    shadowColor = ctx.shadowColor;
  const styles = model.paintStyles(),
    styleKey = model.styleKey;
  const start = Math.max(0, Math.floor(source.from) - 1);
  const end = Math.min(data.length - 1, Math.ceil(source.to) + 1);
  const cap = Math.min(
    MTP_EMERGENCY_POINT_LIMIT,
    Math.floor(MTP_EMERGENCY_VERTEX_LIMIT / styles.length)
  );
  const lines: Line[] = [],
    x = new Map<number, number | null>();
  let low = Infinity,
    high = -Infinity;
  for (const style of styles) {
    if (!allowed() || !Number.isInteger(style.period) || style.period <= 0) return null;
    const first = Math.max(start, style.period - 1);
    if (first > end) continue;
    const count = Math.min(cap, end - first + 1),
      indices: number[] = [],
      values: (number | null)[] = [];
    for (let point = 0; point < count; point++) {
      const index = count === 1 ? first : first + Math.floor((point * (end - first)) / (count - 1));
      const value = model.sma(index, style.period);
      indices.push(index);
      values.push(value);
      if (value !== null && Number.isFinite(value)) {
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      if (!x.has(index)) {
        const coordinate = source.xFor(index);
        x.set(index, coordinate !== null && Number.isFinite(coordinate) ? coordinate : null);
      }
    }
    lines.push({ style, indices, values });
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || !allowed()) return null;
  const span = high - low;
  if (span !== 0 && span <= Math.max(1, Math.abs(low), Math.abs(high)) * Number.EPSILON * 32)
    return null;
  const middle = low + span / 2;
  const lowY = source.yFor(low),
    highY = source.yFor(high),
    middleY = source.yFor(middle);
  if (
    lowY === null ||
    highY === null ||
    middleY === null ||
    ![lowY, highY, middleY].every(Number.isFinite)
  )
    return null;
  const slope = span === 0 ? 0 : (highY - lowY) / span;
  if (
    !Number.isFinite(slope) ||
    Math.abs(lowY + (middle - low) * slope - middleY) > 1e-7 ||
    (span === 0 && lowY !== highY)
  )
    return null;
  const current = () => {
    if (
      !allowed() ||
      model.revision !== revision ||
      model.resetRevision !== reset ||
      model.data !== data ||
      model.prefix !== prefix ||
      model.data.length !== length ||
      model.periods.length !== styles.length ||
      model.styleKey !== styleKey ||
      source.model !== model ||
      source.scope !== scope ||
      scope.context !== ctx ||
      source.mode !== mode ||
      source.uniformX !== "lightweight" ||
      source.from !== from ||
      source.to !== to ||
      scope.bitmapSize?.width !== width ||
      scope.bitmapSize.height !== height ||
      scope.horizontalPixelRatio !== horizontalRatio ||
      scope.verticalPixelRatio !== verticalRatio ||
      ctx.lineCap !== lineCap ||
      ctx.lineJoin !== lineJoin ||
      ctx.miterLimit !== miterLimit ||
      ctx.shadowColor !== shadowColor ||
      ctx.globalCompositeOperation !== "source-over" ||
      ctx.filter !== "none" ||
      ctx.shadowBlur !== 0 ||
      ctx.shadowOffsetX !== 0 ||
      ctx.shadowOffsetY !== 0
    )
      return false;
    const fresh = model.paintStyles();
    return (
      fresh.length === styles.length &&
      fresh.every((style, i) => {
        const old = styles[i]!;
        return (
          style.period === old.period &&
          style.color === old.color &&
          style.width === old.width &&
          style.opacity === old.opacity
        );
      })
    );
  };
  return { lines, x, low, lowY, slope, current };
}

/** Temporary current-data strokes, used only when no safe bitmap pixels can be shown. */
export class MtpEmergencyPreview {
  private generation = 0;
  private readonly stats: MtpEmergencyStats = {
    attempts: 0,
    paints: 0,
    vertices: 0,
    lastVertices: 0,
    timeMs: 0,
    maxMs: 0,
    rejected: 0,
    cancelled: 0
  };
  constructor(private readonly now: () => number = () => performance.now()) {}
  status(): MtpEmergencyStats {
    return { ...this.stats };
  }
  cancel(): void {
    this.generation++;
  }
  draw(source: MtpRasterFrame, isCurrent: () => boolean = () => true): boolean {
    const begin = this.now(),
      generation = this.generation;
    const allowed = () => generation === this.generation && isCurrent();
    this.stats.attempts++;
    this.stats.lastVertices = 0;
    let painted = false;
    try {
      const frame = prepare(source, allowed);
      if (frame?.current()) {
        const ctx = source.scope.context;
        ctx.save();
        try {
          ctx.setLineDash([]);
          ctx.strokeStyle = "#1e90ff";
          ctx.lineWidth = 1;
          for (const { style, indices, values } of frame.lines) {
            ctx.strokeStyle = style.color;
            ctx.lineWidth = style.width;
            ctx.globalAlpha = style.opacity;
            ctx.beginPath();
            let begun = false;
            for (let i = 0; i < indices.length; i++) {
              const price = values[i],
                x = frame.x.get(indices[i]!);
              const y =
                price === null || price === undefined
                  ? NaN
                  : frame.lowY + (price - frame.low) * frame.slope;
              if (x === null || x === undefined || !Number.isFinite(y)) {
                begun = false;
                continue;
              }
              if (begun) ctx.lineTo(x, y);
              else {
                ctx.moveTo(x, y);
                begun = true;
              }
              this.stats.lastVertices++;
            }
            ctx.stroke();
          }
          painted = true;
        } finally {
          ctx.restore();
        }
      }
    } catch {
      /* An unavailable SDK/canvas never blocks the exact worker path. */
    }
    const elapsed = Math.max(0, this.now() - begin);
    this.stats.timeMs += elapsed;
    this.stats.maxMs = Math.max(this.stats.maxMs, elapsed);
    if (painted) {
      this.stats.paints++;
      this.stats.vertices += this.stats.lastVertices;
    } else {
      this.stats.rejected++;
      if (!allowed()) this.stats.cancelled++;
    }
    return painted;
  }
}
