import { assertLength } from "../primitives.js";
import type { TechnicalHistoryRequirement } from "../types.js";

export type MovingAverageId = "wma" | "vwma" | "dema" | "tema" | "hma" | "smma";
export interface MovingAveragePreset {
  readonly id: MovingAverageId;
  readonly title: string;
  readonly shortTitle: string;
  readonly defaultPane: "overlay";
  readonly defaultSource: "close";
  readonly defaultLength: number;
  readonly minLength: number;
  readonly maxLength: 10000;
  readonly requiresVolume: boolean;
  readonly status: "math-only";
  readonly reference: string;
}

function preset(
  id: MovingAverageId,
  title: string,
  defaultLength: number,
  pineId: string,
  minLength = 1
): MovingAveragePreset {
  return Object.freeze({
    id,
    title,
    shortTitle: id.toUpperCase(),
    defaultPane: "overlay",
    defaultSource: "close",
    defaultLength,
    minLength,
    maxLength: 10000,
    requiresVolume: id === "vwma",
    status: "math-only",
    reference: `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(pineId)}/last`
  });
}

/** Public built-in presets, independent of the seven-item registry and native availability. */
export const movingAveragePresets: readonly MovingAveragePreset[] = Object.freeze([
  preset("wma", "Weighted Moving Average", 9, "STD;WMA"),
  preset("vwma", "Volume-Weighted Moving Average", 20, "STD;VWMA"),
  preset("dema", "Double Exponential Moving Average", 9, "STD;DEMA"),
  preset("tema", "Triple Exponential Moving Average", 9, "STD;TEMA"),
  preset("hma", "Hull Moving Average", 9, "STD;Hull%1MA", 2),
  preset("smma", "Smoothed Moving Average", 7, "STD;Smoothed%1Moving%1Average")
]);

export function movingAverageMetadata(id: MovingAverageId, length: number) {
  assertLength(length);
  let historyRequirement: TechnicalHistoryRequirement;
  let warmupBars: number;
  switch (id) {
    case "wma":
    case "vwma":
    case "hma": {
      warmupBars = length + (id === "hma" ? Math.max(1, Math.floor(Math.sqrt(length))) - 1 : 0);
      historyRequirement = {
        kind: "finite",
        lookbackBars: warmupBars,
        seedPolicy: "window",
        convergence: "exact-after-lookback"
      };
      break;
    }
    case "dema":
    case "tema":
    case "smma": {
      warmupBars = id === "smma" ? length : 1;
      historyRequirement = {
        kind: "recursive",
        lookbackBars: null,
        seedBars: warmupBars,
        seedPolicy: id === "smma" ? "sma-of-first-length" : "first-value-ema-chain",
        convergence: "full-input-dependent"
      };
      break;
    }
    default:
      throw new RangeError("Unknown moving average");
  }
  return Object.freeze({
    defaultPane: "overlay" as const,
    warmupBars,
    historyRequirement: Object.freeze(historyRequirement)
  });
}
