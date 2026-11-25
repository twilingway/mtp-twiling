import { assertLength } from "../primitives.js";
import type { TechnicalHistoryRequirement } from "../types.js";

export type MomentumVolumeId =
  "momentum" | "roc" | "cci" | "williams-r" | "mfi" | "obv" | "adl" | "pvt";
export interface MomentumVolumePreset {
  readonly id: MomentumVolumeId;
  readonly title: string;
  readonly shortTitle: string;
  readonly defaultPane: "pane";
  readonly defaultSource: "close" | "hlc3" | null;
  readonly defaultLength: number | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly requiresVolume: boolean;
  readonly status: "math-only";
  readonly reference: string;
}

function preset(
  id: MomentumVolumeId,
  title: string,
  shortTitle: string,
  pineId: string,
  defaultLength: number | null,
  defaultSource: "close" | "hlc3" | null,
  requiresVolume = false
): MomentumVolumePreset {
  return Object.freeze({
    id,
    title,
    shortTitle,
    defaultPane: "pane",
    defaultSource,
    defaultLength,
    minLength: defaultLength === null ? null : 1,
    maxLength: defaultLength === null ? null : id === "mfi" ? 2000 : 10000,
    requiresVolume,
    status: "math-only",
    reference: `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(pineId)}/last`
  });
}

/** Core output only: optional built-in smoothing lines are not part of this package. */
export const momentumVolumePresets: readonly MomentumVolumePreset[] = Object.freeze([
  preset("momentum", "Momentum", "Mom", "STD;Momentum", 10, "close"),
  preset("roc", "Rate of Change", "ROC", "STD;ROC", 9, "close"),
  preset("cci", "Commodity Channel Index", "CCI", "STD;CCI", 20, "hlc3"),
  preset("williams-r", "Williams %R", "%R", "STD;Willams_R", 14, "close"),
  preset("mfi", "Money Flow Index", "MFI", "STD;Money_Flow", 14, "hlc3", true),
  preset("obv", "On Balance Volume", "OBV", "STD;On_Balance_Volume", null, "close", true),
  preset(
    "adl",
    "Accumulation/Distribution",
    "Accum/dist",
    "STD;Accumulation_Distribution",
    null,
    null,
    true
  ),
  preset("pvt", "Price Volume Trend", "PVT", "STD;Price_Volume_Trend", null, "close", true)
]);

export interface CumulativeHistoryRequirement {
  readonly kind: "cumulative";
  readonly lookbackBars: null;
  readonly seedBars: 1 | 2;
  readonly seedPolicy: "zero-before-first-contribution";
  readonly missingPolicy: "gap-preserve-known-total";
  readonly convergence: "full-input-dependent";
}

export function momentumVolumeMetadata(id: MomentumVolumeId, length?: number) {
  const definition = momentumVolumePresets.find((item) => item.id === id);
  if (!definition) throw new RangeError("Unknown momentum/volume indicator");
  let historyRequirement: TechnicalHistoryRequirement | CumulativeHistoryRequirement;
  let warmupBars: number;
  if (definition.defaultLength === null) {
    if (length !== undefined) throw new RangeError("Cumulative indicator has no length");
    warmupBars = id === "adl" ? 1 : 2;
    historyRequirement = {
      kind: "cumulative",
      lookbackBars: null,
      seedBars: warmupBars as 1 | 2,
      seedPolicy: "zero-before-first-contribution",
      missingPolicy: "gap-preserve-known-total",
      convergence: "full-input-dependent"
    };
  } else {
    const period = length ?? definition.defaultLength;
    assertLength(period);
    if (id === "mfi" && period > 2000) throw new RangeError("MFI length must not exceed 2000");
    warmupBars = period + (id === "momentum" || id === "roc" || id === "mfi" ? 1 : 0);
    historyRequirement = {
      kind: "finite",
      lookbackBars: warmupBars,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    };
  }
  return Object.freeze({
    defaultPane: "pane" as const,
    warmupBars,
    historyRequirement: Object.freeze(historyRequirement)
  });
}
