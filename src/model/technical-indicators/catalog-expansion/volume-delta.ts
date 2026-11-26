import { isNativeIntervalId } from "../../intervals/registry.js";
import type { PresentationDefinition, PresentationPlot } from "../presentation-types.js";
import { cumulativeVolumeDelta, upDownVolume, volumeDelta } from "../ta-batch-volume-flow-delta.js";
import type { VolumeDeltaBar } from "../ta-batch-volume-flow-delta.js";
import {
  assembleIntrabarVolume,
  cumulativeVolumePeriods,
  intrabarVolumeInterval
} from "../ta-batch-volume-intrabars.js";
import type { VolumeDeltaAnchor } from "../ta-batch-volume-intrabars.js";
import type { NumericSeries, TechnicalBar, TechnicalCalculationContext } from "../types.js";
import { defineCatalogStudy } from "./contract.js";

export interface VolumeDeltaStudyParameters {
  "volume-delta": Record<never, never>;
  "cumulative-volume-delta": { anchor: VolumeDeltaAnchor };
  "up-down-volume": Record<never, never>;
}

type VolumeDeltaId = keyof VolumeDeltaStudyParameters;
export const volumeDeltaIds = [
  "volume-delta",
  "cumulative-volume-delta",
  "up-down-volume"
] as const;
export const isVolumeDeltaStudy = (id: string): id is VolumeDeltaId =>
  volumeDeltaIds.some((candidate) => candidate === id);

const openKey = "$delta:open";
const highKey = "$delta:high";
const lowKey = "$delta:low";
const colorKey = "$delta:color";
const positive = "#158977",
  negative = "#df4c54";
const colors = [negative, positive];

const candlePresentation: PresentationDefinition = {
  renderVersion: 2,
  plots: [
    {
      id: "delta",
      seriesKey: "delta",
      geometry: {
        kind: "candles",
        openSeriesKey: openKey,
        highSeriesKey: highKey,
        lowSeriesKey: lowKey
      },
      color: { kind: "indexed", seriesKey: colorKey, colors },
      width: 1
    }
  ],
  fills: [],
  hiddenSeries: [openKey, highKey, lowKey, colorKey]
};

const rangePlot = (id: "up" | "down", color: string): PresentationPlot => ({
  id,
  seriesKey: id,
  geometry: { kind: "columns", base: 0 },
  color: { kind: "solid", color },
  width: 1
});

function lowerInput(context: TechnicalCalculationContext | undefined) {
  const timeframe = context?.chartInterval;
  const lower = context?.volumeStudies?.intrabarVolume;
  return isNativeIntervalId(timeframe) &&
    lower &&
    lower.interval === intrabarVolumeInterval(timeframe)
    ? { timeframe, lower }
    : undefined;
}

function history(anchor?: VolumeDeltaAnchor) {
  return {
    warmupBars: 1,
    historyRequirement: {
      kind: "intrabar-volume",
      lookbackBars: null,
      ...(anchor ? { anchor } : {}),
      seedPolicy: "known-lower-coverage-and-direction",
      convergence: "exact-on-complete-window"
    }
  } as const;
}

function available(_barCount: number, _params: object, context?: TechnicalCalculationContext) {
  return lowerInput(context)?.lower.bars.length ? undefined : ("volume-unavailable" as const);
}

function candleSeries(candles: readonly (VolumeDeltaBar | null)[]): Record<string, NumericSeries> {
  return {
    delta: candles.map((bar) => bar?.close ?? null),
    [openKey]: candles.map((bar) => bar?.open ?? null),
    [highKey]: candles.map((bar) => bar?.high ?? null),
    [lowKey]: candles.map((bar) => bar?.low ?? null),
    [colorKey]: candles.map((bar) => (bar === null ? null : Number(bar.close >= bar.open)))
  };
}

function deltaDefinition<Id extends VolumeDeltaId>(
  id: Id,
  title: string,
  shortTitle: string,
  references: string[],
  parameters: readonly {
    key: "anchor";
    type: "choice";
    defaultValue: VolumeDeltaAnchor;
    choices: readonly [VolumeDeltaAnchor, ...VolumeDeltaAnchor[]];
  }[] = []
) {
  return {
    schemaVersion: 1,
    id,
    title,
    shortTitle,
    status: "computed",
    defaultPane: "pane",
    parameters,
    outputs: [{ id: "delta", title, kind: "line", color: positive }],
    levels: [0],
    references,
    presentation: candlePresentation
  } as const;
}

function deltas(
  bars: readonly TechnicalBar[],
  context?: TechnicalCalculationContext,
  anchor?: VolumeDeltaAnchor
) {
  const input = lowerInput(context);
  if (!input) return candleSeries(bars.map(() => null));
  const { timeframe, lower } = input;
  const periods = assembleIntrabarVolume(bars, timeframe, lower);
  return candleSeries(
    anchor
      ? cumulativeVolumeDelta(cumulativeVolumePeriods(periods, timeframe, anchor))
      : volumeDelta(periods)
  );
}

const delta = defineCatalogStudy<"volume-delta", VolumeDeltaStudyParameters["volume-delta"]>({
  catalogId: "VolumeDelta@tv-basicstudies",
  definition: deltaDefinition("volume-delta", "Volume Delta", "Vol delta", [
    "https://www.tradingview.com/support/solutions/43000725057-volume-delta/"
  ]),
  history: () => history(),
  unavailableReason: available,
  calculate: (bars, _params, context) => deltas(bars, context)
});

const cumulative = defineCatalogStudy<
  "cumulative-volume-delta",
  VolumeDeltaStudyParameters["cumulative-volume-delta"]
>({
  catalogId: "CumulativeVolumeDelta@tv-basicstudies",
  definition: deltaDefinition(
    "cumulative-volume-delta",
    "Cumulative Volume Delta",
    "CVD",
    ["https://www.tradingview.com/support/solutions/43000725058-cumulative-volume-delta/"],
    [{ key: "anchor", type: "choice", defaultValue: "1d", choices: ["1d", "1w", "1M"] }]
  ),
  history: ({ anchor }) => history(anchor),
  unavailableReason: available,
  calculate: (bars, { anchor }, context) => deltas(bars, context, anchor)
});

const upDown = defineCatalogStudy<"up-down-volume", VolumeDeltaStudyParameters["up-down-volume"]>({
  catalogId: "STD;UP_DOWN_Volume",
  definition: {
    schemaVersion: 1,
    id: "up-down-volume",
    title: "Up/Down Volume",
    shortTitle: "Up/Down vol",
    status: "computed",
    defaultPane: "pane",
    parameters: [],
    outputs: [
      { id: "up", title: "Up volume", kind: "histogram", color: positive },
      { id: "down", title: "Down volume", kind: "histogram", color: negative },
      { id: "delta", title: "Delta", kind: "line", color: positive }
    ],
    levels: [0],
    references: ["https://www.tradingview.com/support/solutions/43000672561-up-down-volume/"],
    presentation: {
      renderVersion: 2,
      plots: [
        rangePlot("up", positive),
        rangePlot("down", negative),
        {
          id: "delta",
          seriesKey: "delta",
          geometry: {
            kind: "marker",
            shape: "dash",
            placement: "center",
            size: { unit: "pine-relative", value: 1 }
          },
          color: { kind: "indexed", seriesKey: colorKey, colors },
          width: 1
        }
      ],
      fills: [],
      hiddenSeries: [colorKey]
    }
  },
  history: () => history(),
  unavailableReason: available,
  calculate: (bars, _params, context) => {
    const input = lowerInput(context);
    const values = input
      ? upDownVolume(assembleIntrabarVolume(bars, input.timeframe, input.lower))
      : bars.map(() => null);
    return {
      up: values.map((bar) => bar?.up ?? null),
      down: values.map((bar) => bar?.down ?? null),
      delta: values.map((bar) => bar?.delta ?? null),
      [colorKey]: values.map((bar) => (bar === null ? null : Number(bar.delta >= 0)))
    };
  }
});

export const volumeDeltaStudies = [delta, cumulative, upDown] as const;
