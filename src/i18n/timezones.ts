import { DEFAULT_TIME_ZONE, intlLocale, isTimeZone } from "./preferences.js";
import type { Locale, TimeZoneChoice } from "./preferences.js";
import { intlCache } from "./intl-cache.js";

const offsetFormatter = intlCache<Intl.DateTimeFormat>();

const cities: Readonly<Record<string, string>> = {
  "Europe/Moscow": "Москва",
  "Europe/Astrakhan": "Астрахань",
  "Europe/Samara": "Самара",
  "Europe/Kaliningrad": "Калининград",
  "Europe/Kirov": "Киров",
  "Europe/Volgograd": "Волгоград",
  "Europe/Saratov": "Саратов",
  "Europe/Ulyanovsk": "Ульяновск",
  "Asia/Yekaterinburg": "Екатеринбург",
  "Asia/Omsk": "Омск",
  "Asia/Novosibirsk": "Новосибирск",
  "Asia/Krasnoyarsk": "Красноярск",
  "Asia/Irkutsk": "Иркутск",
  "Asia/Yakutsk": "Якутск",
  "Asia/Vladivostok": "Владивосток",
  "Asia/Magadan": "Магадан",
  "Asia/Kamchatka": "Камчатка",
  "Asia/Sakhalin": "Сахалин",
  "Asia/Chita": "Чита",
  "Asia/Barnaul": "Барнаул",
  "Asia/Tomsk": "Томск",
  "Asia/Novokuznetsk": "Новокузнецк",
  "Asia/Khandyga": "Хандыга",
  "Asia/Ust-Nera": "Усть-Нера",
  "Asia/Srednekolymsk": "Среднеколымск",
  "Asia/Anadyr": "Анадырь",
  "Europe/London": "Лондон",
  "Europe/Paris": "Париж",
  "Europe/Berlin": "Берлин",
  "Europe/Rome": "Рим",
  "Europe/Madrid": "Мадрид",
  "Europe/Istanbul": "Стамбул",
  "Europe/Minsk": "Минск",
  "Europe/Kyiv": "Киев",
  "Europe/Kiev": "Киев",
  "America/New_York": "Нью-Йорк",
  "America/Chicago": "Чикаго",
  "America/Denver": "Денвер",
  "America/Los_Angeles": "Лос-Анджелес",
  "America/Toronto": "Торонто",
  "America/Vancouver": "Ванкувер",
  "America/Sao_Paulo": "Сан-Паулу",
  "America/Mexico_City": "Мехико",
  "Asia/Tokyo": "Токио",
  "Asia/Shanghai": "Шанхай",
  "Asia/Hong_Kong": "Гонконг",
  "Asia/Singapore": "Сингапур",
  "Asia/Dubai": "Дубай",
  "Asia/Almaty": "Алматы",
  "Asia/Kolkata": "Калькутта",
  "Asia/Calcutta": "Калькутта",
  "Asia/Kathmandu": "Катманду",
  "Asia/Katmandu": "Катманду",
  "Asia/Tehran": "Тегеран",
  "Asia/Seoul": "Сеул",
  "Australia/Sydney": "Сидней",
  "Australia/Adelaide": "Аделаида",
  "Australia/Perth": "Перт",
  "Pacific/Auckland": "Окленд",
  "Pacific/Chatham": "Чатем",
  "Pacific/Honolulu": "Гонолулу"
};
export function resolveTimeZone(choice: TimeZoneChoice = DEFAULT_TIME_ZONE): string {
  if (choice === "exchange") return DEFAULT_TIME_ZONE;
  if (choice === "local") {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  }
  return isTimeZone(choice) ? choice : DEFAULT_TIME_ZONE;
}
export function timeZoneOffset(zone: TimeZoneChoice, instant: number): string {
  const timeZone = resolveTimeZone(zone);
  const parts = offsetFormatter(
    timeZone,
    () => new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
  ).formatToParts(instant);
  return (parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT")
    .replace("GMT", "UTC")
    .replace(/^UTC[+-]00:00$/, "UTC");
}
export function timeZoneLabel(zone: TimeZoneChoice, locale: Locale): string {
  if (zone === "local") return locale === "ru" ? "Устройство" : "Device";
  if (zone === "exchange") return locale === "ru" ? "Биржа · Москва" : "Exchange · Moscow";
  if (zone === "UTC") return "UTC";
  if (locale === "ru" && cities[zone]) return cities[zone];
  return zone.split("/").at(-1)?.replaceAll("_", " ") ?? zone;
}
export function supportedTimeZones(): TimeZoneChoice[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return [...new Set([DEFAULT_TIME_ZONE, "UTC", "local", "exchange", ...zones])];
}
export function searchTimeZones(query: string, locale: Locale, instant: number) {
  const language = intlLocale(locale);
  const needle = query.trim().toLocaleLowerCase(language);
  const collator = new Intl.Collator(language);
  const matches = supportedTimeZones()
    .map((zone) => ({ zone, label: timeZoneLabel(zone, locale) }))
    .filter(({ zone, label }) => `${label} ${zone}`.toLocaleLowerCase(language).includes(needle))
    .map((choice) => ({ ...choice, offset: timeZoneOffset(choice.zone, instant) }));
  const modes = new Set<TimeZoneChoice>(["UTC", "local", "exchange"]);
  const cities = matches
    .filter(({ zone }) => !modes.has(zone))
    .map((choice) => ({ choice, minutes: offsetMinutes(choice.offset) }))
    .sort(
      (a, b) =>
        a.minutes - b.minutes ||
        collator.compare(a.choice.label, b.choice.label) ||
        collator.compare(a.choice.zone, b.choice.zone)
    );
  return [...matches.filter(({ zone }) => modes.has(zone)), ...cities.map(({ choice }) => choice)];
}

function offsetMinutes(offset: string): number {
  if (offset === "UTC") return 0;
  const minutes = Number(offset.slice(4, 6)) * 60 + Number(offset.slice(7, 9));
  return offset[3] === "-" ? -minutes : minutes;
}
