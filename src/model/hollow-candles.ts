import type { Candle, ChartSettings } from "./types.js";
import { chartBackground, chartContrast, chartLabelText, chartPalette } from "./theme.js";

export type HollowCandlePrices = Pick<Candle, "open" | "close">;
export interface HollowCandleStyle {
  hollow: boolean;
  color: string;
  borderColor: string;
  wickColor: string;
}

/** Preserve the user's hue while keeping thin outlines visible on either theme. */
function contrastColor(color: string, background: string): string {
  if ((chartContrast(color, background) ?? 3) >= 3) return color;
  const target = chartLabelText(background);
  for (let step = 1; step <= 20; step++) {
    const mixed =
      "#" +
      [1, 3, 5]
        .map((offset) => {
          const from = Number.parseInt(color.slice(offset, offset + 2), 16);
          const to = Number.parseInt(target.slice(offset, offset + 2), 16);
          return Math.round(from + ((to - from) * step) / 20)
            .toString(16)
            .padStart(2, "0");
        })
        .join("");
    if ((chartContrast(mixed, background) ?? 3) >= 3) return mixed;
  }
  return target;
}

/** Fill follows open/close; every component's direction follows the previous close. */
export function hollowCandleStyler(settings: ChartSettings) {
  const background = chartBackground(settings);
  const visible = (color: string, show: boolean) =>
    show ? contrastColor(color, background) : "transparent";
  const palette = {
    up: {
      color: visible(settings.upColor ?? "#53b987", settings.bodyVisible !== false),
      borderColor: visible(settings.borderUpColor ?? "#53b987", settings.borderVisible !== false),
      wickColor: visible(settings.wickUpColor ?? "#336854", settings.wickVisible !== false)
    },
    down: {
      color: visible(settings.downColor ?? "#eb4d5c", settings.bodyVisible !== false),
      borderColor: visible(settings.borderDownColor ?? "#eb4d5c", settings.borderVisible !== false),
      wickColor: visible(settings.wickDownColor ?? "#7f323f", settings.wickVisible !== false)
    },
    neutral: {
      color: visible(chartPalette(settings).muted, settings.bodyVisible !== false),
      borderColor: visible(chartPalette(settings).muted, settings.borderVisible !== false),
      wickColor: visible(chartPalette(settings).muted, settings.wickVisible !== false)
    }
  };
  return (bar: HollowCandlePrices, previousClose: number | undefined): HollowCandleStyle => {
    const direction =
      previousClose === undefined || bar.close === previousClose
        ? "neutral"
        : bar.close > previousClose
          ? "up"
          : "down";
    const hollow = bar.close > bar.open;
    return { ...palette[direction], hollow, ...(hollow ? { color: "transparent" } : {}) };
  };
}
