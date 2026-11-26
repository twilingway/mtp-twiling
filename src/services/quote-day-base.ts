import { quotation } from "../model/market-model.js";
import { serverTimestamp } from "./server-clock.js";

export const DAY_MS = 86_400_000;

/** The WebSocket clock estimates the UTC day. Its seconds can trail the last-price stream. */
export function liveQuoteTimeLimit(now: number): number {
  return (Math.floor(now / DAY_MS) + 1) * DAY_MS - 1;
}

export interface DailyQuoteBase {
  price: number;
  time: string;
  day: string;
  source: "evening" | "exchange-day";
}
export interface ClosePriceFields {
  price?: unknown;
  time?: unknown;
  eveningSessionPrice?: unknown;
  eveningSessionPriceTime?: unknown;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/** TBank DAY bars use UTC calendar dates, including futures (not exchange settlement days). */
export function quoteDay(time: unknown, now: number): string | null {
  const timestamp = serverTimestamp(time);
  return timestamp !== null && Number.isFinite(now) && timestamp <= now
    ? new Date(timestamp).toISOString().slice(0, 10)
    : null;
}
export function priorDayBase(
  quoteTime: unknown,
  close: ClosePriceFields | undefined,
  candles: unknown,
  now: number
): DailyQuoteBase | null {
  const day = quoteDay(quoteTime, now);
  if (!day) return null;
  const boundary = Date.parse(day + "T00:00:00Z");
  const eveningTime = serverTimestamp(close?.eveningSessionPriceTime);
  const eveningPrice = quotation(close?.eveningSessionPrice);
  // An immediately preceding calendar day cannot hide another trading date.
  // Older fields need history: weekends and holidays cannot be inferred from weekdays.
  if (
    eveningTime !== null &&
    eveningTime >= boundary - DAY_MS &&
    eveningTime < boundary &&
    eveningPrice !== null &&
    eveningPrice > 0
  )
    return {
      price: eveningPrice,
      time: new Date(eveningTime).toISOString(),
      day,
      source: "evening"
    };
  let previous: DailyQuoteBase | null = null;
  for (const input of Array.isArray(candles) ? candles : []) {
    const bar = record(input);
    if (!bar || bar.isComplete !== true || bar.candleSource !== "CANDLE_SOURCE_EXCHANGE") continue;
    const timestamp = serverTimestamp(bar.time),
      price = quotation(bar.close);
    if (timestamp === null || timestamp >= boundary || price === null || price <= 0) continue;
    if (!previous || timestamp > Date.parse(previous.time))
      previous = { price, time: new Date(timestamp).toISOString(), day, source: "exchange-day" };
  }
  return previous;
}
