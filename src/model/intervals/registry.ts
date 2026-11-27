export type IntervalId =
  | "1m"
  | "2m"
  | "3m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "45m"
  | "1h"
  | "2h"
  | "3h"
  | "4h"
  | "1d"
  | "1w"
  | "1M"
  | "3M"
  | "6M"
  | "12M";
export type DerivedIntervalId = "45m" | "3h" | "3M" | "6M" | "12M";
export type NativeIntervalId = Exclude<IntervalId, DerivedIntervalId>;
export type IntervalGroupId = "minutes" | "hours" | "days";
interface BaseInterval {
  id: IntervalId;
  label: string;
  shortLabel: string;
  group: IntervalGroupId;
  supported: true;
}
export interface NativeInterval extends BaseInterval {
  kind: "native";
  id: NativeIntervalId;
  history: {
    apiInterval: string;
    enumValue: number;
    maxRequest: { value: number; unit: "day" | "week" | "month" | "year" };
    maxCandles: number;
  };
  stream: { apiInterval: string; enumValue: number };
  alignment: "native" | "utc-midnight";
}
export interface DerivedInterval extends BaseInterval {
  id: DerivedIntervalId;
  kind: "derived";
  source: NativeIntervalId;
  requiresSession: boolean;
  months?: 3 | 6 | 12;
  minutes?: 45 | 180;
}
export type IntervalDefinition = NativeInterval | DerivedInterval;
const native = (
  id: NativeIntervalId,
  label: string,
  shortLabel: string,
  group: IntervalGroupId,
  enumValue: number,
  historyName: string,
  streamName: string,
  value: number,
  unit: NativeInterval["history"]["maxRequest"]["unit"],
  maxCandles: number
): NativeInterval => ({
  id,
  label,
  shortLabel,
  group,
  supported: true,
  kind: "native",
  history: {
    apiInterval: `CANDLE_INTERVAL_${historyName}`,
    enumValue,
    maxRequest: { value, unit },
    maxCandles
  },
  stream: { apiInterval: `SUBSCRIPTION_INTERVAL_${streamName}`, enumValue },
  alignment: id === "2h" || id === "4h" ? "utc-midnight" : "native"
});
const derived = (
  id: DerivedInterval["id"],
  label: string,
  shortLabel: string,
  group: IntervalGroupId,
  source: NativeIntervalId,
  duration: { months: 3 | 6 | 12 } | { minutes: 45 | 180 }
): DerivedInterval => ({
  id,
  label,
  shortLabel,
  group,
  source,
  supported: true,
  kind: "derived",
  requiresSession: "minutes" in duration,
  ...duration
});

/** Official marketdata.proto, verified 2026-11-25. Never send a derived ID as an API enum. */
export const INTERVALS: readonly IntervalDefinition[] = [
  native("1m", "1 минута", "1м", "minutes", 1, "1_MIN", "ONE_MINUTE", 1, "day", 2400),
  native("2m", "2 минуты", "2м", "minutes", 6, "2_MIN", "2_MIN", 1, "day", 1200),
  native("3m", "3 минуты", "3м", "minutes", 7, "3_MIN", "3_MIN", 1, "day", 750),
  native("5m", "5 минут", "5м", "minutes", 2, "5_MIN", "FIVE_MINUTES", 1, "week", 2400),
  native("10m", "10 минут", "10м", "minutes", 8, "10_MIN", "10_MIN", 1, "week", 1200),
  native("15m", "15 минут", "15м", "minutes", 3, "15_MIN", "FIFTEEN_MINUTES", 3, "week", 2400),
  native("30m", "30 минут", "30м", "minutes", 9, "30_MIN", "30_MIN", 3, "week", 1200),
  derived("45m", "45 минут", "45м", "minutes", "15m", { minutes: 45 }),
  native("1h", "1 час", "1ч", "hours", 4, "HOUR", "ONE_HOUR", 3, "month", 2400),
  native("2h", "2 часа", "2ч", "hours", 10, "2_HOUR", "2_HOUR", 3, "month", 2400),
  derived("3h", "3 часа", "3ч", "hours", "1h", { minutes: 180 }),
  native("4h", "4 часа", "4ч", "hours", 11, "4_HOUR", "4_HOUR", 3, "month", 700),
  native("1d", "День", "Д", "days", 5, "DAY", "ONE_DAY", 6, "year", 2400),
  native("1w", "Неделя", "Н", "days", 12, "WEEK", "WEEK", 5, "year", 300),
  native("1M", "Месяц", "М", "days", 13, "MONTH", "MONTH", 10, "year", 120),
  derived("3M", "3 месяца", "3М", "days", "1M", { months: 3 }),
  derived("6M", "6 месяцев", "6М", "days", "1M", { months: 6 }),
  derived("12M", "12 месяцев", "12М", "days", "1M", { months: 12 })
];
export const INTERVAL_GROUPS: readonly { id: IntervalGroupId; label: string }[] = [
  { id: "minutes", label: "Минуты" },
  { id: "hours", label: "Часы" },
  { id: "days", label: "Дни" }
];
export const UNAVAILABLE_INTERVAL_GROUPS = [
  { id: "ticks", label: "Тики", reason: "Тиковые свечи пока не поддерживаются терминалом." },
  {
    id: "seconds",
    label: "Секунды",
    reason:
      "T‑Invest даёт историю 5/10/30 секунд, но не поток секундных свечей. В терминале пока недоступны."
  },
  {
    id: "ranges",
    label: "Диапазоны",
    reason: "Диапазонные бары пока не поддерживаются терминалом."
  }
] as const;
export function isIntervalId(value: unknown): value is IntervalId {
  return typeof value === "string" && INTERVALS.some((item) => item.id === value);
}
export function getInterval(id: IntervalId): IntervalDefinition {
  const result = INTERVALS.find((item) => item.id === id);
  if (!result) throw new RangeError(`Unknown candle interval: ${id}`);
  return result;
}
export function isNativeIntervalId(value: unknown): value is NativeIntervalId {
  return isIntervalId(value) && getInterval(value).kind === "native";
}
