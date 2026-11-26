import { MAX_RELATIVE_BARS } from "../relative-oscillators/inputs.js";
import {
  RATING_GROUPS,
  technicalRatingSeries,
  technicalRatingWarmup
} from "../ta-batch-external-ratings-series.js";
import {
  technicalRatingCategory,
  type TechnicalRatingCategory
} from "../ta-batch-external-ratings.js";
import {
  ADVANCE_DECLINE_BARS_DEFAULT_LENGTH,
  advanceDeclineRatioBars,
  openInterestSeries
} from "../ta-batch-external.js";
import { defineCatalogStudy } from "./contract.js";

export interface ExternalStudyParameters {
  "advance-decline-ratio-bars": { length: number };
  "open-interest": Record<string, never>;
  "technical-ratings": { group: (typeof RATING_GROUPS)[number] };
}

const ratio = defineCatalogStudy<
  "advance-decline-ratio-bars",
  ExternalStudyParameters["advance-decline-ratio-bars"]
>({
  catalogId: "STD;Advance_Decline_Ratio_Bars",
  definition: {
    id: "advance-decline-ratio-bars",
    schemaVersion: 1,
    status: "computed",
    title: "Advance/Decline Ratio (Bars)",
    shortTitle: "ADR (bars)",
    defaultPane: "pane",
    parameters: [
      {
        key: "length",
        type: "integer",
        defaultValue: ADVANCE_DECLINE_BARS_DEFAULT_LENGTH,
        min: 1,
        max: 10000
      }
    ],
    outputs: [{ id: "value", title: "Ratio", kind: "line", color: "#2962ff" }],
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000644914-advance-decline-ratio-bars/"
    ],
    presentation: {
      renderVersion: 2,
      hiddenSeries: [],
      fills: [],
      plots: [
        {
          id: "value",
          seriesKey: "value",
          geometry: { kind: "line", gaps: "break" },
          color: { kind: "solid", color: "#2962ff" },
          width: 1
        }
      ]
    }
  },
  history: ({ length }) => ({
    warmupBars: length,
    historyRequirement: {
      kind: "finite",
      lookbackBars: length,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    }
  }),
  calculate: (bars, { length }) => ({ value: advanceDeclineRatioBars(bars, length) })
});

const ratingCategories: readonly TechnicalRatingCategory[] = [
  "strong-sell",
  "sell",
  "neutral",
  "buy",
  "strong-buy"
];
const ratingColors = ["#d8394e", "#b85b67", "#7c8694", "#4a9e82", "#00875d"];
const ratingColorKey = "$technical-ratings:color";

const ratings = defineCatalogStudy<
  "technical-ratings",
  ExternalStudyParameters["technical-ratings"]
>({
  catalogId: "STD;Technical%1Ratings",
  definition: {
    id: "technical-ratings",
    schemaVersion: 1,
    status: "computed",
    title: "Technical Ratings",
    shortTitle: "Technicals",
    defaultPane: "pane",
    parameters: [{ key: "group", type: "choice", defaultValue: "overall", choices: RATING_GROUPS }],
    outputs: [{ id: "value", title: "Rating", kind: "histogram", color: "#7c8694" }],
    levels: [-0.5, -0.1, 0.1, 0.5],
    references: [
      "https://www.tradingview.com/support/solutions/43000614331-technical-ratings/",
      "https://www.tradingview.com/script/jDWyb5PG-TechnicalRating/"
    ],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "fixed-2",
      hiddenSeries: [ratingColorKey],
      fills: [],
      plots: [
        {
          id: "value",
          seriesKey: "value",
          geometry: { kind: "columns", base: 0 },
          color: { kind: "indexed", seriesKey: ratingColorKey, colors: ratingColors },
          width: 1
        }
      ]
    }
  },
  history: ({ group }) => ({
    warmupBars: technicalRatingWarmup(group),
    historyRequirement: {
      kind: "recursive",
      lookbackBars: null,
      seedBars: technicalRatingWarmup(group),
      seedPolicy: "first-non-null",
      convergence: "full-input-dependent"
    }
  }),
  unavailableReason: (barCount) => (barCount > MAX_RELATIVE_BARS ? "calculation-limit" : undefined),
  calculate: (bars, { group }) => {
    const value = technicalRatingSeries(bars, group);
    return {
      value,
      [ratingColorKey]: value.map((score) =>
        score === null ? null : ratingCategories.indexOf(technicalRatingCategory(score))
      )
    };
  }
});

const openInterest = defineCatalogStudy<"open-interest", ExternalStudyParameters["open-interest"]>({
  catalogId: "STD;Open%Interest",
  definition: {
    id: "open-interest",
    schemaVersion: 1,
    status: "computed",
    title: "Open Interest",
    shortTitle: "OI",
    defaultPane: "pane",
    parameters: [],
    outputs: [{ id: "value", title: "Open interest", kind: "line", color: "#168caa" }],
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000685269-open-interest/",
      "https://bybit-exchange.github.io/docs/v5/market/open-interest"
    ],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "fixed-2",
      hiddenSeries: [],
      fills: [],
      plots: [
        {
          id: "value",
          seriesKey: "value",
          geometry: { kind: "line", gaps: "break" },
          color: { kind: "solid", color: "#168caa" },
          width: 1
        }
      ]
    }
  },
  history: () => ({
    warmupBars: 1,
    historyRequirement: {
      kind: "finite",
      lookbackBars: 1,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    }
  }),
  unavailableReason: (_count, _params, context) =>
    context?.openInterest?.rows.some((item) => item.value !== null)
      ? undefined
      : "external-data-unavailable",
  calculate: (bars, _params, context) => {
    const input = context?.openInterest;
    return {
      value: input
        ? openInterestSeries(
            input.instrumentKey,
            bars.map((item) => item.timestamp),
            input
          ).values
        : bars.map(() => null)
    };
  }
});

export const externalStudies = [ratio, ratings, openInterest] as const;
