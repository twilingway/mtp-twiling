import { useLayoutEffect } from "react";
import { chartPalette, terminalTheme, THEME_PALETTES } from "../../model/theme.js";
import { useTerminal } from "./context.js";

export function ThemeEffect() {
  const { state } = useTerminal(),
    settings = state.preferences.chartSettings;
  useLayoutEffect(() => {
    const root = document.documentElement,
      theme = terminalTheme(settings),
      chart = chartPalette(settings);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    root.style.setProperty("--chart-background", chart.background);
    root.style.setProperty("--chart-text", chart.text);
    root.style.setProperty("--chart-muted", chart.muted);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    meta.content = THEME_PALETTES[theme].background;
  }, [settings]);
  return null;
}
