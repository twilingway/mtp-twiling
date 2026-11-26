import { hma, vwma } from "./averages/index.js";
import { macd, rsi, stochastic } from "./calculations.js";
import { assertTechnicalBars, priceSource } from "./data.js";
import { cci, momentum, williamsR } from "./momentum-volume/index.js";
import { ema, finiteOrNull, sma } from "./primitives.js";
import { stochasticRsi } from "./relative-oscillators/index.js";
import { ichimokuCloud } from "./ta-batch-anchored-shifts.js";
import {
  RATING_AVERAGE_LENGTHS,
  technicalAverageScore,
  technicalOscillatorScore,
  technicalOverallScore,
  type TechnicalRatingInputs
} from "./ta-batch-external-ratings.js";
import { dmi } from "./trend-strength/index.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "./types.js";
import { awesomeOscillator, ultimateOscillator } from "./volatility-momentum/index.js";

export const RATING_GROUPS: readonly ["overall", "averages", "oscillators"] = [
  "overall",
  "averages",
  "oscillators"
];
type RatingGroup = (typeof RATING_GROUPS)[number];

// TechnicalRating v3 uses the cloud from 26 bars back in the rating calculation.
const RATING_CLOUD_LAG = 26;
const LONGEST_AVERAGE = RATING_AVERAGE_LENGTHS.at(-1)!;
const OSCILLATOR_WARMUP = 36;

export function technicalRatingWarmup(group: RatingGroup): number {
  return group === "oscillators" ? OSCILLATOR_WARMUP : LONGEST_AVERAGE;
}

type AverageInputs = TechnicalRatingInputs["averages"];
type OscillatorInputs = TechnicalRatingInputs["oscillators"];

function makeAverageInputs(bars: readonly TechnicalBar[], close: NumericSeries) {
  const smaByLength = RATING_AVERAGE_LENGTHS.map((length) => sma(close, length));
  const emaByLength = RATING_AVERAGE_LENGTHS.map((length) => ema(close, length));
  const hull = hma(close, 9);
  const volumeWeighted = vwma(close, priceSource(bars, "volume"), 20);
  const cloud = ichimokuCloud(bars);
  const at = (series: readonly NumericSeries[], index: number): AverageInputs["sma"] => ({
    10: series[0]![index]!,
    20: series[1]![index]!,
    30: series[2]![index]!,
    50: series[3]![index]!,
    100: series[4]![index]!,
    200: series[5]![index]!
  });
  return (index: number): AverageInputs => ({
    sma: at(smaByLength, index),
    ema: at(emaByLength, index),
    hull9: hull[index]!,
    volumeWeighted20: volumeWeighted[index]!,
    cloud: {
      conversion: cloud.conversion.values[index]!,
      base: cloud.base.values[index]!,
      leadingA: cloud.spanA.values[index - RATING_CLOUD_LAG] ?? null,
      leadingB: cloud.spanB.values[index - RATING_CLOUD_LAG] ?? null
    }
  });
}

function makeOscillatorInputs(bars: readonly TechnicalBar[], close: NumericSeries) {
  const relativeStrength = rsi(close, 14);
  const stoch = stochastic(bars, 14, 3, 3);
  const commodityChannel = cci(close, 20);
  const directional = dmi(bars, 14, 14);
  const awesome = awesomeOscillator(bars);
  const changes = momentum(close, 10);
  const convergence = macd(close, 12, 26, 9);
  const stochRsi = stochasticRsi(bars);
  const williams = williamsR(bars, 14);
  const bullBearAverage = ema(close, 13);
  const trendAverage = ema(close, 50);
  const ultimate = ultimateOscillator(bars, 7, 14, 28);
  const changeAt = (values: NumericSeries, index: number) => ({
    current: values[index] ?? null,
    previous: values[index - 1] ?? null
  });
  const powerAt = (key: "high" | "low", index: number): NumericValue => {
    const price = bars[index]?.[key];
    const average = bullBearAverage[index];
    return price == null || average == null ? null : finiteOrNull(price - average);
  };
  return (index: number): OscillatorInputs => {
    const price = close[index]!;
    const trendPrice = trendAverage[index]!;
    const trend =
      price === null || trendPrice === null
        ? null
        : price > trendPrice
          ? "up"
          : price < trendPrice
            ? "down"
            : "flat";
    return {
      rsi14: changeAt(relativeStrength, index),
      stochastic14_3_3: { k: stoch.k[index]!, d: stoch.d[index]! },
      cci20: changeAt(commodityChannel, index),
      adx14_14: {
        ...changeAt(directional.adx, index),
        plusDI: directional.plusDI[index]!,
        minusDI: directional.minusDI[index]!
      },
      awesome: { ...changeAt(awesome, index), twoBack: awesome[index - 2] ?? null },
      momentum10: changeAt(changes, index),
      macd12_26_9: { value: convergence.macd[index]!, signal: convergence.signal[index]! },
      stochasticRsi14_14_3_3: { k: stochRsi.k[index]!, d: stochRsi.d[index]!, trend },
      williamsR14: changeAt(williams, index),
      bullBear13: {
        bull: { current: powerAt("high", index), previous: powerAt("high", index - 1) },
        bear: { current: powerAt("low", index), previous: powerAt("low", index - 1) },
        trend
      },
      ultimate7_14_28: ultimate[index]!
    };
  };
}

/** Ratings on the active chart timeframe using only observations available at each bar. */
export function technicalRatingSeries(
  bars: readonly TechnicalBar[],
  group: RatingGroup
): NumericValue[] {
  assertTechnicalBars(bars);
  const close = priceSource(bars, "close");
  const first = technicalRatingWarmup(group) - 1;
  if (bars.length <= first) return Array<null>(bars.length).fill(null);
  const averagesAt = group === "oscillators" ? null : makeAverageInputs(bars, close);
  const oscillatorsAt = group === "averages" ? null : makeOscillatorInputs(bars, close);
  return bars.map((bar, index) => {
    if (index < first || bar.close === null || bar.high === null || bar.low === null) return null;
    const averages =
      averagesAt === null ? null : technicalAverageScore(bar.close, averagesAt(index));
    const oscillators =
      oscillatorsAt === null ? null : technicalOscillatorScore(oscillatorsAt(index));
    if (group === "averages") return averages;
    if (group === "oscillators") return oscillators;
    return technicalOverallScore(averages, oscillators);
  });
}
