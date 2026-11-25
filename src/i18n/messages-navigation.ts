import { currentDisplayPreferences } from "./preferences.js";
import type { Locale } from "./preferences.js";

const labels = {
  navigation: ["Навигация графика", "Chart navigation"],
  zoomOut: ["Уменьшить масштаб", "Zoom out"],
  zoomIn: ["Увеличить масштаб", "Zoom in"],
  older: ["К старым свечам", "Scroll to older candles"],
  newer: ["К новым свечам", "Scroll to newer candles"],
  reset: ["Сбросить вид графика", "Reset chart view"]
} as const;

export function navigationText(
  key: keyof typeof labels,
  locale: Locale = currentDisplayPreferences().locale
): string {
  return labels[key][locale === "en" ? 1 : 0];
}
