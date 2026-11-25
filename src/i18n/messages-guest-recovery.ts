import type { Locale } from "./preferences.js";
import { currentDisplayPreferences } from "./preferences.js";
const labels = {
  autoFailed: [
    "Перенос прежних данных не сохранён. Исходная копия осталась на устройстве; скачать её можно в настройках → Импорт и экспорт.",
    "The previous workspace was not copied. The original remains on this device; download it in Settings → Import and export."
  ],
  title: ["Данные до обновления", "Data from before the update"],
  found: [
    "На этом устройстве сохранено прежнее рабочее пространство. Текущие данные не заменены.",
    "Your previous workspace is still on this device. Your current data has not been replaced."
  ],
  copied: [
    "Прежнее рабочее пространство перенесено. Исходная копия сохранена на устройстве.",
    "Your previous workspace was copied. The original remains on this device."
  ],
  warning: [
    "Явный импорт заменит текущие настройки и список инструментов. Сначала сохраните текущие данные кнопкой «Экспорт».",
    "Importing the file will replace your current settings and instrument list. Use Export to save your current data first."
  ],
  export: ["Скачать данные до обновления", "Download previous data"],
  busy: ["Подготавливаем файл…", "Preparing file…"],
  failed: [
    "Не удалось экспортировать прежние данные. Исходная копия сохранена. Попробуйте без истории свечей.",
    "Could not export previous data. The original is preserved. Try without candle history."
  ],
  invalid: [
    "Часть прежних данных не удалось прочитать. Исходная копия сохранена.",
    "Some previous data could not be read. The original is preserved."
  ],
  offline: ["Локальный экспорт работает без подключения к сети.", "Local export works offline."]
} as const;
export function guestRecoveryText(
  key: keyof typeof labels,
  locale: Locale = currentDisplayPreferences().locale
): string {
  return labels[key][locale === "en" ? 1 : 0];
}
