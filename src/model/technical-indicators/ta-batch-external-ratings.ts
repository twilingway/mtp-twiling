import type { NumericValue } from "./types.js";

export const RATING_AVERAGE_LENGTHS = Object.freeze([10, 20, 30, 50, 100, 200] as const);
type StandardAverages = Readonly<Record<(typeof RATING_AVERAGE_LENGTHS)[number], NumericValue>>;
type Vote = -1 | 0 | 1;
type Trend = "up" | "down" | "flat";

interface Change {
  readonly current: NumericValue;
  readonly previous: NumericValue;
}

interface StochasticValues {
  readonly k: NumericValue;
  readonly d: NumericValue;
}

export interface TechnicalRatingInputs {
  readonly close: NumericValue;
  readonly averages: {
    readonly sma: StandardAverages;
    readonly ema: StandardAverages;
    readonly hull9: NumericValue;
    readonly volumeWeighted20: NumericValue;
    readonly cloud: {
      readonly conversion: NumericValue;
      readonly base: NumericValue;
      readonly leadingA: NumericValue;
      readonly leadingB: NumericValue;
    };
  };
  readonly oscillators: {
    readonly rsi14: Change;
    readonly stochastic14_3_3: StochasticValues;
    readonly cci20: Change;
    readonly adx14_14: Change & { readonly plusDI: NumericValue; readonly minusDI: NumericValue };
    readonly awesome: Change & { readonly twoBack: NumericValue };
    readonly momentum10: Change;
    readonly macd12_26_9: { readonly value: NumericValue; readonly signal: NumericValue };
    readonly stochasticRsi14_14_3_3: StochasticValues & { readonly trend: Trend | null };
    readonly williamsR14: Change;
    readonly bullBear13: {
      readonly bull: Change;
      readonly bear: Change;
      readonly trend: Trend | null;
    };
    readonly ultimate7_14_28: NumericValue;
  };
}

export type TechnicalRatingCategory = "strong-sell" | "sell" | "neutral" | "buy" | "strong-buy";

const side = (buy: boolean, sell: boolean): Vote => (buy ? 1 : sell ? -1 : 0);
const finite = (value: NumericValue): value is number =>
  typeof value === "number" && Number.isFinite(value);

function vote(
  values: readonly NumericValue[],
  condition: (...values: number[]) => Vote
): Vote | null {
  return values.every(finite) ? condition(...values) : null;
}

function compare(a: NumericValue, b: NumericValue): Vote | null {
  return vote([a, b], (x, y) => side(x > y, x < y));
}

function turnsWithin({ current, previous }: Change, low: number, high: number): Vote | null {
  return vote([current, previous], (value, prior) =>
    side(value < low && value > prior, value > high && value < prior)
  );
}

function stochasticVote(
  { k, d }: StochasticValues,
  buyAllowed = true,
  sellAllowed = true
): Vote | null {
  return vote([k, d], (fast, slow) =>
    side(
      buyAllowed && fast < 20 && slow < 20 && fast > slow,
      sellAllowed && fast > 80 && slow > 80 && fast < slow
    )
  );
}

function movingAverageVotes({
  close,
  averages
}: Pick<TechnicalRatingInputs, "close" | "averages">): (Vote | null)[] {
  const { conversion, base, leadingA, leadingB } = averages.cloud;
  return [
    ...RATING_AVERAGE_LENGTHS.map((length) => compare(close, averages.sma[length])),
    ...RATING_AVERAGE_LENGTHS.map((length) => compare(close, averages.ema[length])),
    compare(close, averages.hull9),
    compare(close, averages.volumeWeighted20),
    vote([close, conversion, base, leadingA, leadingB], (price, tenkan, kijun, spanA, spanB) =>
      side(
        price > tenkan && tenkan > kijun && kijun > spanA && spanA > spanB,
        price < tenkan && tenkan < kijun && kijun < spanA && spanA < spanB
      )
    )
  ];
}

function oscillatorVotes(oscillators: TechnicalRatingInputs["oscillators"]): (Vote | null)[] {
  const adx = oscillators.adx14_14;
  const awesome = oscillators.awesome;
  const stochRsi = oscillators.stochasticRsi14_14_3_3;
  const bullBear = oscillators.bullBear13;
  return [
    turnsWithin(oscillators.rsi14, 30, 70),
    stochasticVote(oscillators.stochastic14_3_3),
    turnsWithin(oscillators.cci20, -100, 100),
    vote([adx.current, adx.previous, adx.plusDI, adx.minusDI], (value, prior, plus, minus) =>
      side(value > 20 && plus > minus && value > prior, value > 20 && plus < minus && value < prior)
    ),
    vote([awesome.current, awesome.previous, awesome.twoBack], (value, prior, older) =>
      side(
        (value > 0 && prior <= 0) || (prior > 0 && value > prior && prior < older),
        (value < 0 && prior >= 0) || (prior < 0 && value < prior && prior > older)
      )
    ),
    compare(oscillators.momentum10.current, oscillators.momentum10.previous),
    compare(oscillators.macd12_26_9.value, oscillators.macd12_26_9.signal),
    stochRsi.trend === null
      ? null
      : stochasticVote(stochRsi, stochRsi.trend === "down", stochRsi.trend === "up"),
    turnsWithin(oscillators.williamsR14, -80, -20),
    bullBear.trend === null
      ? null
      : vote(
          [
            bullBear.bull.current,
            bullBear.bull.previous,
            bullBear.bear.current,
            bullBear.bear.previous
          ],
          (bull, previousBull, bear, previousBear) =>
            side(
              bullBear.trend === "up" && bear < 0 && bear > previousBear,
              bullBear.trend === "down" && bull > 0 && bull < previousBull
            )
        ),
    vote([oscillators.ultimate7_14_28], (value) => side(value > 70, value < 30))
  ];
}

function average(votes: readonly (Vote | null)[]): NumericValue {
  let sum = 0;
  for (const item of votes) {
    if (item === null) return null;
    sum += item;
  }
  return sum / votes.length;
}

export function technicalRatingCategory(score: number): TechnicalRatingCategory {
  if (!Number.isFinite(score) || Math.abs(score) > 1)
    throw new RangeError("Invalid technical rating");
  if (score < -0.5) return "strong-sell";
  if (score < -0.1) return "sell";
  if (score > 0.5) return "strong-buy";
  if (score > 0.1) return "buy";
  return "neutral";
}

export function technicalAverageScore(
  close: NumericValue,
  averages: TechnicalRatingInputs["averages"]
): NumericValue {
  return average(movingAverageVotes({ close, averages }));
}

export function technicalOscillatorScore(
  oscillators: TechnicalRatingInputs["oscillators"]
): NumericValue {
  return average(oscillatorVotes(oscillators));
}

export function technicalOverallScore(
  averages: NumericValue,
  oscillators: NumericValue
): NumericValue {
  return averages === null || oscillators === null ? null : (averages + oscillators) / 2;
}

export function technicalRatings(input: TechnicalRatingInputs) {
  const averages = technicalAverageScore(input.close, input.averages);
  const oscillators = technicalOscillatorScore(input.oscillators);
  const score = (value: NumericValue) =>
    value === null ? null : { value, category: technicalRatingCategory(value) };
  return {
    averages: score(averages),
    oscillators: score(oscillators),
    overall: score(technicalOverallScore(averages, oscillators))
  };
}
