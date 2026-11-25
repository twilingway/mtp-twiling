import type { Locale } from "./preferences.js";
import { currentDisplayPreferences } from "./preferences.js";

const labels = {
  red: ["Красная", "Red"],
  blue: ["Синяя", "Blue"],
  green: ["Зелёная", "Green"],
  yellow: ["Жёлтая", "Yellow"],
  purple: ["Фиолетовая", "Purple"],
  cyan: ["Бирюзовая", "Cyan"],
  pink: ["Розовая", "Pink"],
  all: ["Все", "All"],
  palette: ["Цвет отметки", "Flag color"],
  filter: ["Цветной список", "Flagged list"],
  mark: ["Отметить инструмент", "Flag instrument"],
  clear: ["Снять отметку", "Remove flag"],
  clearAll: ["Снять все отметки", "Remove all flags"],
  failed: ["Не удалось сохранить отметки.", "Could not save flags."],
  limit: ["Достигнут предел цветных отметок.", "The flag limit has been reached."]
} as const;

export function flagText(
  key: keyof typeof labels,
  locale: Locale = currentDisplayPreferences().locale
): string {
  return labels[key][locale === "en" ? 1 : 0];
}
