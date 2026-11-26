import type { PitchforkStyle } from "../ta-batch-fib-geometry.js";
import type { ParameterDefinition } from "../types.js";
import { autoPitchfork } from "./auto-sloped-geometry.js";
import { autoTrendlines } from "./auto-trendlines.js";
import type { AutoTrendline, AutoTrendlineOptions } from "./auto-trendlines.js";
import type { TechnicalPriceDecoration } from "./calendar-geometry.js";
import { defineCatalogStudy } from "./contract.js";

interface PitchforkParameters {
  readonly depth: number;
  readonly variant: PitchforkStyle;
  readonly innerRatio: number;
  readonly outerRatio: number;
  readonly extendLeft: boolean;
  readonly transparency: number;
}

interface TrendlineParameters extends AutoTrendlineOptions {
  readonly showPivots: boolean;
}

export interface AutoSlopedStudyParameters {
  "auto-pitchfork": PitchforkParameters;
  "auto-trendlines": TrendlineParameters;
}

const integer = (
  key: string,
  defaultValue: number,
  min: number,
  max: number
): ParameterDefinition => ({ key, type: "integer", defaultValue, min, max });
const ratio = (key: string, defaultValue: number): ParameterDefinition => ({
  key,
  type: "number",
  defaultValue,
  min: 0.01,
  max: 20
});
const checked = (key: string, defaultValue: boolean): ParameterDefinition => ({
  key,
  type: "boolean",
  defaultValue
});
const style = (id: string, title: string, color: string, opacity = 0.95) => ({
  id,
  title,
  color,
  opacity
});

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

const trendStyles = {
  small: { support: "smallSupport", resistance: "smallResistance" },
  large: { support: "largeSupport", resistance: "largeResistance" }
} as const;

function trendlineDecorations(
  lines: readonly AutoTrendline[],
  showPivots: boolean
): TechnicalPriceDecoration[] {
  const placed = new Set<string>();
  const plots: TechnicalPriceDecoration[] = [];
  for (const item of lines) {
    plots.push({
      kind: "sloped-line",
      styleId: trendStyles[item.size][item.side],
      line: item.line,
      startIndex: item.startIndex,
      endIndex: item.endIndex
    });
    if (!showPivots) continue;
    for (const anchor of item.anchors) {
      const key = `${anchor.kind}:${anchor.timestamp}`;
      if (placed.has(key)) continue;
      placed.add(key);
      plots.push({
        kind: "price-circle",
        styleId: "pivots",
        timestamp: anchor.timestamp,
        price: anchor.value
      });
    }
  }
  return plots;
}

export const autoSlopedStudies = [
  defineCatalogStudy<"auto-pitchfork", PitchforkParameters>({
    catalogId: "STD;Auto%1Pitchfork",
    definition: {
      id: "auto-pitchfork",
      schemaVersion: 1,
      status: "computed",
      defaultPane: "overlay",
      title: "Автоматические вилы",
      shortTitle: "Автовилы",
      parameters: [
        integer("depth", 10, 2, 10000),
        {
          key: "variant",
          type: "choice",
          defaultValue: "original",
          choices: ["original", "schiff", "modified-schiff", "inside"]
        },
        ratio("innerRatio", 0.5),
        ratio("outerRatio", 1),
        checked("extendLeft", false),
        integer("transparency", 88, 0, 100)
      ],
      outputs: [],
      levels: [],
      priceRegionStyles: [
        style("median", "Медиана", "#775DD9"),
        style("inner", "Внутренние линии", "#8E73DC"),
        style("outer", "Внешние линии", "#6E53BC"),
        style("background", "Заливка", "#8E73DC", 1)
      ],
      references: ["https://www.tradingview.com/support/solutions/43000657911-auto-pitchfork/"]
    },
    validParams: (params) => params.innerRatio <= params.outerRatio,
    history: ({ depth }) => history(2 * Math.floor(depth / 2) + 3, 2 * Math.floor(depth / 2) + 1),
    calculate: () => ({}),
    priceRegions: (bars, params, context) => autoPitchfork(bars, params, context?.lastBarClosed)
  }),
  defineCatalogStudy<"auto-trendlines", TrendlineParameters>({
    catalogId: "AutoTrendlinesCP@tv-chart_patterns",
    definition: {
      id: "auto-trendlines",
      schemaVersion: 1,
      status: "computed",
      defaultPane: "overlay",
      title: "Автоматические трендовые линии",
      shortTitle: "Автотренд",
      parameters: [
        { key: "size", type: "choice", defaultValue: "both", choices: ["small", "large", "both"] },
        integer("barsToBreakout", 3, 1, 100),
        checked("extendRight", true),
        checked("showPivots", false)
      ],
      outputs: [],
      levels: [],
      priceRegionStyles: [
        style("smallSupport", "Малая поддержка", "#258F76"),
        style("smallResistance", "Малое сопротивление", "#CEA448"),
        style("largeSupport", "Крупная поддержка", "#287FC0"),
        style("largeResistance", "Крупное сопротивление", "#C65D69"),
        style("pivots", "Опорные точки", "#9287B7")
      ],
      references: ["https://www.tradingview.com/support/solutions/43000741165-auto-trendlines/"]
    },
    history: ({ size }) => history(size === "large" ? 53 : 21, 14),
    calculate: () => ({}),
    priceRegions: (bars, params, context) =>
      trendlineDecorations(autoTrendlines(bars, params, context?.lastBarClosed), params.showPivots)
  })
] as const;
