import { atr, bollingerBands, macd, rsi, stochastic } from "./calculations.js";
import { assertTechnicalBars, priceSource } from "./data.js";
import { getTechnicalIndicatorDefinition } from "./definitions.js";
import { isTechnicalIndicatorInstance } from "./instances.js";
import { assertLength, ema, sma } from "./primitives.js";
import { wma, vwma, dema, tema, hma, smma, movingAverageMetadata } from "./averages/index.js";
import {
  momentum,
  roc,
  cci,
  williamsR,
  mfi,
  obv,
  accumulationDistribution,
  pvt,
  momentumVolumeMetadata
} from "./momentum-volume/index.js";
import type {
  NumericSeries,
  TechnicalBar,
  TechnicalIndicatorInstance,
  TechnicalIndicatorResult,
  TechnicalHistoryRequirement
} from "./types.js";

export function technicalIndicatorWarmup(instance: TechnicalIndicatorInstance): number {
  switch (instance.definitionId) {
    case "momentum":
    case "roc":
    case "cci":
    case "williams-r":
    case "mfi":
      return momentumVolumeMetadata(instance.definitionId, instance.params.length).warmupBars;
    case "obv":
    case "adl":
    case "pvt":
      return momentumVolumeMetadata(instance.definitionId).warmupBars;
    case "wma":
    case "vwma":
    case "dema":
    case "tema":
    case "hma":
    case "smma":
      return movingAverageMetadata(instance.definitionId, instance.params.length).warmupBars;
    case "rsi":
      return instance.params.length + 1;
    case "sma":
    case "bollinger-bands":
    case "atr":
      return instance.params.length;
    case "ema":
    case "macd":
      return 1;
    case "stochastic":
      return instance.params.smoothK + instance.params.smoothD - 1;
  }
}
/** Loader contract: recursive seeds cannot be made exact by an arbitrary finite padding. */
export function technicalIndicatorHistoryRequirement(
  instance: TechnicalIndicatorInstance
): TechnicalHistoryRequirement {
  const finite = (lookbackBars: number): TechnicalHistoryRequirement => ({
    kind: "finite",
    lookbackBars,
    seedPolicy: "window",
    convergence: "exact-after-lookback"
  });
  const recursive = (
    seedBars: number,
    seedPolicy: Extract<TechnicalHistoryRequirement, { kind: "recursive" }>["seedPolicy"]
  ): TechnicalHistoryRequirement => ({
    kind: "recursive",
    lookbackBars: null,
    seedBars,
    seedPolicy,
    convergence: "full-input-dependent"
  });
  switch (instance.definitionId) {
    case "momentum":
    case "roc":
    case "cci":
    case "williams-r":
    case "mfi":
      return momentumVolumeMetadata(instance.definitionId, instance.params.length)
        .historyRequirement;
    case "obv":
    case "adl":
    case "pvt":
      return momentumVolumeMetadata(instance.definitionId).historyRequirement;
    case "wma":
    case "vwma":
    case "dema":
    case "tema":
    case "hma":
    case "smma":
      return movingAverageMetadata(instance.definitionId, instance.params.length)
        .historyRequirement;
    case "sma":
    case "bollinger-bands":
      return finite(instance.params.length);
    case "stochastic":
      return finite(instance.params.length + instance.params.smoothK + instance.params.smoothD - 2);
    case "ema":
      return recursive(1, "first-non-null");
    case "macd":
      return recursive(1, "first-value-ema-chain");
    case "rsi":
      return recursive(instance.params.length + 1, "adjacent-change-wilder");
    case "atr":
      return recursive(instance.params.length, "true-range-wilder");
  }
}
export function rmaHistoryRequirement(length: number): TechnicalHistoryRequirement {
  assertLength(length);
  return {
    kind: "recursive",
    lookbackBars: null,
    seedBars: length,
    seedPolicy: "sma-of-first-length",
    convergence: "full-input-dependent"
  };
}
/** Pure full-history calculation; callers replace an old candle then recompute, without shared state. */
export function calculateTechnicalIndicator(
  instance: unknown,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  if (!isTechnicalIndicatorInstance(instance)) {
    const id: unknown =
      instance && typeof instance === "object"
        ? Object.getOwnPropertyDescriptor(instance, "definitionId")?.value
        : undefined;
    const definition = typeof id === "string" ? getTechnicalIndicatorDefinition(id) : null;
    throw new RangeError(
      definition?.status === "unsupported"
        ? definition.reason
        : "Invalid technical indicator instance"
    );
  }
  assertTechnicalBars(bars);
  let series: Record<string, NumericSeries>, present: readonly boolean[];
  if (instance.definitionId === "atr") {
    series = { value: atr(bars, instance.params.length) };
    present = bars.map((bar) => bar.high !== null && bar.low !== null);
  } else if (instance.definitionId === "stochastic") {
    const calculated = stochastic(
      bars,
      instance.params.length,
      instance.params.smoothK,
      instance.params.smoothD
    );
    series = { k: calculated.k, d: calculated.d };
    present = bars.map((bar) => bar.high !== null && bar.low !== null && bar.close !== null);
  } else if (instance.definitionId === "mfi") {
    series = { value: mfi(bars, instance.params.length) };
    present = bars.map(
      (bar) => bar.high !== null && bar.low !== null && bar.close !== null && bar.volume !== null
    );
  } else if (instance.definitionId === "adl") {
    series = { value: accumulationDistribution(bars) };
    present = bars.map(
      (bar) => bar.high !== null && bar.low !== null && bar.close !== null && bar.volume !== null
    );
  } else if (instance.definitionId === "obv" || instance.definitionId === "pvt") {
    series = { value: instance.definitionId === "obv" ? obv(bars) : pvt(bars) };
    present = bars.map((bar) => bar.close !== null && bar.volume !== null);
  } else {
    const source = priceSource(bars, instance.params.source);
    present = source.map((value) => value !== null);
    switch (instance.definitionId) {
      case "momentum":
        series = { value: momentum(source, instance.params.length) };
        break;
      case "roc":
        series = { value: roc(source, instance.params.length) };
        break;
      case "cci":
        series = { value: cci(source, instance.params.length) };
        break;
      case "williams-r":
        series = { value: williamsR(bars, instance.params.length, source) };
        present = bars.map(
          (bar, index) => source[index] !== null && bar.high !== null && bar.low !== null
        );
        break;
      case "wma":
        series = { value: wma(source, instance.params.length) };
        break;
      case "vwma":
        series = {
          value: vwma(
            source,
            bars.map((bar) => bar.volume),
            instance.params.length
          )
        };
        present = bars.map((bar, index) => source[index] !== null && bar.volume !== null);
        break;
      case "dema":
        series = { value: dema(source, instance.params.length) };
        break;
      case "tema":
        series = { value: tema(source, instance.params.length) };
        break;
      case "hma":
        series = { value: hma(source, instance.params.length) };
        break;
      case "smma":
        series = { value: smma(source, instance.params.length) };
        break;
      case "sma":
        series = { value: sma(source, instance.params.length) };
        break;
      case "ema":
        series = { value: ema(source, instance.params.length) };
        break;
      case "rsi":
        series = { value: rsi(source, instance.params.length) };
        break;
      case "macd":
        series = macd(
          source,
          instance.params.fastLength,
          instance.params.slowLength,
          instance.params.signalLength
        );
        break;
      case "bollinger-bands":
        series = bollingerBands(source, instance.params.length, instance.params.multiplier);
        break;
    }
  }
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map((bar) => bar.timestamp),
    warmupBars: technicalIndicatorWarmup(instance),
    historyRequirement: technicalIndicatorHistoryRequirement(instance),
    series: Object.fromEntries(
      Object.entries(series).map(([key, values]) => [
        key,
        values.map((value, index) =>
          present[index] && value !== null && Number.isFinite(value) ? value : null
        )
      ])
    )
  };
}
