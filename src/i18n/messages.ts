import { uiMessages } from "./messages-ui.js";
import { drawingMessages } from "./messages-drawings.js";
import { toolMessages } from "./messages-tools.js";
import { errorMessages } from "./messages-errors.js";
import { intervalMessages } from "./messages-intervals.js";
import { driveMessages } from "./messages-drive.js";
import { accountMessages } from "./messages-account.js";
import { cameraMessages } from "./messages-camera.js";
import { marketMessages } from "./messages-markets.js";
import { chartWorkspaceMessages } from "./messages-chart-workspace.js";
import { currentDisplayPreferences } from "./preferences.js";
import type { Locale } from "./preferences.js";

export const english = {
  ...uiMessages,
  ...drawingMessages,
  ...toolMessages,
  ...errorMessages,
  ...intervalMessages,
  ...driveMessages,
  ...accountMessages,
  ...cameraMessages,
  ...marketMessages,
  ...chartWorkspaceMessages
} as const;
export type MessageKey = keyof typeof english;
export const russian = Object.fromEntries(Object.keys(english).map((key) => [key, key])) as Record<
  MessageKey,
  string
>;
export const dictionaries: Record<Locale, Readonly<Record<MessageKey, string>>> = {
  ru: russian,
  en: english
};
export function message(
  key: MessageKey,
  locale: Locale = currentDisplayPreferences().locale
): string {
  return dictionaries[locale][key];
}
/** Translate known system labels, leaving company names and user input untouched at call sites. */
export function t(value: string, locale: Locale = currentDisplayPreferences().locale): string {
  if (locale === "ru") return value;
  if (Object.hasOwn(english, value)) return english[value as MessageKey];
  const trimmed = value.trim();
  return Object.hasOwn(english, trimmed)
    ? value.replace(trimmed, english[trimmed as MessageKey])
    : value;
}
const systemPattern = new RegExp(
  "(?<![А-Яа-яЁё])(?:" +
    Object.keys(english)
      .filter((key) => key.length >= 3)
      .sort((a, b) => b.length - a.length)
      .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") +
    ")(?![А-Яа-яЁё])",
  "g"
);
/** Only system-generated notifications/help: user labels never pass through this function. */
export function systemText(
  value: string,
  locale: Locale = currentDisplayPreferences().locale
): string {
  return locale === "ru"
    ? value
    : value.replace(systemPattern, (key) => english[key as MessageKey]);
}
