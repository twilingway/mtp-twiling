import { chartBackground, chartContrast, chartLabelText, terminalTheme } from "./theme.js";
import type { TerminalTheme } from "./theme.js";
import type { BarColors, ChartSettings } from "./types.js";

export const DEFAULT_BAR_COLORS: Readonly<Record<TerminalTheme, Required<BarColors>>> = {
  light: { upColor: "#00875a", downColor: "#d32f2f" },
  dark: { upColor: "#53b987", downColor: "#eb4d5c" }
};

function autoBarColor(color: string, alternative: string, background: string): string {
  if ((chartContrast(color, background) ?? 3) >= 3) return color;
  if ((chartContrast(alternative, background) ?? 3) >= 3) return alternative;
  const target = chartLabelText(background);
  // Retain the direction's hue on custom midtone backgrounds while increasing contrast.
  for (let step = 1; step <= 20; step++) {
    const amount = step / 20;
    const mixed =
      "#" +
      [1, 3, 5]
        .map((offset) => {
          const from = Number.parseInt(color.slice(offset, offset + 2), 16);
          const to = Number.parseInt(target.slice(offset, offset + 2), 16);
          return Math.round(from + (to - from) * amount)
            .toString(16)
            .padStart(2, "0");
        })
        .join("");
    if ((chartContrast(mixed, background) ?? 3) >= 3) return mixed;
  }
  return target;
}

export function barColors(settings: ChartSettings): Required<BarColors> {
  const theme = terminalTheme(settings);
  const defaults = DEFAULT_BAR_COLORS[theme];
  const alternative = DEFAULT_BAR_COLORS[theme === "light" ? "dark" : "light"];
  const custom = settings.barColors?.[theme];
  const background = chartBackground(settings);
  return {
    upColor: custom?.upColor ?? autoBarColor(defaults.upColor, alternative.upColor, background),
    downColor:
      custom?.downColor ?? autoBarColor(defaults.downColor, alternative.downColor, background)
  };
}

export function updateBarColor(
  settings: ChartSettings,
  theme: TerminalTheme,
  field: keyof BarColors,
  color: string | undefined
): ChartSettings {
  const next = { ...settings };
  const themes = { ...settings.barColors };
  const palette = { ...themes[theme] };
  if (color === undefined) delete palette[field];
  else palette[field] = color;
  if (Object.keys(palette).length) themes[theme] = palette;
  else delete themes[theme];
  if (Object.keys(themes).length) next.barColors = themes;
  else delete next.barColors;
  return next;
}
