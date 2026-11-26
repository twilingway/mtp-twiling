import {
  isRelativeRegisteredInstance,
  relativeRegisteredMetadata,
  calculateRelativeRegistered
} from "./relative-registration-runtime.js";
import { atr, bollingerBands, macd, rsi, stochastic } from "./calculations.js";
import { isKeltnerInstance, keltnerMetadata, calculateKeltner } from "./keltner-runtime.js";
import {
  isChannelPriceInstance,
  channelPriceMetadata,
  calculateChannelPrice
} from "./channel-average-runtime.js";
import { assertTechnicalBars, priceSource } from "./data.js";
import {
  calculateCatalogExpansion,
  catalogExpansionHistory,
  isCatalogExpansionInstance
} from "./catalog-expansion/registry.js";
import { getTechnicalIndicatorDefinition } from "./definitions.js";
import { isTechnicalIndicatorInstance } from "./instances.js";
import { assertLength, ema, sma } from "./primitives.js";
import { isVolumeFlowInstance, calculateVolumeIndicator } from "./volume-runtime.js";
import { volumeFlowMetadata } from "./volume-flow/metadata.js";
import {
  isTrendPriceInstance,
  trendPriceMetadata,
  calculateTrendPrice
} from "./trend-price-runtime.js";
import {
  isStateOscillatorInstance,
  stateOscillatorMetadata,
  calculateStateOscillator
} from "./state-oscillator-runtime.js";
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
import {
  bollingerPercentB,
  bollingerBandwidth,
  historicalVolatility,
  awesomeOscillator,
  balanceOfPower,
  cmo,
  ultimateOscillator,
  trix,
  volatilityMomentumMetadata
} from "./volatility-momentum/index.js";
import {
  aroon,
  aroonOscillator,
  dmi,
  adx,
  vortex,
  choppinessIndex,
  trendStrengthMetadata
} from "./trend-strength/index.js";
import type {
  NumericSeries,
  TechnicalBar,
  TechnicalIndicatorInstance,
  TechnicalIndicatorResult,
  TechnicalHistoryRequirement,
  TechnicalCalculationContext,
  LegacyRecursiveHistoryRequirement
} from "./types.js";

export function technicalIndicatorWarmup(instance: TechnicalIndicatorInstance): number | null {
  if (isCatalogExpansionInstance(instance)) return catalogExpansionHistory(instance).warmupBars;
  if (isRelativeRegisteredInstance(instance))
    return relativeRegisteredMetadata(instance).warmupBars;
  if (isKeltnerInstance(instance)) return keltnerMetadata(instance).warmupBars;
  if (isChannelPriceInstance(instance)) return channelPriceMetadata(instance).warmupBars;
  if (isTrendPriceInstance(instance)) return trendPriceMetadata(instance).warmupBars;
  if (isStateOscillatorInstance(instance)) return stateOscillatorMetadata(instance).warmupBars;
  if (isVolumeFlowInstance(instance))
    return volumeFlowMetadata(instance.definitionId, instance.params).warmupBars;
  switch (instance.definitionId) {
    case "aroon":
    case "aroon-oscillator":
    case "vortex":
    case "choppiness-index":
      return trendStrengthMetadata(instance.definitionId, { length: instance.params.length })
        .warmupBars;
    case "dmi":
    case "adx":
      return trendStrengthMetadata(instance.definitionId, instance.params).warmupBars;
    case "bollinger-percent-b":
    case "historical-volatility":
    case "cmo":
    case "trix":
      return volatilityMomentumMetadata(instance.definitionId, { length: instance.params.length })
        .warmupBars;
    case "bollinger-bandwidth":
      return volatilityMomentumMetadata(instance.definitionId, {
        length: instance.params.length,
        expansionLength: instance.params.expansionLength,
        contractionLength: instance.params.contractionLength
      }).warmupBars;
    case "awesome-oscillator":
    case "balance-of-power":
      return volatilityMomentumMetadata(instance.definitionId).warmupBars;
    case "ultimate-oscillator":
      return volatilityMomentumMetadata(instance.definitionId, instance.params).warmupBars;
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
  if (isCatalogExpansionInstance(instance))
    return catalogExpansionHistory(instance).historyRequirement;
  if (isRelativeRegisteredInstance(instance))
    return relativeRegisteredMetadata(instance).historyRequirement;
  if (isKeltnerInstance(instance)) return keltnerMetadata(instance).historyRequirement;
  if (isChannelPriceInstance(instance)) return channelPriceMetadata(instance).historyRequirement;
  if (isTrendPriceInstance(instance)) return trendPriceMetadata(instance).historyRequirement;
  if (isStateOscillatorInstance(instance))
    return stateOscillatorMetadata(instance).historyRequirement;
  if (isVolumeFlowInstance(instance))
    return volumeFlowMetadata(instance.definitionId, instance.params).historyRequirement;
  const finite = (lookbackBars: number): TechnicalHistoryRequirement => ({
    kind: "finite",
    lookbackBars,
    seedPolicy: "window",
    convergence: "exact-after-lookback"
  });
  const recursive = (
    seedBars: number,
    seedPolicy: LegacyRecursiveHistoryRequirement["seedPolicy"]
  ): TechnicalHistoryRequirement => ({
    kind: "recursive",
    lookbackBars: null,
    seedBars,
    seedPolicy,
    convergence: "full-input-dependent"
  });
  switch (instance.definitionId) {
    case "aroon":
    case "aroon-oscillator":
    case "vortex":
    case "choppiness-index":
      return trendStrengthMetadata(instance.definitionId, { length: instance.params.length })
        .historyRequirement;
    case "dmi":
    case "adx":
      return trendStrengthMetadata(instance.definitionId, instance.params).historyRequirement;
    case "bollinger-percent-b":
    case "historical-volatility":
    case "cmo":
    case "trix":
      return volatilityMomentumMetadata(instance.definitionId, { length: instance.params.length })
        .historyRequirement;
    case "bollinger-bandwidth":
      return volatilityMomentumMetadata(instance.definitionId, {
        length: instance.params.length,
        expansionLength: instance.params.expansionLength,
        contractionLength: instance.params.contractionLength
      }).historyRequirement;
    case "awesome-oscillator":
    case "balance-of-power":
      return volatilityMomentumMetadata(instance.definitionId).historyRequirement;
    case "ultimate-oscillator":
      return volatilityMomentumMetadata(instance.definitionId, instance.params).historyRequirement;
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
  bars: readonly TechnicalBar[],
  context?: TechnicalCalculationContext
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
  if (isRelativeRegisteredInstance(instance)) return calculateRelativeRegistered(instance, bars);
  assertTechnicalBars(bars);
  if (isCatalogExpansionInstance(instance))
    return calculateCatalogExpansion(instance, bars, context);
  if (isKeltnerInstance(instance)) return calculateKeltner(instance, bars);
  if (isChannelPriceInstance(instance)) return calculateChannelPrice(instance, bars);
  if (isTrendPriceInstance(instance)) return calculateTrendPrice(instance, bars);
  if (isStateOscillatorInstance(instance)) return calculateStateOscillator(instance, bars);
  if (isVolumeFlowInstance(instance)) return calculateVolumeIndicator(instance, bars);
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
  } else if (instance.definitionId === "aroon") {
    series = aroon(bars, instance.params.length);
    // The reviewed math masks Up/Down independently; a shared HLC mask would lose valid values.
    present = bars.map(() => true);
  } else if (instance.definitionId === "aroon-oscillator") {
    series = { value: aroonOscillator(bars, instance.params.length) };
    present = bars.map((bar) => bar.high !== null && bar.low !== null);
  } else if (instance.definitionId === "dmi") {
    series = dmi(bars, instance.params.diLength, instance.params.adxSmoothing);
    present = bars.map((bar) => bar.high !== null && bar.low !== null && bar.close !== null);
  } else if (instance.definitionId === "adx") {
    series = { value: adx(bars, instance.params.diLength, instance.params.adxSmoothing) };
    present = bars.map((bar) => bar.high !== null && bar.low !== null && bar.close !== null);
  } else if (instance.definitionId === "vortex") {
    series = vortex(bars, instance.params.length);
    present = bars.map((bar) => bar.high !== null && bar.low !== null && bar.close !== null);
  } else if (instance.definitionId === "choppiness-index") {
    series = { value: choppinessIndex(bars, instance.params.length) };
    present = bars.map((bar) => bar.high !== null && bar.low !== null && bar.close !== null);
  } else if (instance.definitionId === "awesome-oscillator") {
    series = { value: awesomeOscillator(bars) };
    present = bars.map((bar) => bar.high !== null && bar.low !== null);
  } else if (instance.definitionId === "balance-of-power") {
    series = { value: balanceOfPower(bars) };
    present = bars.map(
      (bar) => bar.open !== null && bar.high !== null && bar.low !== null && bar.close !== null
    );
  } else if (instance.definitionId === "ultimate-oscillator") {
    series = {
      value: ultimateOscillator(
        bars,
        instance.params.fastLength,
        instance.params.middleLength,
        instance.params.slowLength
      )
    };
    present = bars.map((bar) => bar.high !== null && bar.low !== null && bar.close !== null);
  } else if (instance.definitionId === "historical-volatility") {
    const factor = context?.historicalVolatilityPeriodsPerYear;
    if (factor === undefined || !Number.isFinite(factor) || factor <= 0)
      throw new RangeError(
        "Historical Volatility requires explicit positive historicalVolatilityPeriodsPerYear context"
      );
    series = {
      value: historicalVolatility(priceSource(bars, "close"), factor, instance.params.length)
    };
    present = bars.map((bar) => bar.close !== null && bar.close > 0);
  } else if (instance.definitionId === "trix") {
    series = { value: trix(priceSource(bars, "close"), instance.params.length) };
    present = bars.map((bar) => bar.close !== null && bar.close > 0);
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
      case "bollinger-percent-b":
        series = {
          value: bollingerPercentB(source, instance.params.length, instance.params.multiplier)
        };
        break;
      case "bollinger-bandwidth":
        series = bollingerBandwidth(
          source,
          instance.params.length,
          instance.params.multiplier,
          instance.params.expansionLength,
          instance.params.contractionLength
        );
        break;
      case "cmo":
        series = { value: cmo(source, instance.params.length) };
        break;
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
  const warmupBars = technicalIndicatorWarmup(instance);
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map((bar) => bar.timestamp),
    warmupBars,
    ...(warmupBars === null ? { alwaysUndefined: true as const } : {}),
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
