import { detrendedPriceOscillatorShift } from "./ta-batch-oscillators-dpo.js";
import type {
  LegacyRecursiveHistoryRequirement,
  ParameterDefinition,
  TechnicalHistoryRequirement,
  TechnicalOutputDefinition
} from "./types.js";

const period = (key: string, defaultValue: number, min = 1): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min,
  max: 10000
});
const average = (key: string): ParameterDefinition => ({
  key,
  type: "choice",
  defaultValue: "EMA",
  choices: ["EMA", "SMA"]
});
const close: ParameterDefinition = { key: "source", type: "source", defaultValue: "close" };
const line = (title: string): TechnicalOutputDefinition => ({
  id: "value",
  title,
  kind: "line",
  color: "#2962ff"
});
const signal: TechnicalOutputDefinition = {
  id: "signal",
  title: "Сигнал",
  kind: "line",
  color: "#ff6d00"
};
const histogram: TechnicalOutputDefinition = {
  id: "histogram",
  title: "Гистограмма",
  kind: "histogram",
  color: "#26a69a"
};
const ergodicPeriods = [
  period("shortLength", 5),
  period("longLength", 20),
  period("signalLength", 5)
];

type OscillatorPreset = {
  readonly catalogId: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly parameters: readonly ParameterDefinition[];
  readonly outputs: readonly TechnicalOutputDefinition[];
  readonly levels: readonly number[];
  readonly references: readonly string[];
};

export const priceOscillatorPresets = {
  pmo: {
    catalogId: "STD;Price_Momentum_Oscillator",
    title: "Price Momentum Oscillator",
    shortTitle: "PMO",
    parameters: [
      close,
      period("firstLength", 35, 2),
      period("secondLength", 20, 2),
      period("signalLength", 10)
    ],
    outputs: [line("PMO"), signal],
    levels: [0],
    references: [
      "https://www.tradingview.com/support/solutions/43000773010-price-momentum-oscillator-pmo/"
    ]
  },
  ppo: {
    catalogId: "STD;Price_Oscillator",
    title: "Percentage Price Oscillator",
    shortTitle: "PPO",
    parameters: [
      close,
      period("fastLength", 12),
      period("slowLength", 26),
      period("signalLength", 9),
      average("oscillatorAverage"),
      average("signalAverage")
    ],
    outputs: [line("PPO"), signal, histogram],
    levels: [0],
    references: [
      "https://www.tradingview.com/support/solutions/43000502346-percentage-price-oscillator-ppo/"
    ]
  },
  smi: {
    catalogId: "STD;SMI",
    title: "Stochastic Momentum Index",
    shortTitle: "SMI",
    parameters: [period("kLength", 10), period("dLength", 3), period("emaLength", 3)],
    outputs: [line("SMI"), signal],
    levels: [-40, 0, 40],
    references: [
      "https://www.tradingview.com/support/solutions/43000707882-stochastic-momentum-index-smi/"
    ]
  },
  "smi-ergodic-indicator": {
    catalogId: "STD;SMI_Ergodic_Indicator_Oscillator",
    title: "SMI Ergodic Indicator",
    shortTitle: "SMII",
    parameters: ergodicPeriods,
    outputs: [line("SMII"), signal],
    levels: [0],
    references: ["https://www.tradingview.com/support/solutions/43000594669-smi-ergodic-indicator/"]
  },
  "smi-ergodic-oscillator": {
    catalogId: "STD;SMI_Ergodic_Oscillator",
    title: "SMI Ergodic Oscillator",
    shortTitle: "SMIO",
    parameters: ergodicPeriods,
    outputs: [histogram],
    levels: [0],
    references: [
      "https://www.tradingview.com/support/solutions/43000594671-smi-ergodic-oscillator/"
    ]
  },
  "connors-rsi": {
    catalogId: "STD;Connors_RSI",
    title: "RSI Коннора",
    shortTitle: "CRSI",
    parameters: [period("priceLength", 3), period("streakLength", 2), period("rankLength", 100)],
    outputs: [line("CRSI")],
    levels: [10, 90],
    references: ["https://www.tradingview.com/support/solutions/43000502017-connors-rsi-crsi/"]
  },
  dpo: {
    catalogId: "STD;DPO",
    title: "Detrended Price Oscillator",
    shortTitle: "DPO",
    parameters: [period("length", 21), { key: "centered", type: "boolean", defaultValue: false }],
    outputs: [line("DPO")],
    levels: [0],
    references: [
      "https://www.tradingview.com/support/solutions/43000502246-detrended-price-oscillator-dpo/"
    ]
  }
} satisfies Record<string, OscillatorPreset>;

type OscillatorHistory = {
  warmupBars: number;
  historyRequirement: TechnicalHistoryRequirement;
};

function recursive(seedBars: number): OscillatorHistory {
  return {
    warmupBars: seedBars,
    historyRequirement: {
      kind: "recursive",
      lookbackBars: null,
      seedBars,
      seedPolicy: "first-value-ema-chain",
      convergence: "full-input-dependent"
    }
  };
}

function finite(warmupBars: number, lookbackBars: number): OscillatorHistory {
  return {
    warmupBars,
    historyRequirement: {
      kind: "finite",
      lookbackBars,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    }
  };
}

export const priceOscillatorHistory = {
  pmo: () => recursive(2),
  ppo: ({
    fastLength,
    slowLength,
    signalLength,
    oscillatorAverage,
    signalAverage
  }: {
    fastLength: number;
    slowLength: number;
    signalLength: number;
    oscillatorAverage: "EMA" | "SMA";
    signalAverage: "EMA" | "SMA";
  }): OscillatorHistory => {
    const main = oscillatorAverage === "SMA" ? Math.max(fastLength, slowLength) : 1;
    return oscillatorAverage === "SMA" && signalAverage === "SMA"
      ? finite(main, main + signalLength - 1)
      : recursive(main);
  },
  smi: ({ kLength }: { kLength: number }) => recursive(kLength),
  "smi-ergodic-indicator": () => recursive(2),
  "smi-ergodic-oscillator": () => recursive(2),
  "connors-rsi": ({
    priceLength,
    streakLength,
    rankLength
  }: {
    priceLength: number;
    streakLength: number;
    rankLength: number;
  }): OscillatorHistory => {
    const seedBars = 1 + Math.max(priceLength, streakLength);
    const historyRequirement: LegacyRecursiveHistoryRequirement = {
      kind: "recursive",
      lookbackBars: null,
      seedBars,
      seedPolicy: "adjacent-change-wilder",
      convergence: "full-input-dependent"
    };
    return { warmupBars: Math.max(seedBars, rankLength + 2), historyRequirement };
  },
  dpo: ({ length, centered }: { length: number; centered: boolean }) => {
    const shiftBars = detrendedPriceOscillatorShift(length);
    const required = centered ? Math.max(length, shiftBars + 1) : length + shiftBars;
    return { ...finite(required, required), lookAheadBars: centered ? shiftBars : 0 };
  }
};
