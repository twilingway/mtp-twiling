import { currentDisplayPreferences } from "../../i18n/preferences.js";
export function detailText(ru: string, en: string): string {
  return currentDisplayPreferences().locale === "en" ? en : ru;
}
export function detailNumber(value: number | null, unit = "", digits = 2): string {
  if (value === null) return "—";
  const locale = currentDisplayPreferences().locale === "en" ? "en-US" : "ru-RU";
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value) +
    (unit ? ` ${unit.toUpperCase()}` : "")
  );
}
export function detailDate(value: string | number | null): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat(currentDisplayPreferences().locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC"
      }).format(parsed)
    : "—";
}
export function recommendation(value: string | null): string {
  if (value === "RECOMMENDATION_BUY") return detailText("Покупать", "Buy");
  if (value === "RECOMMENDATION_HOLD") return detailText("Держать", "Hold");
  if (value === "RECOMMENDATION_SELL") return detailText("Продавать", "Sell");
  return detailText("Не указан", "Unspecified");
}
export function detailError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === 403)
    return detailText("У ключа нет доступа к этим данным.", "This key cannot access these data.");
  if (code === 401)
    return detailText("Ключ недействителен или отозван.", "The key is invalid or revoked.");
  if (code === 429)
    return detailText(
      "Лимит запросов банка. Повторите позже.",
      "Bank request limit reached. Retry later."
    );
  if (error instanceof Error && error.message === "UNSUPPORTED_INSTRUMENT")
    return detailText(
      "Данные компании доступны только для акций.",
      "Company data are available for shares only."
    );
  return detailText(
    "Не удалось получить данные T-Invest. Проверьте соединение и повторите.",
    "Could not load T-Invest data. Check your connection and retry."
  );
}
