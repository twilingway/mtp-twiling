import { alma, lsma, type AlmaOptions, type LsmaOptions } from "./averages.js";
import {
  chandelierExit,
  donchianChannels,
  keltnerChannels,
  type ChandelierOptions,
  type DonchianOptions,
  type KeltnerOptions
} from "./channels.js";
import { freeze } from "./inputs.js";

export type ChannelAverageId =
  "alma" | "lsma" | "keltner-channels" | "donchian-channels" | "chandelier-exit";
export interface ChannelAverageParameters {
  alma: AlmaOptions;
  lsma: LsmaOptions;
  "keltner-channels": KeltnerOptions;
  "donchian-channels": DonchianOptions;
  "chandelier-exit": ChandelierOptions;
}
const source = (id: string) =>
  `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(id)}/last`;
const preset = (
  id: ChannelAverageId,
  publicId: string,
  version: string,
  sha256: string,
  defaults: Readonly<Record<string, string | number | boolean>>,
  outputs: readonly string[],
  requiredData: readonly string[]
) => ({
  id,
  publicId,
  verifiedVersion: version,
  sourceSha256: sha256,
  reference: source(publicId),
  status: "math-only" as const,
  defaultPane: "overlay" as const,
  defaults,
  outputs,
  requiredData,
  omittedNumericOutputs: [] as readonly string[],
  presentation: {
    displayOffset: 0,
    fill: id === "keltner-channels" || id === "donchian-channels",
    markers: false
  },
  localLimits: {
    bars: { min: 0, max: 1000000 },
    length: { min: id === "lsma" ? 2 : 1, max: 10000 },
    multiplier: { min: 0, max: 1000000 },
    offset: { min: id === "alma" ? -100 : -10000, max: id === "alma" ? 100 : 10000 },
    sigma: { min: 0.000001, max: 10000 },
    directWindowProducts: 50000000
  },
  parityLimits: [
    "No Pine execution, chart/native, multi-timeframe or realtime parity measured.",
    "Local gaps reset contiguous filters/extrema; Pine skip-na behavior is not reproduced.",
    "Local numeric/resource limits are not Pine input bounds."
  ]
});
export const channelAveragePresets = freeze([
  preset(
    "alma",
    "STD;Arnaud%1Legoux%1Moving%1Average",
    "30.0",
    "6392823a19e1c4cf55a794491c857dff845230998cba8eb92f0d6646d0caff04",
    { length: 9, offset: 0.85, sigma: 6 },
    ["value"],
    ["close"]
  ),
  preset(
    "lsma",
    "STD;Least%1Squares%1Moving%1Average",
    "30.0",
    "0454f77822ea2d48d989106c72a1798dbded9d380034eed30002f2c58ddd2d33",
    { length: 25, offset: 0, source: "close" },
    ["value"],
    ["source"]
  ),
  preset(
    "keltner-channels",
    "STD;Keltner_Channels",
    "35.0",
    "102f0093433635000a53bf731f0fabe2a1f17cc7a28de12de14af81b7d1417bb",
    {
      length: 20,
      multiplier: 2,
      source: "close",
      useExponentialMa: true,
      bandsStyle: "Average True Range",
      atrLength: 10
    },
    ["basis", "upper", "lower"],
    ["source", "high", "low", "close"]
  ),
  preset(
    "donchian-channels",
    "STD;Donchian_Channels",
    "32.0",
    "1c2092e5bd3919968c13dea205d77c5bc60233685ffd1281b39b1676a2461f69",
    { length: 20, displayOffset: 0 },
    ["basis", "upper", "lower"],
    ["high", "low"]
  ),
  preset(
    "chandelier-exit",
    "STD;Chandelier_Exit",
    "4.0",
    "b66ee578b5a5645af8173c752838221ea848729ea593459d26ffaf7417a7a37f",
    { length: 22, atrLength: 22, multiplier: 3 },
    ["longExit", "shortExit"],
    ["high", "low", "close"]
  )
]);
export function channelAverageMetadata<K extends ChannelAverageId>(
  id: K,
  options: ChannelAverageParameters[K] = {}
) {
  const base = channelAveragePresets.find((item) => item.id === id);
  if (!base) throw new RangeError("Unknown channel-average id");
  let ready: Readonly<Record<string, number>>;
  let lookbackBars: number | null;
  let seedPolicy: string;
  let displayOffset = 0;
  switch (id) {
    case "alma": {
      const params = options as AlmaOptions;
      alma([], params);
      const length = params.length ?? 9;
      ready = { value: length };
      lookbackBars = length;
      seedPolicy = "full-contiguous-window";
      break;
    }
    case "lsma": {
      const params = options as LsmaOptions;
      lsma([], params);
      const length = params.length ?? 25;
      ready = { value: length };
      lookbackBars = length;
      seedPolicy = "full-contiguous-window";
      break;
    }
    case "keltner-channels": {
      const params = options as KeltnerOptions;
      keltnerChannels([], params);
      const length = params.length ?? 20;
      const style = params.bandsStyle ?? "Average True Range";
      const ema = params.useExponentialMa ?? true;
      const basis = ema ? 1 : length;
      const band =
        style === "True Range" ? 1 : style === "Range" ? length : (params.atrLength ?? 10);
      ready = { basis, upper: Math.max(basis, band), lower: Math.max(basis, band) };
      lookbackBars = !ema && style === "True Range" ? Math.max(length, 2) : null;
      seedPolicy = `${ema ? "first-valid-ema" : "full-window-sma"};${style === "True Range" ? "tr-fallback-high-low" : "full-window-rma"}`;
      break;
    }
    case "donchian-channels": {
      const params = options as DonchianOptions;
      donchianChannels([], params);
      ready = { basis: 1, upper: 1, lower: 1 };
      lookbackBars = params.length ?? 20;
      displayOffset = params.displayOffset ?? 0;
      seedPolicy = "available-contiguous-extrema-window";
      break;
    }
    case "chandelier-exit": {
      const params = options as ChandelierOptions;
      chandelierExit([], params);
      ready = { longExit: params.atrLength ?? 22, shortExit: params.atrLength ?? 22 };
      lookbackBars = null;
      seedPolicy = "available-extrema;tr-fallback;full-window-atr-rma";
      break;
    }
    default:
      throw new RangeError("Unknown channel-average id");
  }
  return freeze({
    ...base,
    parameters: { ...base.defaults, ...(id === "alma" ? { floor: false } : {}), ...options },
    presentation: { ...base.presentation, displayOffset },
    firstReadyBars: ready,
    warmupBars: Math.max(...Object.values(ready)),
    historyRequirement: {
      kind: lookbackBars === null ? "recursive" : "finite",
      lookbackBars,
      seedBars: Math.max(...Object.values(ready)),
      seedPolicy,
      convergence: lookbackBars === null ? "full-input-dependent" : "exact-after-lookback"
    },
    limitations:
      id === "lsma"
        ? ["Length1 degenerate regression is locally unsupported; Pine result unresolved."]
        : id === "alma"
          ? [
              "floor is a pure API option, not a visible builtin input; source is fixed close in builtin."
            ]
          : id === "chandelier-exit"
            ? ["Builtin has no sourceClose, stop ratchet, direction, signals or reversal state."]
            : []
  });
}
