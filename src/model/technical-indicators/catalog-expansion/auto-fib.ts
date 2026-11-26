import { fibonacciExtensionLevels, fibonacciRetracementLevels } from "../ta-batch-fib-geometry.js";
import type { ParameterDefinition } from "../types.js";
import {
  AUTO_FIB_ATR_LENGTH,
  autoFibExtensionAnchors,
  autoFibRetracementAnchors
} from "./auto-fib-anchors.js";
import type { TechnicalPriceRegion } from "./calendar-geometry.js";
import { defineCatalogStudy } from "./contract.js";

const levelPresets = [
  { id: "level0", defaultValue: 0, color: "#737983" },
  { id: "level1", defaultValue: 0.236, color: "#ba3d49" },
  { id: "level2", defaultValue: 0.382, color: "#318852" },
  { id: "level3", defaultValue: 0.5, color: "#438824" },
  { id: "level4", defaultValue: 0.618, color: "#00867e" },
  { id: "level5", defaultValue: 0.786, color: "#3680c3" },
  { id: "level6", defaultValue: 1, color: "#737983" },
  { id: "level7", defaultValue: 1.618, color: "#355fcb" },
  { id: "level8", defaultValue: 2.618, color: "#ba3d49" },
  { id: "level9", defaultValue: 3.618, color: "#9b42a8" },
  { id: "level10", defaultValue: 4.236, color: "#ad557a" }
] as const;

type CoefficientId = (typeof levelPresets)[number]["id"];
type AutoFibParameters = Record<CoefficientId, number> & {
  depth: number;
  reverse: boolean;
  extend: "None" | "Left" | "Right" | "Both";
  showPrices: boolean;
  showLevels: boolean;
  levelFormat: "Values" | "Percent";
  labelSide: "Left" | "Right";
};

export interface AutoFibStudyParameters {
  "auto-fib-retracement": AutoFibParameters & { deviation: number };
  "auto-fib-extension": AutoFibParameters;
}

const depth: ParameterDefinition = {
  key: "depth",
  type: "integer",
  defaultValue: 10,
  min: 2,
  max: 10000
};
const commonParameters: readonly ParameterDefinition[] = [
  { key: "reverse", type: "boolean", defaultValue: false },
  {
    key: "extend",
    type: "choice",
    defaultValue: "Right",
    choices: ["None", "Left", "Right", "Both"]
  },
  { key: "showPrices", type: "boolean", defaultValue: true },
  { key: "showLevels", type: "boolean", defaultValue: true },
  { key: "levelFormat", type: "choice", defaultValue: "Values", choices: ["Values", "Percent"] },
  { key: "labelSide", type: "choice", defaultValue: "Left", choices: ["Left", "Right"] },
  ...levelPresets.map(({ id, defaultValue }): ParameterDefinition => ({
    key: id,
    type: "number",
    min: -100,
    max: 100,
    defaultValue
  }))
];
const priceRegionStyles = levelPresets.map(({ id, defaultValue, color }) => ({
  id,
  title: `Уровень ${defaultValue}`,
  color,
  opacity: 0.9
}));

function history(warmupBars: number, seedBars: number) {
  return {
    warmupBars,
    historyRequirement: {
      kind: "recursive" as const,
      lookbackBars: null,
      seedBars,
      seedPolicy: "alternating-confirmed-extrema" as const,
      convergence: "full-input-dependent" as const
    }
  };
}

function coefficients(params: AutoFibParameters): number[] {
  return levelPresets.map(({ id }) => params[id]);
}

function priceRegions(
  levels: readonly { value: number | null }[],
  firstTimestamp: number,
  secondTimestamp: number,
  params: AutoFibParameters
): TechnicalPriceRegion[] {
  const extendLeft = params.extend === "Left" || params.extend === "Both";
  const extendRight = params.extend === "Right" || params.extend === "Both";
  return levelPresets.flatMap(({ id }, index) => {
    const value = levels[index]!.value;
    if (value === null) return [];
    const ratio = params[id];
    const caption =
      params.levelFormat === "Percent" ? `${Number((ratio * 100).toFixed(4))}%` : String(ratio);
    return [
      {
        styleId: id,
        startTimestamp: firstTimestamp,
        endTimestamp: extendRight ? null : secondTimestamp,
        startEdge: "center",
        endEdge: "center",
        extendLeft,
        low: value,
        high: value,
        labelEdge: params.labelSide === "Left" ? "left" : "right",
        label: {
          ...(params.showLevels ? { name: caption } : {}),
          ...(params.showPrices ? { price: value } : {})
        }
      }
    ];
  });
}

export const autoFibStudies = [
  defineCatalogStudy<"auto-fib-retracement", AutoFibStudyParameters["auto-fib-retracement"]>({
    catalogId: "STD;Auto%1Fib%1Retracement%1",
    definition: {
      id: "auto-fib-retracement",
      schemaVersion: 1,
      status: "computed",
      title: "Автоматическая коррекция Фибоначчи",
      shortTitle: "Фибо · коррекция",
      defaultPane: "overlay",
      parameters: [
        depth,
        { key: "deviation", type: "number", defaultValue: 3, min: 0, max: 10000 },
        ...commonParameters
      ],
      outputs: [],
      levels: [],
      priceRegionStyles,
      references: [
        "https://www.tradingview.com/support/solutions/43000585089-auto-fib-retracement/",
        "https://pine-facade.tradingview.com/pine-facade/get/STD%3BAuto%251Fib%251Retracement%251/41.0"
      ]
    },
    history: ({ depth: bars }) =>
      history(Math.max(AUTO_FIB_ATR_LENGTH, 2 * Math.floor(bars / 2) + 2), AUTO_FIB_ATR_LENGTH),
    calculate: () => ({}),
    priceRegions: (bars, params, context) => {
      const anchors = autoFibRetracementAnchors(
        bars,
        params.depth,
        params.deviation,
        context?.lastBarClosed
      );
      if (!anchors) return [];
      const levels = fibonacciRetracementLevels(anchors, coefficients(params), params.reverse);
      return priceRegions(levels, anchors[0].timestamp, anchors[1].timestamp, params);
    }
  }),
  defineCatalogStudy<"auto-fib-extension", AutoFibStudyParameters["auto-fib-extension"]>({
    catalogId: "STD;Auto%1Fib%1Extension%1",
    definition: {
      id: "auto-fib-extension",
      schemaVersion: 1,
      status: "computed",
      title: "Автоматическое расширение Фибоначчи",
      shortTitle: "Фибо · расширение",
      defaultPane: "overlay",
      parameters: [depth, ...commonParameters],
      outputs: [],
      levels: [],
      priceRegionStyles,
      references: [
        "https://www.tradingview.com/support/solutions/43000612397-auto-fib-extension/",
        "https://pine-facade.tradingview.com/pine-facade/get/STD%3BAuto%251Fib%251Extension%251/31.0"
      ]
    },
    history: ({ depth: bars }) =>
      history(2 * Math.floor(bars / 2) + 3, 2 * Math.floor(bars / 2) + 1),
    calculate: () => ({}),
    priceRegions: (bars, params, context) => {
      const anchors = autoFibExtensionAnchors(bars, params.depth, context?.lastBarClosed);
      if (!anchors) return [];
      // Reversal keeps the extension origin and mirrors the impulse sign.
      const ratios = coefficients(params).map((ratio) => (params.reverse ? -ratio : ratio));
      const levels = fibonacciExtensionLevels(anchors, ratios);
      return priceRegions(levels, anchors[1].timestamp, anchors[2].timestamp, params);
    }
  })
] as const;
