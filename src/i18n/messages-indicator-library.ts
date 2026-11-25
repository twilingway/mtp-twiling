import type { Locale } from "./preferences.js";

const labels = {
  title: ["Индикаторы", "Indicators"],
  search: ["Поиск индикаторов", "Search indicators"],
  sections: ["Разделы библиотеки", "Library sections"],
  scripts: ["Мои скрипты", "My scripts"],
  builtIn: ["Встроенные", "Built-in"],
  technicals: ["Теханализ", "Technicals"],
  empty: ["Индикаторы не найдены", "No indicators found"],
  emptyHint: ["Измените запрос или выберите другой раздел.", "Try another search or section."],
  added: ["Добавлен", "Added"],
  unavailable: ["Расчёт пока недоступен", "Calculation is not available yet"],
  close: ["Закрыть", "Close"]
} as const;

export function indicatorLibraryText(key: keyof typeof labels, locale: Locale): string {
  return labels[key][locale === "en" ? 1 : 0];
}
