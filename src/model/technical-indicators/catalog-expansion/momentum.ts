import { priceSource } from "../data.js";
import type { PlotPrecisionPolicy, PresentationDefinition } from "../presentation-types.js";
import { detrendedPriceOscillator } from "../ta-batch-oscillators-dpo.js";
import {
  priceOscillatorHistory,
  priceOscillatorPresets
} from "../ta-batch-oscillators-metadata.js";
import { connorsRsi } from "../ta-batch-oscillators-rank.js";
import {
  percentagePriceOscillator,
  priceMomentumOscillator,
  smiErgodicIndicator,
  smiErgodicOscillator,
  stochasticMomentumIndex
} from "../ta-batch-oscillators.js";
import type { PriceOscillatorAverage } from "../ta-batch-oscillators.js";
import type { NumericSeries, PriceSource, TechnicalBar } from "../types.js";
import { defineCatalogStudy } from "./contract.js";
import type { CatalogStudyHistory } from "./contract.js";

type ErgodicParameters = { shortLength: number; longLength: number; signalLength: number };

export interface MomentumStudyParameters {
  pmo: { source: PriceSource; firstLength: number; secondLength: number; signalLength: number };
  ppo: {
    source: PriceSource;
    fastLength: number;
    slowLength: number;
    signalLength: number;
    oscillatorAverage: PriceOscillatorAverage;
    signalAverage: PriceOscillatorAverage;
  };
  smi: { kLength: number; dLength: number; emaLength: number };
  "smi-ergodic-indicator": ErgodicParameters;
  "smi-ergodic-oscillator": ErgodicParameters;
  "connors-rsi": { priceLength: number; streakLength: number; rankLength: number };
  dpo: { length: number; centered: boolean };
}

function registerMomentumStudy<K extends keyof MomentumStudyParameters>(
  id: K,
  history: (params: MomentumStudyParameters[K]) => CatalogStudyHistory,
  calculate: (
    bars: readonly TechnicalBar[],
    params: MomentumStudyParameters[K]
  ) => Readonly<Record<string, NumericSeries>>,
  precisionPolicy: PlotPrecisionPolicy = "fixed-2"
) {
  const { catalogId, levels, ...preset } = priceOscillatorPresets[id];
  const presentation: PresentationDefinition = {
    renderVersion: 2,
    precisionPolicy,
    plots: preset.outputs.map(({ id, kind, color }) => ({
      id,
      seriesKey: id,
      geometry:
        kind === "histogram" ? { kind: "columns", base: 0 } : { kind: "line", gaps: "break" },
      color: { kind: "solid", color },
      width: 1
    })),
    fills: [],
    hiddenSeries: [],
    referenceLevels: levels.map((value) => ({
      id: `level-${value}`,
      title: String(value),
      value,
      color: "#787B86",
      opacity: 0.65,
      width: 1,
      lineStyle: "dashed"
    }))
  };
  return defineCatalogStudy<K, MomentumStudyParameters[K]>({
    catalogId,
    definition: {
      ...preset,
      id,
      schemaVersion: 1,
      status: "computed",
      defaultPane: "pane",
      levels: [],
      presentation
    },
    history,
    calculate
  });
}

export const momentumStudies = [
  registerMomentumStudy("pmo", priceOscillatorHistory.pmo, (bars, params) =>
    priceMomentumOscillator(priceSource(bars, params.source), params)
  ),
  registerMomentumStudy("ppo", priceOscillatorHistory.ppo, (bars, params) =>
    percentagePriceOscillator(priceSource(bars, params.source), params)
  ),
  registerMomentumStudy("smi", priceOscillatorHistory.smi, stochasticMomentumIndex),
  registerMomentumStudy(
    "smi-ergodic-indicator",
    priceOscillatorHistory["smi-ergodic-indicator"],
    (bars, params) => smiErgodicIndicator(priceSource(bars, "close"), params),
    "legacy-fixed-6"
  ),
  registerMomentumStudy(
    "smi-ergodic-oscillator",
    priceOscillatorHistory["smi-ergodic-oscillator"],
    (bars, params) => smiErgodicOscillator(priceSource(bars, "close"), params),
    "legacy-fixed-6"
  ),
  registerMomentumStudy("connors-rsi", priceOscillatorHistory["connors-rsi"], (bars, params) =>
    connorsRsi(priceSource(bars, "close"), params)
  ),
  // The centered kernel already returns values at their displayed candle indices.
  registerMomentumStudy(
    "dpo",
    priceOscillatorHistory.dpo,
    (bars, params) => detrendedPriceOscillator(priceSource(bars, "close"), params),
    "native-price"
  )
] as const;
