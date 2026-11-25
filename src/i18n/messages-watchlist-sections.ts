import type { Locale } from "./preferences.js";
import { currentDisplayPreferences } from "./preferences.js";

const labels = {
  add: ["Добавить раздел", "Add section"],
  name: ["Название раздела", "Section name"],
  new: ["Новый раздел", "New section"],
  rename: ["Переименовать раздел", "Rename section"],
  delete: ["Удалить раздел", "Delete section"],
  collapse: ["Свернуть раздел", "Collapse section"],
  expand: ["Развернуть раздел", "Expand section"],
  up: ["Переместить выше", "Move up"],
  down: ["Переместить ниже", "Move down"],
  move: ["Переместить в раздел", "Move to section"],
  top: ["Верхний уровень", "Top level"],
  save: ["Сохранить", "Save"],
  cancel: ["Отмена", "Cancel"],
  actions: ["Действия с разделом", "Section actions"],
  failed: ["Не удалось сохранить разделы.", "Could not save sections."],
  limit: [
    "Достигнут предел разделов или инструментов.",
    "The section or instrument limit was reached."
  ],
  keyboard: ["Alt + ↑/↓ — переместить строку", "Alt + ↑/↓ to move the row"],
  invalid: [
    "Введите название до 80 символов без < и >.",
    "Enter a name up to 80 characters without < or >."
  ]
} as const;

export function sectionText(
  key: keyof typeof labels,
  locale: Locale = currentDisplayPreferences().locale
): string {
  return labels[key][locale === "en" ? 1 : 0];
}
