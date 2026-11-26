import { intlCache } from "./intl-cache.js";

export type Locale = "ru" | "en";
export const DEFAULT_TIME_ZONE = "Europe/Moscow";
export type TimeZoneChoice = "local" | "exchange" | (string & {});
export interface DisplayPreferences {
  locale?: Locale;
  timeZone?: TimeZoneChoice;
}
const validTimeZone = intlCache<boolean>();
export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en";
}
export function isTimeZone(value: unknown): value is TimeZoneChoice {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  if (value === "local" || value === "exchange") return true;
  return validTimeZone(value, () => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
}
export function displayPreferences(value: DisplayPreferences = {}): Required<DisplayPreferences> {
  return {
    locale: isLocale(value.locale) ? value.locale : "ru",
    timeZone: isTimeZone(value.timeZone) ? value.timeZone : DEFAULT_TIME_ZONE
  };
}
// The terminal has one active owner. Pure formatters can always pass explicit preferences.
let active = displayPreferences();
export function setDisplayPreferences(value: DisplayPreferences): void {
  active = displayPreferences(value);
}
export function currentDisplayPreferences(): Required<DisplayPreferences> {
  return active;
}
export function intlLocale(locale: Locale = active.locale): string {
  return locale === "en" ? "en-US" : "ru-RU";
}
