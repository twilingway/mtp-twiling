import { priceGaps } from "../ta-batch-sessions-gaps.js";
import { tradingSessionRanges } from "../ta-batch-sessions-trading.js";
import type { GapOptions } from "../ta-batch-sessions-gaps.js";
import type { TradingSession, TradingSessionsContext } from "../ta-batch-sessions-trading.js";
import type { TechnicalBar } from "../types.js";

export type CalendarRegionHistoryRequirement = {
  kind: "event-history";
  lookbackBars: null;
  seedBars: number;
  seedPolicy: "rolling-range-gap-segments" | "session-openings";
  convergence: "full-input-dependent";
};

export interface TechnicalPriceRegion {
  readonly styleId: string;
  readonly startTimestamp: number;
  readonly extendLeft?: boolean;
  /** Null extends to the right edge until new data closes the region. */
  readonly endTimestamp: number | null;
  readonly startEdge: "center" | "left";
  readonly endEdge: "center" | "right";
  readonly low: number;
  readonly high: number;
  readonly guides?: readonly { price: number; kind: "dashed" | "dotted" }[];
  readonly label?: {
    name?: string;
    price?: number;
    tickRange?: number;
    averagePrice?: number;
  };
  readonly labelEdge?: "left" | "right";
}

export interface TechnicalCandleTint {
  readonly kind: "candle-tint";
  readonly styleId: string;
  readonly startTimestamp: number;
  readonly endTimestamp: number;
}

export interface TechnicalPriceCircle {
  readonly kind: "price-circle";
  readonly styleId: string;
  readonly timestamp: number;
  readonly price: number;
}

export type TechnicalPriceDecoration =
  TechnicalPriceRegion | TechnicalCandleTint | TechnicalPriceCircle;

export function gapPriceRegions(
  bars: readonly TechnicalBar[],
  options: GapOptions
): TechnicalPriceRegion[] {
  return priceGaps(bars, options).flatMap((gap) =>
    gap.segments.map((segment) => ({
      styleId: gap.direction === "up" ? "upGap" : "downGap",
      startTimestamp: segment.startTimestamp,
      endTimestamp: segment.endTimestamp,
      startEdge: "center",
      endEdge: "center",
      low: segment.lower,
      high: segment.upper
    }))
  );
}

export interface NamedSession extends TradingSession {
  readonly name: string;
}

export interface SessionDecorations {
  readonly showSessionNames: boolean;
  readonly showOpenClose: boolean;
  readonly showTickRange: boolean;
  readonly showAverage: boolean;
}

export function sessionPriceRegions(
  bars: readonly TechnicalBar[],
  sessions: readonly NamedSession[],
  context: TradingSessionsContext,
  display: SessionDecorations
): TechnicalPriceRegion[] {
  const usableSessions = sessions.filter(
    (session) => session.timeZone?.trim() || context.exchangeTimeZone?.trim()
  );
  const names = new Map(usableSessions.map(({ id, name }) => [id, name]));
  return tradingSessionRanges(bars, usableSessions, context).flatMap((range) => {
    if (range.low === null || range.high === null) return [];
    const name = display.showSessionNames ? names.get(range.sessionId)?.trim() : undefined;
    const guides: NonNullable<TechnicalPriceRegion["guides"]>[number][] = [];
    if (display.showOpenClose) {
      if (range.open !== null) guides.push({ price: range.open, kind: "dashed" });
      if (range.close !== null) guides.push({ price: range.close, kind: "dashed" });
    }
    if (display.showAverage && range.averageClose !== null)
      guides.push({ price: range.averageClose, kind: "dotted" });
    return [
      {
        styleId: range.sessionId,
        startTimestamp: range.startTimestamp,
        endTimestamp: range.lastTimestamp,
        startEdge: "left",
        endEdge: "right",
        low: range.low,
        high: range.high,
        guides,
        label: {
          ...(name ? { name } : {}),
          ...(display.showTickRange && range.tickRange !== null
            ? { tickRange: range.tickRange }
            : {}),
          ...(display.showAverage && range.averageClose !== null
            ? { averagePrice: range.averageClose }
            : {})
        }
      }
    ];
  });
}
