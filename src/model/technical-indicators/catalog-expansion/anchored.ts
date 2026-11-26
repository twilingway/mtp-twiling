import {
  autoAnchoredVwap,
  automaticVwapPeriod,
  twap,
  visibleAveragePrice,
  vwap
} from "../ta-batch-anchored.js";
import type { AutoVwapAnchor, VwapResult } from "../ta-batch-anchored.js";
import {
  ALLIGATOR_DEFAULTS,
  ICHIMOKU_DEFAULTS,
  ichimokuCloud,
  williamsAlligator
} from "../ta-batch-anchored-shifts.js";
import type { AlligatorParameters, IchimokuParameters } from "../ta-batch-anchored-shifts.js";
import type { PresentationFill } from "../presentation-types.js";
import type {
  NumericSeries,
  ParameterDefinition,
  PriceSource,
  TechnicalBar,
  TechnicalCalculationContext,
  TechnicalOutputDefinition
} from "../types.js";
import { anchoredPeriodStarts, calendarAnchorPeriods } from "./anchored-context.js";
import type { CalendarAnchorPeriod } from "./anchored-context.js";
import { defineCatalogStudy } from "./contract.js";
import type { CatalogStudyHistory } from "./contract.js";

type Price = Exclude<PriceSource, "volume">;
type ExtremeMode = Exclude<AutoVwapAnchor["mode"], "period">;
type AutoMode = "auto" | CalendarAnchorPeriod | ExtremeMode;
interface AnchoredParameters {
  anchor: CalendarAnchorPeriod;
  source: Price;
  offset: number;
}
interface VwapBands {
  bandMode: "standard-deviation" | "percent";
  band1: boolean;
  band2: boolean;
  band3: boolean;
  bandMultiplier1: number;
  bandMultiplier2: number;
  bandMultiplier3: number;
}
type VwapParameters = AnchoredParameters & VwapBands & { intradayOnly: boolean };
type AutoVwapParameters = Omit<AnchoredParameters, "anchor"> &
  VwapBands & { anchor: AutoMode; length: number };

export interface AnchoredStudyParameters {
  vwap: VwapParameters;
  "vwap-auto-anchored": AutoVwapParameters;
  twap: AnchoredParameters;
  "visible-average-price": { source: Price };
  "ichimoku-cloud": IchimokuParameters;
  "williams-alligator": AlligatorParameters;
}

const priceChoices = ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] as const;
const autoAnchorChoices = [
  "auto",
  ...calendarAnchorPeriods,
  "highest-high",
  "lowest-low",
  "highest-volume"
] as const;
const integer = (key: string, defaultValue: number, min = 1, max = 10000): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min,
  max
});
const checkbox = (key: string, defaultValue: boolean): ParameterDefinition => ({
  key,
  type: "boolean",
  defaultValue
});
const offset = (key = "offset", defaultValue = 0) => integer(key, defaultValue, -500, 500);
const source = (defaultValue: Price): ParameterDefinition => ({
  key: "source",
  type: "choice",
  defaultValue,
  choices: priceChoices
});
const calendarAnchor: ParameterDefinition = {
  key: "anchor",
  type: "choice",
  defaultValue: "session",
  choices: calendarAnchorPeriods
};
const bandParameters: ParameterDefinition[] = [
  {
    key: "bandMode",
    type: "choice",
    defaultValue: "standard-deviation",
    choices: ["standard-deviation", "percent"]
  },
  ...([1, 2, 3] as const).flatMap((index): ParameterDefinition[] => [
    checkbox(`band${index}`, index === 1),
    { key: `bandMultiplier${index}`, type: "number", defaultValue: index, min: 0, max: 1000 }
  ])
];
const output = (id: string, title: string, color: string): TechnicalOutputDefinition => ({
  id,
  title,
  kind: "line",
  color
});
const bandOutputs = [
  output("upper1", "Upper band 1", "#168755"),
  output("lower1", "Lower band 1", "#168755"),
  output("upper2", "Upper band 2", "#8C8323"),
  output("lower2", "Lower band 2", "#8C8323"),
  output("upper3", "Upper band 3", "#138480"),
  output("lower3", "Lower band 3", "#138480")
];
const bandFills: readonly PresentationFill[] = (["#168755", "#8C8323", "#138480"] as const).map(
  (color, i) => ({
    id: `bandFill${i + 1}`,
    fromSeries: `upper${i + 1}`,
    toSeries: `lower${i + 1}`,
    color,
    opacity: 0.12,
    gaps: "break"
  })
);

const averageHistory = (): CatalogStudyHistory => ({
  warmupBars: 1,
  historyRequirement: {
    kind: "anchored-period",
    lookbackBars: null,
    seedPolicy: "first-candle-of-period",
    convergence: "full-input-dependent"
  }
});

function overlay<Id extends string>(
  id: Id,
  title: string,
  shortTitle: string,
  reference: string,
  parameters: readonly ParameterDefinition[],
  outputs: readonly TechnicalOutputDefinition[],
  fills: readonly PresentationFill[] = []
) {
  return {
    schemaVersion: 1,
    id,
    title,
    shortTitle,
    status: "computed",
    defaultPane: "overlay",
    parameters,
    outputs,
    levels: [],
    references: [reference],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "native-price",
      hiddenSeries: [],
      fills,
      plots: outputs.map(({ id, color }) => ({
        id,
        seriesKey: id,
        geometry: { kind: "line" as const, gaps: "break" as const },
        color: { kind: "solid" as const, color },
        width: 1 as const
      }))
    }
  } as const;
}

const vwapOutputs = [output("value", "VWAP", "#2962FF"), ...bandOutputs];
const averageOffsets = ({ offset }: { offset: number }) => ({ value: offset });
const vwapOffsets = ({ offset }: { offset: number }) =>
  Object.fromEntries(vwapOutputs.map(({ id }) => [id, offset]));
const empty = (bars: readonly TechnicalBar[]) => bars.map(() => null);
const hiddenVwap = (bars: readonly TechnicalBar[]) =>
  Object.fromEntries(vwapOutputs.map(({ id }) => [id, empty(bars)]));
function vwapOptions(params: VwapBands & { source: Price }) {
  return {
    source: params.source,
    bands: {
      mode: params.bandMode,
      multipliers: [params.bandMultiplier1, params.bandMultiplier2, params.bandMultiplier3]
    }
  };
}
function vwapValues(result: VwapResult, params: VwapBands): Record<string, NumericSeries> {
  const series: Record<string, NumericSeries> = { value: result.values };
  const inactive = result.values.map(() => null);
  [params.band1, params.band2, params.band3].forEach((enabled, i) => {
    const band = result.bands[i]!;
    series[`upper${i + 1}`] = enabled ? band.upper : inactive;
    series[`lower${i + 1}`] = enabled ? band.lower : inactive;
  });
  return series;
}
function autoAnchor(
  bars: readonly TechnicalBar[],
  params: AutoVwapParameters,
  context?: TechnicalCalculationContext
): AutoVwapAnchor {
  const { anchor, length } = params;
  if (anchor === "highest-high" || anchor === "lowest-low" || anchor === "highest-volume")
    return { mode: anchor, length };
  if (anchor === "auto" && !context?.chartIntervalDays) return { mode: "period", starts: null };
  const period = anchor === "auto" ? automaticVwapPeriod(context!.chartIntervalDays!) : anchor;
  return { mode: "period", starts: anchoredPeriodStarts(bars, period, context) };
}

export const anchoredStudies = [
  defineCatalogStudy<"vwap", VwapParameters>({
    catalogId: "STD;VWAP",
    definition: overlay(
      "vwap",
      "Volume Weighted Average Price",
      "VWAP",
      "https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/",
      [
        calendarAnchor,
        source("hlc3"),
        checkbox("intradayOnly", false),
        offset(),
        ...bandParameters
      ],
      vwapOutputs,
      bandFills
    ),
    history: averageHistory,
    barOffsets: vwapOffsets,
    calculate(bars, params, context) {
      if (params.intradayOnly && (context?.chartIntervalDays ?? 0) >= 1) return hiddenVwap(bars);
      const starts = anchoredPeriodStarts(bars, params.anchor, context);
      return vwapValues(vwap(bars, starts, vwapOptions(params)), params);
    }
  }),
  defineCatalogStudy<"vwap-auto-anchored", AutoVwapParameters>({
    catalogId: "VWAPAA@tv-basicstudies",
    definition: overlay(
      "vwap-auto-anchored",
      "Auto Anchored VWAP",
      "VWAP AA",
      "https://www.tradingview.com/support/solutions/43000652199-vwap-auto-anchored/",
      [
        { key: "anchor", type: "choice", defaultValue: "auto", choices: autoAnchorChoices },
        integer("length", 100),
        source("hlc3"),
        offset(),
        ...bandParameters
      ],
      vwapOutputs,
      bandFills
    ),
    history: averageHistory,
    barOffsets: vwapOffsets,
    calculate(bars, params, context) {
      return vwapValues(
        autoAnchoredVwap(bars, autoAnchor(bars, params, context), vwapOptions(params)),
        params
      );
    }
  }),
  defineCatalogStudy<"twap", AnchoredParameters>({
    catalogId: "STD;Time%1Weighted%1Average%1Price",
    definition: overlay(
      "twap",
      "Time Weighted Average Price",
      "TWAP",
      "https://www.tradingview.com/support/solutions/43000692939-time-weighted-average-price/",
      [calendarAnchor, source("ohlc4"), offset()],
      [output("value", "TWAP", "#2962FF")]
    ),
    history: averageHistory,
    barOffsets: averageOffsets,
    calculate(bars, params, context) {
      return {
        value: twap(bars, anchoredPeriodStarts(bars, params.anchor, context), params.source).values
      };
    }
  }),
  defineCatalogStudy<"visible-average-price", AnchoredStudyParameters["visible-average-price"]>({
    catalogId: "STD;Visible%1Average%1Price",
    definition: overlay(
      "visible-average-price",
      "Visible Average Price",
      "Avg price",
      "https://www.tradingview.com/support/solutions/43000678766-visible-average-price/",
      [source("close")],
      [output("value", "Visible average", "#2962FF")]
    ),
    history: () => ({
      warmupBars: 1,
      historyRequirement: {
        kind: "viewport",
        lookbackBars: null,
        seedPolicy: "first-visible-candle",
        convergence: "full-input-dependent"
      }
    }),
    calculate(bars, params, context) {
      const result = visibleAveragePrice(bars, context?.visibleRange ?? null, params.source);
      return {
        value:
          result.status === "computed"
            ? bars.map((bar) =>
                bar.timestamp >= result.from && bar.timestamp <= result.to ? result.value : null
              )
            : empty(bars)
      };
    }
  }),
  defineCatalogStudy<"ichimoku-cloud", IchimokuParameters>({
    catalogId: "STD;Ichimoku%1Cloud",
    definition: overlay(
      "ichimoku-cloud",
      "Ichimoku Cloud",
      "Ichimoku",
      "https://www.tradingview.com/support/solutions/43000589152-ichimoku-cloud/",
      [
        integer("conversionLength", ICHIMOKU_DEFAULTS.conversionLength),
        integer("baseLength", ICHIMOKU_DEFAULTS.baseLength),
        integer("spanBLength", ICHIMOKU_DEFAULTS.spanBLength),
        integer("displacement", ICHIMOKU_DEFAULTS.displacement, 1, 501)
      ],
      [
        output("conversion", "Conversion line", "#2962FF"),
        output("base", "Base line", "#B71C1C"),
        output("lagging", "Lagging span", "#43A047"),
        output("spanA", "Leading span A", "#168755"),
        output("spanB", "Leading span B", "#D14343")
      ],
      [
        {
          id: "cloud",
          fromSeries: "spanA",
          toSeries: "spanB",
          color: "#168755",
          belowColor: "#D14343",
          opacity: 0.2,
          gaps: "break"
        }
      ]
    ),
    history: ({ conversionLength, baseLength, spanBLength }) => ({
      warmupBars: 1,
      historyRequirement: {
        kind: "finite",
        lookbackBars: Math.max(conversionLength, baseLength, spanBLength),
        seedPolicy: "window",
        convergence: "exact-after-lookback"
      }
    }),
    barOffsets: ({ displacement }) => ({
      spanA: displacement - 1,
      spanB: displacement - 1,
      lagging: 1 - displacement
    }),
    calculate: (bars, params) =>
      Object.fromEntries(
        Object.entries(ichimokuCloud(bars, params)).map(([id, line]) => [id, line.values])
      )
  }),
  defineCatalogStudy<"williams-alligator", AlligatorParameters>({
    catalogId: "STD;Williams_Alligator",
    definition: overlay(
      "williams-alligator",
      "Williams Alligator",
      "Alligator",
      "https://www.metatrader5.com/en/mobile-trading/iphone/help/chart/indicators/bw_indicators/alligator",
      [
        integer("jawLength", ALLIGATOR_DEFAULTS.jawLength),
        integer("teethLength", ALLIGATOR_DEFAULTS.teethLength),
        integer("lipsLength", ALLIGATOR_DEFAULTS.lipsLength),
        offset("jawOffset", ALLIGATOR_DEFAULTS.jawOffset),
        offset("teethOffset", ALLIGATOR_DEFAULTS.teethOffset),
        offset("lipsOffset", ALLIGATOR_DEFAULTS.lipsOffset)
      ],
      [
        output("jaw", "Jaw", "#2962FF"),
        output("teeth", "Teeth", "#D14343"),
        output("lips", "Lips", "#168755")
      ]
    ),
    history: ({ jawLength, teethLength, lipsLength }) => ({
      warmupBars: Math.min(jawLength, teethLength, lipsLength),
      historyRequirement: {
        kind: "recursive",
        lookbackBars: null,
        seedBars: Math.max(jawLength, teethLength, lipsLength),
        seedPolicy: "sma-of-first-length",
        convergence: "full-input-dependent"
      }
    }),
    barOffsets: ({ jawOffset, teethOffset, lipsOffset }) => ({
      jaw: jawOffset,
      teeth: teethOffset,
      lips: lipsOffset
    }),
    calculate: (bars, params) =>
      Object.fromEntries(
        Object.entries(williamsAlligator(bars, params)).map(([id, line]) => [id, line.values])
      )
  })
] as const;
