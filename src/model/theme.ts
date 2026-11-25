import type { ChartSettings } from "./types.js";

export type TerminalTheme = "dark" | "light";
export interface ChartPalette {
  background: string;
  text: string;
  muted: string;
  grid: string;
  border: string;
  crosshair: string;
  labelBackground: string;
  labelText: string;
}

export const THEME_PALETTES: Readonly<Record<TerminalTheme, Readonly<ChartPalette>>> = {
  dark: {
    background: "#131722",
    text: "#d1d4dc",
    muted: "#9598a1",
    grid: "#2a2e39",
    border: "#2a2e39",
    crosshair: "#647086",
    labelBackground: "#363a45",
    labelText: "#ffffff"
  },
  light: {
    background: "#ffffff",
    text: "#131722",
    muted: "#5d606b",
    grid: "#f0f3fa",
    border: "#d1d4dc",
    crosshair: "#787b86",
    labelBackground: "#363a45",
    labelText: "#ffffff"
  }
};

export function terminalTheme(settings: Pick<ChartSettings, "theme">): TerminalTheme {
  return settings.theme === "light" ? "light" : "dark";
}

export function chartBackground(settings: Pick<ChartSettings, "theme" | "background">): string {
  return settings.background ?? THEME_PALETTES[terminalTheme(settings)].background;
}

export function withTheme(settings: ChartSettings, theme: TerminalTheme): ChartSettings {
  const oldTheme = terminalTheme(settings),
    followsTheme =
      !settings.background ||
      settings.background.toLowerCase() === THEME_PALETTES[oldTheme].background;
  return {
    ...settings,
    theme,
    ...(followsTheme ? { background: THEME_PALETTES[theme].background } : {})
  };
}

export function chartPalette(settings: ChartSettings): Readonly<ChartPalette> {
  const background = chartBackground(settings),
    luminance = colorLuminance(background);
  // Keep scales readable even when a custom background differs from the shell theme.
  const theme = luminance == null ? terminalTheme(settings) : luminance > 0.179 ? "light" : "dark",
    palette = THEME_PALETTES[theme];
  const readable = (color: string) => {
    const foreground = colorLuminance(color);
    if (luminance == null || foreground == null) return color;
    const contrast =
      (Math.max(luminance, foreground) + 0.05) / (Math.min(luminance, foreground) + 0.05);
    return contrast >= 4.5 ? color : luminance > 0.179 ? "#000000" : "#ffffff";
  };
  return { ...palette, background, text: readable(palette.text), muted: readable(palette.muted) };
}

function colorLuminance(color: string): number | null {
  const channels = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!channels) return null;
  const linear = channels.slice(1).map((hex) => {
    const channel = Number.parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}
