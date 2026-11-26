import type { MarketRow, Timeframe } from "../model/types.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import type {
  TechnicalCalculationContext,
  TechnicalIndicatorInstance
} from "../model/technical-indicators/types.js";
import { DAY_MS } from "../model/technical-indicators/ta-batch-sessions-calendar.js";
import { nativePriceStep } from "../model/market-price-step.js";
import type { MarketTickSource } from "../model/market-price-step.js";

/** Match the reviewed builtin HV rule; annualization is a calculation input, never saved per instance. */
export function technicalCalculationContext(
  timeframe: Timeframe,
  row?: MarketTickSource & Pick<MarketRow, "assetClass">
): TechnicalCalculationContext {
  const duration = TIMEFRAMES[timeframe].ms;
  const continuousSession = !!row?.providerRef && row.assetClass === "crypto";
  const exchangeTimeZone = continuousSession
    ? "UTC"
    : row?.realExchange === "REAL_EXCHANGE_MOEX" || row?.exchange === "MOEX"
      ? "Europe/Moscow"
      : undefined;
  const priceStep = nativePriceStep(row);
  return {
    historicalVolatilityPeriodsPerYear: duration !== null && duration <= DAY_MS ? 365 : 365 / 7,
    chartInterval: timeframe,
    chartIntervalDays: duration === null ? 30 : duration / DAY_MS,
    continuousSession,
    ...(exchangeTimeZone ? { exchangeTimeZone } : {}),
    ...(priceStep === null ? {} : { priceStep })
  };
}

export function hasVisibleAverage(instances: readonly TechnicalIndicatorInstance[]): boolean {
  return instances.some(
    ({ definitionId, visible }) => definitionId === "visible-average-price" && visible
  );
}
