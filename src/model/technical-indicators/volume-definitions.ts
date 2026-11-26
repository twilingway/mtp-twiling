import { volumeFlowPresets } from "./volume-flow/metadata.js";
import type { VolumeFlowId } from "./volume-flow/metadata.js";
import type { ParameterDefinition, TechnicalIndicatorDefinition } from "./types.js";

const shortTitles: Readonly<Record<VolumeFlowId, string>> = {
  cmf: "CMF",
  "chaikin-oscillator": "Chaikin osc",
  efi: "EFI",
  eom: "EOM",
  "volume-oscillator": "PVO",
  nvi: "NVI",
  pvi: "PVI"
};

/** Append-only registration; numeric output keys are explicit in the reviewed manifest. */
export const volumeIndicatorDefinitions: readonly TechnicalIndicatorDefinition[] =
  volumeFlowPresets.map((preset): TechnicalIndicatorDefinition => ({
    schemaVersion: 1,
    id: preset.id,
    title: preset.title,
    shortTitle: shortTitles[preset.id],
    status: "computed",
    defaultPane: "pane",
    parameters: preset.parameters.map((parameter): ParameterDefinition =>
      parameter.type === "choice"
        ? {
            key: parameter.key,
            type: "choice",
            defaultValue: parameter.defaultValue,
            choices: ["EMA", "SMA"]
          }
        : { ...parameter }
    ),
    outputs: preset.outputs.map((output) => ({
      ...output,
      color:
        output.id === "histogram"
          ? "#26a69a"
          : output.id === "signal" || output.id === "average"
            ? "#ff6d00"
            : "#2962ff"
    })),
    levels: preset.id === "nvi" || preset.id === "pvi" ? [] : [0],
    references: [preset.reference]
  }));
