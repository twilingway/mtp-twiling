import { rsi } from "../calculations.js";
import { MAX_CHANNEL_AVERAGE_BARS } from "../channel-average/inputs.js";
import { momentum } from "../momentum-volume/oscillators.js";
import { knoxvilleCondition } from "../ta-batch-booker-oscillators.js";
import type { KnoxvillePoint } from "../ta-batch-booker-oscillators.js";
import { pivotPointsHighLow } from "../ta-batch-pivots.js";
import type { ConfirmedPivot } from "../ta-batch-pivots.js";
import type {
  LegacyRecursiveHistoryRequirement,
  ParameterDefinition,
  TechnicalBar,
  TechnicalCalculationContext
} from "../types.js";
import type { TechnicalSlopedLine } from "./auto-sloped-geometry.js";
import { defineCatalogStudy } from "./contract.js";

interface KnoxvilleParams {
  readonly momentumLength: number;
  readonly rsiLength: number;
  readonly radius: number;
  readonly maximumDistance: number;
  readonly oversold: number;
  readonly overbought: number;
}

export interface KnoxvilleStudyParameters {
  "knoxville-divergence": KnoxvilleParams;
}

const length = (key: string, defaultValue: number, min = 1): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min,
  max: 10_000
});
const threshold = (key: string, defaultValue: number): ParameterDefinition => ({
  key,
  type: "number",
  defaultValue,
  min: 0,
  max: 100
});

type Swing = KnoxvillePoint & { readonly index: number };

function observeRun(
  bars: readonly TechnicalBar[],
  start: number,
  end: number,
  params: KnoxvilleParams,
  results: TechnicalSlopedLine[]
) {
  if (end - start < 2 * params.radius + 1) return;
  const candles = bars.slice(start, end);
  const closes = candles.map(({ close }) => close);
  const momentumValues = momentum(closes, params.momentumLength);
  const rsiValues = rsi(closes, params.rsiLength);
  const strength = { left: params.radius, right: params.radius };
  const pivots = pivotPointsHighLow(candles, strength, strength);
  const indexByTime = new Map(candles.map(({ timestamp }, index) => [timestamp, index]));
  const previous: Partial<Record<ConfirmedPivot["kind"], Swing>> = {};
  for (const { kind, timestamp, value: price } of pivots) {
    const local = indexByTime.get(timestamp)!;
    const index = start + local;
    const change = momentumValues[local];
    const extreme = rsiValues[local];
    if (change == null || extreme == null) {
      delete previous[kind];
      continue;
    }
    const current = { index, price, momentum: change, rsi: extreme };
    const before = previous[kind];
    previous[kind] = current;
    if (!before || index - before.index > params.maximumDistance) continue;
    const styleId = kind === "high" ? "bearish" : "bullish";
    if (knoxvilleCondition(before, current, params) !== styleId) continue;
    results.push({
      kind: "sloped-line",
      styleId,
      startIndex: before.index,
      endIndex: index,
      line: {
        from: { index: before.index, value: before.price },
        through: { index, value: price }
      }
    });
  }
}

function knoxvilleRegions(
  bars: readonly TechnicalBar[],
  params: KnoxvilleParams,
  context?: TechnicalCalculationContext
): TechnicalSlopedLine[] {
  const end = Math.max(0, bars.length - Number(context?.lastBarClosed !== true));
  const regions: TechnicalSlopedLine[] = [];
  let start = 0;
  for (let index = 0; index < end; index++) {
    const { open, high, low, close } = bars[index]!;
    if (open !== null && high !== null && low !== null && close !== null) continue;
    observeRun(bars, start, index, params, regions);
    start = index + 1;
  }
  observeRun(bars, start, end, params, regions);
  return regions;
}

const knoxville = defineCatalogStudy<"knoxville-divergence", KnoxvilleParams>({
  catalogId: "BookerKnoxvilleDivergence@tv-basicstudies",
  definition: {
    schemaVersion: 1,
    id: "knoxville-divergence",
    title: "Дивергенция Knoxville (MTP)",
    shortTitle: "Knoxville (MTP)",
    status: "computed",
    defaultPane: "overlay",
    parameters: [
      length("momentumLength", 20),
      length("rsiLength", 14),
      length("radius", 2),
      length("maximumDistance", 50, 2),
      threshold("oversold", 30),
      threshold("overbought", 70)
    ],
    outputs: [],
    levels: [],
    priceRegionStyles: [
      { id: "bullish", title: "Бычья дивергенция", color: "#008579", opacity: 0.95 },
      { id: "bearish", title: "Медвежья дивергенция", color: "#d14343", opacity: 0.95 }
    ],
    references: [
      "https://www.tradingview.com/support/solutions/43000591336-rob-booker-knoxville-divergence/",
      "https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/"
    ]
  },
  validParams: ({ maximumDistance, radius, oversold, overbought }) =>
    maximumDistance > radius && oversold < overbought,
  history: ({ momentumLength, rsiLength, radius }) => {
    const historyRequirement: LegacyRecursiveHistoryRequirement = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: rsiLength + 1,
      seedPolicy: "adjacent-change-wilder",
      convergence: "full-input-dependent"
    };
    return {
      historyRequirement,
      warmupBars: Math.max(momentumLength, rsiLength, radius) + 2 * radius + 2
    };
  },
  unavailableReason: (count) =>
    count > MAX_CHANNEL_AVERAGE_BARS ? "calculation-limit" : undefined,
  calculate: () => ({}),
  priceRegions: knoxvilleRegions
});

export const knoxvilleStudies = [knoxville] as const;
