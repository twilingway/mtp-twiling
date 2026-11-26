import { channelAveragePresets } from "./channel-average/index.js";
import type { ChannelPriceId } from "./channel-average-contract.js";
import type { ParameterDefinition, TechnicalIndicatorDefinition } from "./types.js";

const preset = (id: ChannelPriceId) => channelAveragePresets.find((entry) => entry.id === id)!;
const number = (
  key: string,
  defaultValue: number,
  min: number,
  max: number,
  integer = false
): ParameterDefinition => ({ key, defaultValue, min, max, type: integer ? "integer" : "number" });
function definition(
  id: ChannelPriceId,
  title: string,
  shortTitle: string,
  parameters: readonly ParameterDefinition[],
  outputs: TechnicalIndicatorDefinition["outputs"]
): TechnicalIndicatorDefinition {
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
    references: [preset(id).reference],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "native-price",
      plots: outputs.map((output) => ({
        id: output.id,
        seriesKey: output.id,
        geometry: { kind: "line", gaps: "break" },
        color: { kind: "solid", color: output.color },
        width: 1
      })),
      fills: [],
      hiddenSeries: []
    }
  };
}
const line = (id: string, title: string, color = "#2962FF") => ({
  id,
  title,
  kind: "line" as const,
  color
});
export const channelPriceDefinitions: readonly TechnicalIndicatorDefinition[] = [
  definition(
    "alma",
    "Arnaud Legoux Moving Average",
    "ALMA",
    [
      number("length", 9, 1, 10000, true),
      number("offset", 0.85, -100, 100),
      number("sigma", 6, 0.000001, 10000)
    ],
    [line("value", "ALMA")]
  ),
  definition(
    "lsma",
    "Least Squares Moving Average",
    "LSMA",
    [
      number("length", 25, 2, 10000, true),
      number("offset", 0, -10000, 10000, true),
      { key: "source", type: "source", defaultValue: "close" }
    ],
    [line("value", "LSMA")]
  ),
  definition(
    "chandelier-exit",
    "Chandelier Exit",
    "CE",
    [
      number("length", 22, 1, 10000, true),
      number("atrLength", 22, 1, 10000, true),
      number("multiplier", 3, 0, 1000000)
    ],
    [line("longExit", "Long Exit"), line("shortExit", "Short Exit", "#FF6D00")]
  )
];
