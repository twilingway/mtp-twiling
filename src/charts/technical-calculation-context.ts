import type { Timeframe } from "../model/types.js";
import { TIMEFRAMES } from "../model/history-codec.js";
import type { TechnicalCalculationContext } from "../model/technical-indicators/types.js";

/** Match the reviewed builtin HV rule; annualization is a calculation input, never saved per instance. */
export function technicalCalculationContext(timeframe: Timeframe): TechnicalCalculationContext {
  const duration = TIMEFRAMES[timeframe].ms;
  return {
    historicalVolatilityPeriodsPerYear: duration !== null && duration <= 86_400_000 ? 365 : 365 / 7
  };
}
