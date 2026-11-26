import { relativeRegisteredDefinitions } from "./relative-registration-definitions.js";
import { catalogExpansionStudies } from "./catalog-expansion/registry.js";
import type {
  TechnicalIndicatorDefinition,
  TechnicalIndicatorId,
  UnsupportedIndicatorDefinition
} from "./types.js";
import { movingAveragePresets } from "./averages/metadata.js";
import { momentumVolumePresets } from "./momentum-volume/metadata.js";
import { volatilityIndicatorDefinitions } from "./volatility-definitions.js";
import { trendStrengthIndicatorDefinitions } from "./trend-definitions.js";
import { volumeIndicatorDefinitions } from "./volume-definitions.js";
import { stateOscillatorDefinitions } from "./state-oscillator-definitions.js";
import { trendPriceDefinitions } from "./trend-price-definitions.js";
import { channelPriceDefinitions } from "./channel-average-definitions.js";
import { keltnerDefinition } from "./keltner-definition.js";

const reference = (name: string) =>
  `https://www.tradingview.com/pine-script-reference/v6/#fun_ta.${name}`;
function freezeData<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}
const length = (key = "length", value = 20) => ({
  key,
  type: "integer" as const,
  defaultValue: value,
  min: 1,
  max: 10000
});
const source = { key: "source", type: "source" as const, defaultValue: "close" as const };
const line = (id: string, title: string, color = "#2962ff") => ({
  id,
  title,
  kind: "line" as const,
  color
});
const definition = (
  id: TechnicalIndicatorId,
  title: string,
  shortTitle: string,
  defaultPane: "overlay" | "pane",
  parameters: TechnicalIndicatorDefinition["parameters"],
  outputs: TechnicalIndicatorDefinition["outputs"],
  references: string[],
  levels: number[] = []
): TechnicalIndicatorDefinition => ({
  schemaVersion: 1,
  id,
  title,
  shortTitle,
  status: "computed",
  defaultPane,
  parameters,
  outputs,
  references,
  levels
});

/** Data only: renderer/catalog consumers never deserialize executable calculations. */
export const technicalIndicatorDefinitions: readonly TechnicalIndicatorDefinition[] = freezeData([
  ...momentumVolumePresets.map((preset) =>
    definition(
      preset.id,
      preset.title,
      preset.shortTitle,
      preset.defaultPane,
      [
        ...(preset.defaultLength === null
          ? []
          : [
              {
                ...length("length", preset.defaultLength),
                min: preset.minLength!,
                max: preset.maxLength!
              }
            ]),
        ...(["momentum", "roc", "cci", "williams-r"].includes(preset.id)
          ? [{ ...source, defaultValue: preset.defaultSource! }]
          : [])
      ],
      [line("value", preset.shortTitle, "#7e57c2")],
      [preset.reference],
      preset.id === "cci"
        ? [-100, 0, 100]
        : preset.id === "williams-r"
          ? [-80, -50, -20]
          : preset.id === "mfi"
            ? [20, 50, 80]
            : preset.id === "momentum" || preset.id === "roc"
              ? [0]
              : []
    )
  ),
  ...movingAveragePresets.map((preset) =>
    definition(
      preset.id,
      preset.title,
      preset.shortTitle,
      preset.defaultPane,
      [{ ...length("length", preset.defaultLength), min: preset.minLength }, source],
      [line("value", preset.shortTitle)],
      [preset.reference]
    )
  ),
  definition(
    "sma",
    "Simple Moving Average",
    "SMA",
    "overlay",
    [length(), source],
    [line("value", "SMA")],
    [reference("sma")]
  ),
  definition(
    "ema",
    "Exponential Moving Average",
    "EMA",
    "overlay",
    [length(), source],
    [line("value", "EMA")],
    [reference("ema")]
  ),
  definition(
    "rsi",
    "Relative Strength Index",
    "RSI",
    "pane",
    [length("length", 14), source],
    [line("value", "RSI", "#7e57c2")],
    [reference("rma"), "https://pine-facade.tradingview.com/pine-facade/get/STD%3BRSI/last"],
    [30, 50, 70]
  ),
  definition(
    "macd",
    "Moving Average Convergence Divergence",
    "MACD",
    "pane",
    [length("fastLength", 12), length("slowLength", 26), length("signalLength", 9), source],
    [
      line("macd", "MACD"),
      line("signal", "Signal", "#ff6d00"),
      { ...line("histogram", "Histogram", "#26a69a"), kind: "histogram" }
    ],
    [reference("macd"), reference("ema")],
    [0]
  ),
  definition(
    "bollinger-bands",
    "Bollinger Bands",
    "BB",
    "overlay",
    [length(), { key: "multiplier", type: "number", defaultValue: 2, min: 0, max: 100 }, source],
    [line("basis", "Basis", "#ff6d00"), line("upper", "Upper"), line("lower", "Lower")],
    [reference("bb"), reference("stdev")]
  ),
  definition(
    "atr",
    "Average True Range",
    "ATR",
    "pane",
    [length("length", 14)],
    [line("value", "ATR", "#b71c1c")],
    [reference("atr"), reference("tr"), reference("rma")]
  ),
  definition(
    "stochastic",
    "Stochastic",
    "Stoch",
    "pane",
    [length("length", 14), length("smoothK", 3), length("smoothD", 3)],
    [line("k", "%K"), line("d", "%D", "#ff6d00")],
    [
      reference("stoch"),
      reference("sma"),
      "https://www.tradingview.com/support/solutions/43000502332-stochastic-stoch/"
    ],
    [20, 80]
  ),
  ...volatilityIndicatorDefinitions,
  ...trendStrengthIndicatorDefinitions,
  ...volumeIndicatorDefinitions,
  ...stateOscillatorDefinitions,
  ...trendPriceDefinitions,
  ...channelPriceDefinitions,
  keltnerDefinition,
  ...relativeRegisteredDefinitions,
  ...catalogExpansionStudies.map(({ definition }) => definition)
]);

/** A real catalog limitation, not a claimed OHLCV implementation. No 224 fake calculators. */
export const unsupportedTechnicalIndicatorDefinitions: readonly UnsupportedIndicatorDefinition[] =
  freezeData([
    {
      schemaVersion: 1,
      id: "advance-decline-line",
      title: "Advance/Decline Line",
      status: "unsupported",
      reason:
        "Требуются данные о растущих и падающих инструментах рынка; одной OHLCV серии недостаточно.",
      requiredData: ["market-breadth"]
    }
  ]);
export function getTechnicalIndicatorDefinition(
  id: string
): TechnicalIndicatorDefinition | UnsupportedIndicatorDefinition | null {
  return (
    technicalIndicatorDefinitions.find((item) => item.id === id) ??
    unsupportedTechnicalIndicatorDefinitions.find((item) => item.id === id) ??
    null
  );
}
export const PRICE_SOURCES = Object.freeze([
  "open",
  "high",
  "low",
  "close",
  "hl2",
  "hlc3",
  "ohlc4",
  "volume"
] as const);
