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
    background: "#000000",
    text: "#d4d4d4",
    muted: "#999999",
    grid: "#222222",
    border: "#333333",
    crosshair: "#a7afbe",
    labelBackground: "#333333",
    labelText: "#ffffff"
  },
  light: {
    background: "#ffffff",
    text: "#131722",
    muted: "#5d606b",
    grid: "#f0f3fa",
    border: "#d1d4dc",
    crosshair: "#4c5568",
    labelBackground: "#363a45",
    labelText: "#ffffff"
  }
};

export function terminalTheme(settings: Pick<ChartSettings, "theme">): TerminalTheme {
  return settings.theme === "light" ? "light" : "dark";
}

export function chartBackground(settings: Pick<ChartSettings, "theme" | "background">): string {
  const theme = terminalTheme(settings);
  // Recognize the exact previous dark default; other saved colors remain unchanged.
  const legacyDefault = theme === "dark" && settings.background?.toLowerCase() === "#131722";
  return !settings.background || legacyDefault
    ? THEME_PALETTES[theme].background
    : settings.background;
}

export function withTheme(settings: ChartSettings, theme: TerminalTheme): ChartSettings {
  const oldTheme = terminalTheme(settings),
    followsTheme =
      !settings.background ||
      chartBackground(settings).toLowerCase() === THEME_PALETTES[oldTheme].background;
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
  const readable = (color: string) => readableChartColor(color, background, 4.5);
  return {
    ...palette,
    background,
    text: readable(palette.text),
    muted: readable(palette.muted),
    crosshair: readable(palette.crosshair)
  };
}

export function chartContrast(foreground: string, background: string): number | null {
  const a = colorLuminance(foreground),
    b = colorLuminance(background);
  return a === null || b === null ? null : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function chartLabelText(background: string): string {
  return (chartContrast("#ffffff", background) ?? 21) >= (chartContrast("#000000", background) ?? 1)
    ? "#ffffff"
    : "#000000";
}

export function readableChartColor(color: string, background: string, minimum: number): string {
  const contrast = chartContrast(color, background);
  return contrast === null || contrast >= minimum ? color : chartLabelText(background);
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
