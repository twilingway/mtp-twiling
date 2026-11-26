import { shiftTimeframe } from "../../intervals/calendar.js";
import { DAY_MS } from "../ta-batch-sessions-calendar.js";
import { priceTargetLevels } from "../ta-batch-external.js";
import type { PriceTargetForecast, PriceTargetReferenceClose } from "../ta-batch-external.js";
import type { TechnicalBar, TechnicalCalculationContext } from "../types.js";
import type { TechnicalPriceDecoration, TechnicalPriceRegion } from "./calendar-geometry.js";
import { defineCatalogStudy } from "./contract.js";

export interface PriceTargetStudyInput {
  readonly forecast: PriceTargetForecast;
  readonly referenceClose: PriceTargetReferenceClose;
  readonly asOf: number;
}

export interface PriceTargetCalculationInputs {
  readonly priceTarget?: PriceTargetStudyInput;
}

export interface PriceTargetStudyParameters {
  "price-target": Record<string, never>;
}

export interface PriceTargetHistoryRequirement {
  kind: "external-forecast";
  lookbackBars: null;
  seedPolicy: "published-consensus-and-confirmed-close";
  convergence: "as-of-external-data";
}

type ChartInterval = TechnicalCalculationContext["chartInterval"];
type TargetContext = TechnicalCalculationContext & PriceTargetCalculationInputs;

function visibleLevels(input: PriceTargetStudyInput | undefined) {
  if (
    !input ||
    input.forecast.horizonTimestamp <= input.asOf ||
    !Number.isFinite(new Date(input.forecast.horizonTimestamp).getTime())
  )
    return null;
  return priceTargetLevels(input.forecast, input.referenceClose, input.asOf);
}

function firstIndexAtOrAfter(bars: readonly TechnicalBar[], timestamp: number): number {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle]!.timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Associate a dated close with a real chart candle, including aggregated timeframes. */
function originAnchor(
  bars: readonly TechnicalBar[],
  referenceTime: number,
  interval: ChartInterval
): number | undefined {
  if (interval === "1w" || interval === "1M") {
    const index = firstIndexAtOrAfter(bars, referenceTime + 1) - 1;
    const start = bars[index]?.timestamp;
    return start !== undefined && referenceTime < shiftTimeframe(start, interval, 1)
      ? start
      : undefined;
  }
  const day = Math.floor(referenceTime / DAY_MS) * DAY_MS;
  const index = firstIndexAtOrAfter(bars, day + DAY_MS) - 1;
  const start = bars[index]?.timestamp;
  return start !== undefined && start >= day ? start : undefined;
}

function targetLabel(names: readonly string[], change: number | null, horizonTimestamp: number) {
  const parts = [names.join(" / ")];
  if (change !== null) parts.push(`${change > 0 ? "+" : ""}${change.toFixed(2)}%`);
  if (names.includes("Target")) parts.push(new Date(horizonTimestamp).toISOString().slice(0, 10));
  return parts.join(" · ");
}

export function priceTargetDecorations(
  bars: readonly TechnicalBar[],
  input: PriceTargetStudyInput | undefined,
  interval?: ChartInterval
): readonly TechnicalPriceDecoration[] {
  const levels = visibleLevels(input);
  const first = bars[0]?.timestamp;
  if (!levels || first === undefined || first >= levels.horizonTimestamp) return [];

  const origin = originAnchor(bars, levels.origin.timestamp, interval);
  // If history starts later, draw the existing levels without manufacturing an origin candle.
  const nextBar =
    bars[firstIndexAtOrAfter(bars, Math.max(levels.origin.timestamp, levels.publicationTimestamp))];
  const startTimestamp = origin ?? nextBar?.timestamp;
  if (startTimestamp === undefined || startTimestamp >= levels.horizonTimestamp) return [];
  const extendLeft = origin === undefined && levels.publicationTimestamp < first;
  const dated = [
    ["Min", levels.levels.low],
    ["Target", levels.levels.mean],
    ["Max", levels.levels.high]
  ] as const;
  const grouped = new Map<number, { names: string[]; change: number | null }>();
  for (const [name, { price, changePercent }] of dated) {
    const item = grouped.get(price);
    if (item) item.names.push(name);
    else grouped.set(price, { names: [name], change: changePercent });
  }

  const decorations: TechnicalPriceDecoration[] = [];
  for (const [price, { names, change }] of grouped) {
    const region: TechnicalPriceRegion = {
      styleId: price >= levels.origin.price ? "positive" : "negative",
      startTimestamp,
      ...(extendLeft && { extendLeft }),
      endTimestamp: levels.horizonTimestamp,
      startEdge: "center",
      endEdge: "center",
      low: price,
      high: price,
      label: { price, name: targetLabel(names, change, levels.horizonTimestamp) },
      labelEdge: "right"
    };
    decorations.push(region);
  }
  if (origin !== undefined) {
    decorations.push({
      kind: "price-circle",
      styleId: "origin",
      timestamp: origin,
      price: levels.origin.price
    });
  }
  return decorations;
}

const studyHistory: PriceTargetHistoryRequirement = {
  kind: "external-forecast",
  lookbackBars: null,
  seedPolicy: "published-consensus-and-confirmed-close",
  convergence: "as-of-external-data"
};

const priceTarget = defineCatalogStudy<"price-target", PriceTargetStudyParameters["price-target"]>({
  catalogId: "STD;Price%1Target",
  definition: {
    id: "price-target",
    schemaVersion: 1,
    status: "computed",
    title: "Price Target",
    shortTitle: "Price Target",
    defaultPane: "overlay",
    parameters: [],
    outputs: [],
    levels: [],
    priceRegionStyles: [
      { id: "positive", title: "Positive Color", color: "#16875b", opacity: 1 },
      { id: "negative", title: "Negative Color", color: "#c93d55", opacity: 1 },
      { id: "origin", title: "Reference Close", color: "#3566dd", opacity: 1 }
    ],
    references: [
      "https://www.tradingview.com/support/solutions/43000730980-price-target-indicator/",
      "https://developer.tbank.ru/invest/api/instruments-service-get-consensus-forecasts"
    ]
  },
  history: () => ({ warmupBars: 1, historyRequirement: studyHistory }),
  calculate: () => ({}),
  unavailableReason: (_count, _parameters, context?: TargetContext) =>
    visibleLevels(context?.priceTarget) ? undefined : "external-data-unavailable",
  priceRegions: (bars, _parameters, context?: TargetContext) =>
    priceTargetDecorations(bars, context?.priceTarget, context?.chartInterval)
});

export const priceTargetStudies = [priceTarget] as const;
