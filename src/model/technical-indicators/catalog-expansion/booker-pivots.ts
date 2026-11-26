import { MAX_DIRECT_WINDOW_OPERATIONS } from "../channel-average/inputs.js";
import {
  classicMissedPivots,
  classicPreviousPeriodPivots,
  projectClassicNextPivot
} from "../ta-batch-booker-pivots.js";
import type { ParameterDefinition, TechnicalBar, TechnicalCalculationContext } from "../types.js";
import {
  bookerPeriodObservations,
  canReadBookerPeriods,
  type BookerPeriodId
} from "./booker-periods.js";
import type { TechnicalPriceRegion } from "./calendar-geometry.js";
import { defineCatalogStudy } from "./contract.js";
import { priceLevelChartSpan } from "./level-periods.js";

type Intraday = { showHour: boolean; showFourHours: boolean; showEightHours: boolean };
type Calendar = { showDay: boolean; showWeek: boolean; showMonth: boolean };

export interface BookerPivotStudyParameters {
  "booker-intraday-pivots": Intraday & { periodsBack: number };
  "booker-missed-pivots": Calendar & { periodsBack: number };
  "booker-ziv-ghost-pivots": Calendar & { showFourHours: boolean };
}

export type BookerPivotHistoryRequirement = {
  kind: "event-history";
  lookbackBars: null;
  seedBars: number;
  seedPolicy: "booker-completed-periods" | "booker-projected-periods";
  convergence: "full-input-dependent";
};

const lookback: ParameterDefinition = {
  key: "periodsBack",
  type: "integer",
  defaultValue: 20,
  min: 1,
  max: 100
};
const enabled = (key: string): ParameterDefinition => ({
  key,
  type: "boolean",
  defaultValue: true
});
const calendarParameters = [enabled("showDay"), enabled("showWeek"), enabled("showMonth")];

const periodStyles: Readonly<Record<BookerPeriodId, { title: string; color: string }>> = {
  "1h": { title: "1H", color: "#2962ff" },
  "4h": { title: "4H", color: "#e59d16" },
  "8h": { title: "8H", color: "#9c4bc3" },
  "1d": { title: "1D", color: "#2962ff" },
  "1w": { title: "1W", color: "#008579" },
  "1M": { title: "1M", color: "#9c4bc3" }
};

function styleDefinitions(ids: readonly BookerPeriodId[]) {
  return ids.map((id) => ({ id, ...periodStyles[id], opacity: 0.85 }));
}

function intradayPeriods(params: Intraday): BookerPeriodId[] {
  return [
    ...(params.showHour ? (["1h"] as const) : []),
    ...(params.showFourHours ? (["4h"] as const) : []),
    ...(params.showEightHours ? (["8h"] as const) : [])
  ];
}

function calendarPeriods(params: Calendar): BookerPeriodId[] {
  return [
    ...(params.showDay ? (["1d"] as const) : []),
    ...(params.showWeek ? (["1w"] as const) : []),
    ...(params.showMonth ? (["1M"] as const) : [])
  ];
}

function ghostPeriods(
  params: BookerPivotStudyParameters["booker-ziv-ghost-pivots"]
): BookerPeriodId[] {
  return [...(params.showFourHours ? (["4h"] as const) : []), ...calendarPeriods(params)];
}

function missingPeriods(periods: readonly BookerPeriodId[], context?: TechnicalCalculationContext) {
  return periods.length > 0 && !periods.some((period) => canReadBookerPeriods(period, context))
    ? ("external-data-unavailable" as const)
    : undefined;
}

function history(seedBars: number, seedPolicy: BookerPivotHistoryRequirement["seedPolicy"]) {
  const historyRequirement: BookerPivotHistoryRequirement = {
    kind: "event-history",
    lookbackBars: null,
    seedBars,
    seedPolicy,
    convergence: "full-input-dependent"
  };
  return { warmupBars: seedBars, historyRequirement };
}

const span = (timestamps: readonly number[], start: number, end: number) =>
  priceLevelChartSpan(timestamps, { startsAt: start, endsAt: end });

function intradayRegions(
  bars: readonly TechnicalBar[],
  params: BookerPivotStudyParameters["booker-intraday-pivots"],
  context?: TechnicalCalculationContext
): TechnicalPriceRegion[] {
  const times = bars.map(({ timestamp }) => timestamp);
  return intradayPeriods(params).flatMap((styleId) => {
    const source = bookerPeriodObservations(bars, styleId, params.periodsBack + 1, false, context);
    if (!source) return [];
    return classicPreviousPeriodPivots(source.periods, params.periodsBack).flatMap(
      ({ start, end, value }) => {
        const range = span(times, start, end);
        return range ? [{ ...range, styleId, low: value, high: value }] : [];
      }
    );
  });
}

function missedRegions(
  bars: readonly TechnicalBar[],
  params: BookerPivotStudyParameters["booker-missed-pivots"],
  context?: TechnicalCalculationContext
): TechnicalPriceRegion[] {
  const times = bars.map(({ timestamp }) => timestamp);
  return calendarPeriods(params).flatMap((styleId) => {
    const source = bookerPeriodObservations(bars, styleId, params.periodsBack + 1, true, context);
    if (!source) return [];
    return classicMissedPivots(source.periods, params.periodsBack).flatMap(
      ({ start, end, value, status }) => {
        if (status !== "missed") return [];
        const range = span(times, start, end);
        if (!range) return [];
        return [
          {
            ...range,
            endTimestamp: null,
            styleId,
            low: value,
            high: value,
            label: { name: periodStyles[styleId].title, price: value }
          }
        ];
      }
    );
  });
}

function ghostRegions(
  bars: readonly TechnicalBar[],
  params: BookerPivotStudyParameters["booker-ziv-ghost-pivots"],
  context?: TechnicalCalculationContext
): TechnicalPriceRegion[] {
  const latest = bars.at(-1)?.timestamp;
  if (latest === undefined) return [];
  return ghostPeriods(params).flatMap((styleId) => {
    const source = bookerPeriodObservations(bars, styleId, 1, false, context);
    const tail = source?.periods.at(-1);
    const nextStart = source?.nextStart;
    if (
      !tail?.coverageComplete ||
      nextStart === undefined ||
      latest < tail.start ||
      latest >= tail.end
    )
      return [];
    const projected = projectClassicNextPivot(tail, nextStart);
    if (!projected) return [];
    const { timestamp: startTimestamp, value } = projected;
    return [
      {
        styleId,
        startTimestamp,
        endTimestamp: null,
        startEdge: "left",
        endEdge: "center",
        low: value,
        high: value,
        label: { name: periodStyles[styleId].title, price: value }
      }
    ];
  });
}

const intraday = defineCatalogStudy<
  "booker-intraday-pivots",
  BookerPivotStudyParameters["booker-intraday-pivots"]
>({
  catalogId: "BookerIntradayPivots@tv-basicstudies",
  definition: {
    id: "booker-intraday-pivots",
    schemaVersion: 1,
    status: "computed",
    title: "Внутридневные пивоты Букера",
    shortTitle: "Пивоты Букера",
    defaultPane: "overlay",
    parameters: [
      lookback,
      enabled("showHour"),
      enabled("showFourHours"),
      enabled("showEightHours")
    ],
    outputs: [],
    levels: [],
    priceRegionStyles: styleDefinitions(["1h", "4h", "8h"]),
    references: [
      "https://www.tradingview.com/support/solutions/43000594546-rob-booker-intraday-pivot-points/",
      "https://www.tradingview.com/support/solutions/43000521824-pivot-points-standard/"
    ]
  },
  unavailableReason: (_count, params, context) => missingPeriods(intradayPeriods(params), context),
  history: () => history(2, "booker-completed-periods"),
  calculate: () => ({}),
  priceRegions: intradayRegions
});

const missed = defineCatalogStudy<
  "booker-missed-pivots",
  BookerPivotStudyParameters["booker-missed-pivots"]
>({
  catalogId: "BookerMissedPivots@tv-basicstudies",
  definition: {
    id: "booker-missed-pivots",
    schemaVersion: 1,
    status: "computed",
    title: "Пропущенные пивоты Букера",
    shortTitle: "Пропущенные пивоты",
    defaultPane: "overlay",
    parameters: [lookback, ...calendarParameters],
    outputs: [],
    levels: [],
    priceRegionStyles: styleDefinitions(["1d", "1w", "1M"]),
    references: [
      "https://www.tradingview.com/support/solutions/43000594678-rob-booker-missed-pivot-points/",
      "https://www.tradingview.com/support/solutions/43000521824-pivot-points-standard/"
    ]
  },
  unavailableReason: (count, params, context) => {
    const periods = calendarPeriods(params);
    return count * params.periodsBack * periods.length > MAX_DIRECT_WINDOW_OPERATIONS
      ? "calculation-limit"
      : missingPeriods(periods, context);
  },
  history: () => history(2, "booker-completed-periods"),
  calculate: () => ({}),
  priceRegions: missedRegions
});

const ghost = defineCatalogStudy<
  "booker-ziv-ghost-pivots",
  BookerPivotStudyParameters["booker-ziv-ghost-pivots"]
>({
  catalogId: "STD;Rob%1Booker%1Ghost%1Pivots%1v2",
  definition: {
    id: "booker-ziv-ghost-pivots",
    schemaVersion: 1,
    status: "computed",
    title: "Проекции пивотов Букера и Зива",
    shortTitle: "Проекции Ziv",
    defaultPane: "overlay",
    parameters: [enabled("showFourHours"), ...calendarParameters],
    outputs: [],
    levels: [],
    priceRegionStyles: styleDefinitions(["4h", "1d", "1w", "1M"]),
    references: [
      "https://www.tradingview.com/support/solutions/43000594679-rob-booker-ziv-ghost-pivots/",
      "https://pine-facade.tradingview.com/pine-facade/get/STD%3BRob%251Booker%251Ghost%251Pivots%251v2/30.0"
    ]
  },
  unavailableReason: (_count, params, context) => missingPeriods(ghostPeriods(params), context),
  history: () => history(1, "booker-projected-periods"),
  calculate: () => ({}),
  priceRegions: ghostRegions
});

export const bookerPivotStudies = [intraday, missed, ghost] as const;
