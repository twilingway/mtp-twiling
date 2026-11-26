import { isReservedProviderId, providerRefFromId } from "../../market-provider.js";
import type { Timeframe } from "../../types.js";
import { MAX_DIRECT_WINDOW_OPERATIONS } from "../channel-average/inputs.js";
import type { PresentationReferenceLevel } from "../presentation-types.js";
import { CORRELATION_DEFAULT_LENGTH, correlationCoefficient } from "../ta-batch-external.js";
import type { PriceSource, TechnicalBar, TechnicalCalculationContext } from "../types.js";
import { defineCatalogStudy } from "./contract.js";

export const CORRELATION_UID_MAX_LENGTH = 200;

export interface CorrelationComparisonSeries {
  readonly instrumentUid: string;
  readonly timeframe: Timeframe;
  readonly bars: readonly TechnicalBar[];
}

export interface CorrelationHistory {
  readonly primaryUid: string;
  readonly timeframe: Timeframe;
  readonly comparisons: ReadonlyMap<string, CorrelationComparisonSeries>;
}

interface CorrelationContext extends TechnicalCalculationContext {
  readonly correlationHistory?: CorrelationHistory;
}

export interface CorrelationStudyParameters {
  "correlation-coefficient": { comparisonUid: string; length: number; source: PriceSource };
}

export function isCorrelationComparisonUid(uid: string): boolean {
  return (
    uid.length > 0 &&
    uid.length <= CORRELATION_UID_MAX_LENGTH &&
    !/[\s\p{Cc}\p{Cf}]/u.test(uid) &&
    (!isReservedProviderId(uid) || providerRefFromId(uid) !== null)
  );
}

function matchingComparison(
  comparisonUid: string,
  context?: CorrelationContext
): CorrelationComparisonSeries | undefined {
  const history = context?.correlationHistory;
  if (
    !history ||
    history.primaryUid === comparisonUid ||
    history.timeframe !== context.chartInterval
  )
    return;
  const comparison = history.comparisons.get(comparisonUid);
  return comparison?.instrumentUid === comparisonUid && comparison.timeframe === history.timeframe
    ? comparison
    : undefined;
}

const baseKey = "$correlation:zero";
const color = "#4e68e0";
const referenceLevels: readonly PresentationReferenceLevel[] = (
  [
    ["correlationUpper", "Positive bound", 1],
    ["correlationZero", "Zero correlation", 0],
    ["correlationLower", "Negative bound", -1]
  ] as const
).map(([id, title, value]) => ({
  id,
  title,
  value,
  color: "#7c8694",
  lineStyle: "dashed",
  opacity: 0.65,
  width: 1
}));

const correlation = defineCatalogStudy<
  "correlation-coefficient",
  CorrelationStudyParameters["correlation-coefficient"]
>({
  catalogId: "STD;Correlation_Coeff",
  definition: {
    id: "correlation-coefficient",
    schemaVersion: 1,
    status: "computed",
    title: "Correlation Coefficient",
    shortTitle: "CC",
    defaultPane: "pane",
    parameters: [
      {
        key: "comparisonUid",
        type: "text",
        defaultValue: "",
        maxLength: CORRELATION_UID_MAX_LENGTH
      },
      {
        key: "length",
        type: "integer",
        defaultValue: CORRELATION_DEFAULT_LENGTH,
        min: 2,
        max: 10000
      },
      { key: "source", type: "source", defaultValue: "close" }
    ],
    outputs: [{ id: "value", title: "Correlation", kind: "line", color }],
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000502022-correlation-coefficient-cc/"
    ],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "fixed-2",
      plots: [
        {
          id: "value",
          seriesKey: "value",
          geometry: { kind: "line", gaps: "break" },
          color: { kind: "solid", color },
          width: 1
        }
      ],
      hiddenSeries: [baseKey],
      constantSeries: [{ seriesKey: baseKey, value: 0 }],
      fills: [
        {
          id: "correlationArea",
          fromSeries: "value",
          toSeries: baseKey,
          color,
          opacity: 0.18,
          gaps: "break"
        }
      ],
      referenceLevels
    }
  },
  validParams: ({ comparisonUid }) =>
    comparisonUid === "" || isCorrelationComparisonUid(comparisonUid),
  history: ({ length }) => ({
    warmupBars: length,
    historyRequirement: {
      kind: "finite",
      lookbackBars: length,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    }
  }),
  unavailableReason: (count, { comparisonUid, length }, context?: CorrelationContext) => {
    if (!matchingComparison(comparisonUid, context)?.bars.length)
      return "external-data-unavailable";
    return Math.max(0, count - length + 1) * length > MAX_DIRECT_WINDOW_OPERATIONS
      ? "calculation-limit"
      : undefined;
  },
  calculate: (bars, { comparisonUid, length, source }, context?: CorrelationContext) => {
    const comparison = matchingComparison(comparisonUid, context);
    return {
      value: comparison
        ? correlationCoefficient(bars, comparison.bars, length, source)
        : bars.map(() => null)
    };
  }
});

export const correlationStudies = [correlation] as const;
