import type { Candle, IndicatorOptions, MtpKey } from "./types.js";
import { ScreenLineSimplifier } from "./screen-line-simplifier.js";
import { MtpRasterCache } from "./mtp-raster-cache.js";
// Exact periods transcribed from the user's three original Pine sources.
export const MTP_DEFINITIONS: Record<
  Exclude<MtpKey, "mtpAll">,
  { name: string; color: string; width: number; periods: number[] }
> = {
  mtp160: {
    name: "MTP160",
    color: "#1e90ff",
    width: 1,
    periods: [
      4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 49, 52,
      55, 58, 61, 64, 67, 70, 73, 76, 79, 82, 85, 88, 91, 94, 97, 100, 103, 106, 109, 112, 115, 118,
      121, 124, 127, 130, 133, 136, 139, 142, 145, 148, 151, 154, 157, 160
    ]
  },
  mtp440: {
    name: "MTP160+440",
    color: "#1e90ff",
    width: 1,
    periods: [
      164, 168, 172, 176, 180, 184, 188, 192, 196, 200, 204, 208, 212, 216, 220, 224, 228, 232, 236,
      240, 244, 248, 252, 256, 260, 265, 270, 275, 280, 285, 290, 295, 300, 305, 310, 315, 320, 325,
      330, 335, 340, 345, 350, 355, 360, 365, 370, 375, 380, 385, 390, 395, 400, 405, 410, 415, 420,
      425, 430, 435, 440
    ]
  },
  mtp640: {
    name: "MTP160+440+640",
    color: "#1e90ff",
    width: 1,
    periods: [
      446, 452, 458, 464, 470, 476, 482, 488, 494, 500, 507, 514, 521, 528, 535, 542, 549, 556, 563,
      570, 577, 584, 591, 598, 605, 612, 619, 626, 633, 640
    ]
  }
};
const originalKeys = Object.keys(MTP_DEFINITIONS) as (keyof typeof MTP_DEFINITIONS)[];
export const MTP_COMBINED_PERIODS: readonly number[] = originalKeys.flatMap(
  (key) => MTP_DEFINITIONS[key].periods
);
export const activeMtpPeriods = (flags: Partial<Record<MtpKey, boolean>>): number[] =>
  flags.mtpAll
    ? [...MTP_COMBINED_PERIODS]
    : originalKeys.filter((key) => flags[key]).flatMap((key) => MTP_DEFINITIONS[key].periods);
const periodGroup = new Map<number, MtpKey>(
  originalKeys.flatMap((key) => MTP_DEFINITIONS[key].periods.map((p) => [p, key] as const))
);
interface Bounds {
  mtpLow: number | undefined;
  mtpHigh: number | undefined;
}
export class MtpModel {
  data: readonly Candle[];
  periods: readonly number[];
  prefix: Float64Array;
  bounds: Bounds[];
  length = 0;
  revision = 0;
  resetRevision = 0;
  styles: IndicatorOptions | undefined;
  styleKey: MtpKey | undefined;
  constructor() {
    this.data = [];
    this.periods = [];
    this.prefix = new Float64Array(1);
    this.bounds = [];
  }
  reset(data: readonly Candle[], periods: readonly number[]) {
    this.revision++;
    this.resetRevision++;
    this.data = data;
    this.periods = periods;
    this.prefix = new Float64Array(Math.max(1024, data.length * 2) + 1);
    this.bounds = [];
    for (let i = 0; i < data.length; i++) {
      this.prefix[i + 1] = (this.prefix[i] ?? 0) + (data[i]?.close ?? 0);
      this.bounds.push(this.boundsAt(i));
    }
    this.length = data.length;
  }
  sma(index: number, period: number): number | null {
    if (index < period - 1 || index >= this.data.length) return null;
    return ((this.prefix[index + 1] ?? 0) - (this.prefix[index + 1 - period] ?? 0)) / period;
  }
  boundsAt(index: number): Bounds {
    let min = Infinity,
      max = -Infinity;
    for (const period of this.periods) {
      const value = this.sma(index, period);
      if (value != null) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    return {
      mtpLow: Number.isFinite(min) ? min : undefined,
      mtpHigh: Number.isFinite(max) ? max : undefined
    };
  }
  update(data: readonly Candle[]) {
    if (
      data.length < this.length ||
      data.length > this.length + 1 ||
      data.length + 1 > this.prefix.length
    ) {
      this.reset(data, this.periods);
      return;
    }
    this.data = data;
    this.revision++;
    const i = data.length - 1;
    if (i >= 0) {
      this.prefix[i + 1] = (this.prefix[i] ?? 0) + (data[i]?.close ?? 0);
      this.bounds[i] = this.boundsAt(i);
    }
    this.length = data.length;
  }
  extrema(from: number, to: number) {
    if (!this.periods.length) return null;
    let min = Infinity,
      max = -Infinity;
    for (
      let i = Math.max(0, Math.floor(from));
      i < Math.min(this.bounds.length, Math.ceil(to) + 1);
      i++
    ) {
      const b = this.bounds[i];
      if (b?.mtpLow != null && b.mtpHigh != null) {
        min = Math.min(min, b.mtpLow);
        max = Math.max(max, b.mtpHigh);
      }
    }
    return Number.isFinite(min) ? { minValue: min, maxValue: max } : null;
  }
  draw(
    ctx: CanvasRenderingContext2D,
    from: number,
    to: number,
    xFor: (index: number) => number | null,
    yFor: (price: number | null) => number | null,
    bitmap?: { verticalPixelRatio: number }
  ) {
    if (!this.periods.length) return;
    const start = Math.max(0, Math.floor(from) - 1),
      end = Math.min(this.data.length - 1, Math.ceil(to) + 1);
    if (end < start) return;
    const step = Math.max(1, Math.ceil((end - start) / 3000));
    // Every period shares the axis; keep null/nonfinite gaps and each period's sampling phase.
    const xCoordinates = new Array<number | null | undefined>(end - start + 1);
    let simplifier: ScreenLineSimplifier | undefined;
    if (
      bitmap &&
      start < end &&
      Number.isFinite(bitmap.verticalPixelRatio) &&
      bitmap.verticalPixelRatio > 0
    ) {
      const firstX = xFor(start),
        nextX = xFor(start + 1);
      xCoordinates[0] = firstX;
      if (start < end) xCoordinates[1] = nextX;
      if (firstX != null && nextX != null && nextX > firstX && nextX - firstX < 1)
        simplifier = new ScreenLineSimplifier(0.25 / bitmap.verticalPixelRatio);
    }
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1e90ff";
    ctx.lineWidth = 1;
    for (const period of this.periods) {
      const group = this.styleKey ?? periodGroup.get(period);
      const style = group ? this.styles?.[group] : undefined;
      ctx.strokeStyle = style?.color || "#1e90ff";
      ctx.lineWidth = style?.width || 1;
      ctx.globalAlpha = style?.opacity ?? 0.65;
      ctx.beginPath();
      let begun = false;
      const first = Math.max(start, period - 1);
      for (let i = first; i <= end; i += step) {
        const value = this.sma(i, period);
        const offset = i - start;
        let x = xCoordinates[offset];
        if (x === undefined) xCoordinates[offset] = x = xFor(i);
        const y = yFor(value);
        if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
          if (begun && simplifier) {
            const last = simplifier.finish();
            if (last) ctx.lineTo(last.x, last.y);
          }
          begun = false;
          continue;
        }
        if (!begun) {
          ctx.moveTo(x, y);
          simplifier?.reset(x, y);
          begun = true;
        } else if (simplifier) {
          const point = simplifier.push(x, y);
          if (point) ctx.lineTo(point.x, point.y);
        } else ctx.lineTo(x, y);
      }
      if (begun && simplifier) {
        const last = simplifier.finish();
        if (last) ctx.lineTo(last.x, last.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

export interface MtpBitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  bitmapSize?: { width: number; height: number };
}
export interface MtpDrawTarget {
  useBitmapCoordinateSpace(action: (scope: MtpBitmapScope) => void): void;
}
export interface MtpPrimitive {
  attached(params: { requestUpdate: () => void }): void;
  paneViews(): {
    zOrder: () => "normal";
    renderer: () => {
      draw(target: MtpDrawTarget): void;
      drawBackground(target: MtpDrawTarget): void;
    };
  }[];
  autoscaleInfo(
    from: number,
    to: number
  ): { priceRange: { minValue: number; maxValue: number } } | null;
  updateAllViews(): void;
}
export interface MtpChart {
  timeScale(): {
    getVisibleLogicalRange(): { from: number; to: number } | null;
    logicalToCoordinate(index: number): number | null;
  };
}
export interface MtpSeries {
  priceToCoordinate(price: number): number | null;
  priceScale?(): { options(): { mode?: number } };
  attachPrimitive(primitive: MtpPrimitive): void;
  detachPrimitive(primitive: MtpPrimitive): void;
}
function lightweightPriceProjection(series: MtpSeries, model: MtpModel, from: number, to: number) {
  const native = (price: number | null) =>
    price === null ? null : series.priceToCoordinate(price);
  const mode = series.priceScale?.().options().mode;
  // SDK 5: Normal, Percentage and IndexedTo100 are affine in the original series price.
  // Logarithmic and unknown modes must retain the SDK's native conversion.
  if (mode !== 0 && mode !== 2 && mode !== 3) return native;
  const domain = model.extrema(Math.floor(from) - 1, Math.ceil(to) + 1);
  if (!domain) return native;
  const low = domain.minValue,
    high = domain.maxValue,
    span = high - low;
  if (
    !Number.isFinite(span) ||
    span <= Math.max(1, Math.abs(low), Math.abs(high)) * Number.EPSILON * 32
  )
    return native;
  const middle = low + span / 2;
  const lowY = native(low),
    highY = native(high),
    middleY = native(middle);
  if (
    lowY == null ||
    highY == null ||
    middleY == null ||
    !Number.isFinite(lowY) ||
    !Number.isFinite(highY) ||
    !Number.isFinite(middleY)
  )
    return native;
  const slope = (highY - lowY) / span;
  if (!Number.isFinite(slope) || Math.abs(lowY + (middle - low) * slope - middleY) > 1e-7)
    return native;
  return (price: number | null) => {
    if (price === null) return null;
    if (!Number.isFinite(price)) return native(price);
    const y = lowY + (price - low) * slope;
    return Number.isFinite(y) ? y : native(price);
  };
}
export function lightweightMtp(
  chart: MtpChart,
  series: MtpSeries,
  model: MtpModel,
  container?: HTMLElement
) {
  let requestUpdate = () => {};
  const raster = new MtpRasterCache(() => requestUpdate(), container);
  const primitive: MtpPrimitive = {
    attached(params) {
      requestUpdate = params.requestUpdate;
    },
    paneViews() {
      return [
        {
          // Normal backgrounds run after the grid and before every series foreground.
          zOrder: () => "normal",
          renderer: () => ({
            draw() {},
            drawBackground(target) {
              if (!model.periods.length) return;
              const timeScale = chart.timeScale();
              const range = timeScale.getVisibleLogicalRange();
              if (!range) return;
              target.useBitmapCoordinateSpace((scope) => {
                const { context, horizontalPixelRatio, verticalPixelRatio } = scope;
                context.save();
                context.scale(horizontalPixelRatio, verticalPixelRatio);
                const xFor = (index: number) => timeScale.logicalToCoordinate(index);
                const paint = (
                  target: CanvasRenderingContext2D,
                  from = range.from,
                  to = range.to
                ) =>
                  model.draw(
                    target,
                    from,
                    to,
                    xFor,
                    lightweightPriceProjection(series, model, from, to)
                  );
                if (
                  !raster.draw({
                    scope,
                    model,
                    from: range.from,
                    to: range.to,
                    mode: series.priceScale?.().options().mode,
                    xFor,
                    yFor: (price) => series.priceToCoordinate(price),
                    paint
                  })
                )
                  paint(context);
                context.restore();
              });
            }
          })
        }
      ];
    },
    autoscaleInfo(from, to) {
      if (!model.periods.length) return null;
      const priceRange = model.extrema(from, to);
      return priceRange ? { priceRange } : null;
    },
    updateAllViews() {}
  };
  series.attachPrimitive(primitive);
  return {
    update() {
      requestUpdate();
    },
    destroy() {
      raster.destroy();
      series.detachPrimitive(primitive);
    }
  };
}
