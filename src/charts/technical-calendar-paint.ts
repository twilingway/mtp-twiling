import { intlLocale } from "../i18n/preferences.js";
import type { Locale } from "../i18n/preferences.js";
import { lineColor } from "../model/candle-palette.js";
import type {
  TechnicalCandleTint,
  TechnicalPriceCircle,
  TechnicalPriceDecoration,
  TechnicalPriceRegion
} from "../model/technical-indicators/catalog-expansion/calendar-geometry.js";
import type {
  OutputStyle,
  TechnicalIndicatorDefinition
} from "../model/technical-indicators/types.js";
import type { RenderedSlopedDecoration } from "./technical-sloped-paint.js";

interface RegionStyle {
  color: string;
  opacity: number;
  width: number;
  lineStyle: "solid" | "dashed" | "dotted";
}

export type RenderedPriceRegion = TechnicalPriceRegion & RegionStyle;
export type RenderedMoonDecoration = (TechnicalCandleTint | TechnicalPriceCircle) & RegionStyle;
export type RenderedPriceDecoration = TechnicalPriceDecoration & RegionStyle;

export function priceDecorationLayers(values: readonly RenderedPriceDecoration[]) {
  const regions: RenderedPriceRegion[] = [];
  const moon: RenderedMoonDecoration[] = [];
  const sloped: RenderedSlopedDecoration[] = [];
  for (const value of values) {
    if (!("kind" in value)) regions.push(value);
    else if (value.kind === "candle-tint" || value.kind === "price-circle") moon.push(value);
    else sloped.push(value);
  }
  return { regions, moon, sloped };
}

export function compileTechnicalPriceRegions(
  regions: readonly TechnicalPriceDecoration[],
  styles: NonNullable<TechnicalIndicatorDefinition["priceRegionStyles"]>,
  custom?: Readonly<Record<string, OutputStyle>>
): RenderedPriceDecoration[] {
  const byId = new Map(styles.map((style) => [style.id, style]));
  return regions.flatMap((region) => {
    const style = byId.get(region.styleId);
    if (!style) return [];
    const stored = custom?.[region.styleId];
    const opacity = stored?.opacity ?? style.opacity;
    if (stored?.visible === false || opacity === 0) return [];
    return [
      {
        ...region,
        color: stored?.color ?? style.color,
        opacity,
        width: stored?.width ?? 1,
        lineStyle: stored?.lineStyle ?? "solid"
      }
    ];
  });
}

export function calendarRegionLabels(locale: Locale = "ru") {
  const integers = new Intl.NumberFormat(intlLocale(locale));
  return (label: TechnicalPriceRegion["label"], price: (value: number) => string): string => {
    if (!label) return "";
    const parts = [];
    if (label.name) parts.push(label.name);
    if (label.price !== undefined) parts.push(price(label.price));
    if (label.tickRange !== undefined)
      parts.push(`${integers.format(label.tickRange)} ${locale === "en" ? "ticks" : "тиков"}`);
    if (label.averagePrice !== undefined)
      parts.push(`${locale === "en" ? "Avg" : "Средняя"} ${price(label.averagePrice)}`);
    return parts.join(" · ");
  };
}

interface RegionViewport {
  readonly width: number;
  readonly height: number;
  readonly halfBar: number;
  readonly firstVisibleTime?: number;
  readonly lastVisibleTime?: number;
  x(timestamp: number): number | null;
  y(price: number): number | null;
  label(data: TechnicalPriceRegion["label"]): string;
}

const dashes = { solid: [], dashed: [5, 4], dotted: [2, 3] };
const coordinate = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

export function paintTechnicalPriceRegions(
  ctx: CanvasRenderingContext2D,
  regions: readonly RenderedPriceRegion[],
  viewport: RegionViewport
): void {
  const { width, height, halfBar, firstVisibleTime, lastVisibleTime } = viewport;
  if (!regions.length || width <= 0 || height <= 0) return;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "top";
    for (const region of regions) {
      if (
        (!region.extendLeft &&
          lastVisibleTime !== undefined &&
          region.startTimestamp > lastVisibleTime) ||
        (firstVisibleTime !== undefined &&
          region.endTimestamp !== null &&
          region.endTimestamp < firstVisibleTime)
      )
        continue;
      const start = region.extendLeft ? 0 : viewport.x(region.startTimestamp);
      const end = region.endTimestamp === null ? width : viewport.x(region.endTimestamp);
      const high = viewport.y(region.high);
      const low = viewport.y(region.low);
      if (!coordinate(start) || !coordinate(end) || !coordinate(high) || !coordinate(low)) continue;

      const left = start - (!region.extendLeft && region.startEdge === "left" ? halfBar : 0);
      const right =
        end + (region.endEdge === "right" && region.endTimestamp !== null ? halfBar : 0);
      const top = Math.min(high, low),
        bottom = Math.max(high, low);
      if (right <= left || right < 0 || left > width || bottom < 0 || top > height) continue;
      const visibleLeft = Math.max(0, left),
        visibleRight = Math.min(width, right);
      const line = (y: number) => {
        ctx.beginPath();
        ctx.moveTo(visibleLeft, y);
        ctx.lineTo(visibleRight, y);
        ctx.stroke();
      };

      ctx.strokeStyle = lineColor(
        region.color,
        top === bottom ? region.opacity : Math.min(1, region.opacity * 2)
      );
      ctx.lineWidth = region.width;
      ctx.setLineDash(dashes[region.lineStyle]);
      if (top === bottom) line(top);
      else {
        ctx.fillStyle = lineColor(region.color, region.opacity);
        ctx.fillRect(
          visibleLeft,
          Math.max(0, top),
          visibleRight - visibleLeft,
          Math.min(height, bottom) - Math.max(0, top)
        );
        if (region.extendLeft || region.endTimestamp === null) {
          ctx.beginPath();
          ctx.moveTo(left, top);
          ctx.lineTo(right, top);
          if (region.endTimestamp !== null) ctx.lineTo(right, bottom);
          else ctx.moveTo(right, bottom);
          ctx.lineTo(left, bottom);
          if (!region.extendLeft) ctx.lineTo(left, top);
          ctx.stroke();
        } else ctx.strokeRect(left, top, right - left, bottom - top);
      }
      for (const guide of region.guides ?? []) {
        const y = viewport.y(guide.price);
        if (!coordinate(y)) continue;
        ctx.setLineDash(dashes[guide.kind]);
        line(y);
      }
      const label = viewport.label(region.label);
      const atRight = region.labelEdge === "right";
      const textWidth = (atRight ? visibleRight : width) - visibleLeft - 8;
      if (label && textWidth > 12 && bottom + 3 < height) {
        ctx.fillStyle = region.color;
        ctx.textAlign = atRight ? "right" : "left";
        ctx.fillText(label, atRight ? visibleRight - 4 : visibleLeft + 4, bottom + 3, textWidth);
      }
    }
  } finally {
    ctx.restore();
  }
}
