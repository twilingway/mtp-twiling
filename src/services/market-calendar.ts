import type { MarketClient } from "./market-client.js";
import { loadCandleCalendar } from "./tbank-calendar.js";
import type { Timeframe } from "../model/types.js";
import type { TradingCalendarDay } from "../model/candle-clock.js";
import { isReservedProviderId } from "../model/market-provider.js";
/** No bank calendar request can receive an opaque public series ID. */
export async function marketCalendar(
  client: MarketClient | null,
  uid: string,
  barTimestamp: number,
  timeframe: Timeframe,
  now: number,
  signal: AbortSignal,
  current: () => boolean
): Promise<TradingCalendarDay[]> {
  if (!client?.bankClient || isReservedProviderId(uid) || signal.aborted || !current()) return [];
  try {
    const days = await loadCandleCalendar(
      client.bankClient,
      uid,
      barTimestamp,
      timeframe,
      now,
      signal
    );
    return !signal.aborted && current() ? days : [];
  } catch {
    return [];
  }
}
