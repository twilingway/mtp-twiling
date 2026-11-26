import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { averageDailyRange, pivotPointsHighLow } = load(
  "model/technical-indicators/ta-batch-pivots.js"
);
const {
  autoStandardPivotInterval,
  autoMultiTimePeriodInterval,
  standardPivotPoints,
  multiTimePeriodBoxes
} = load("model/technical-indicators/ta-batch-pivots-periods.js");

const candles = (ranges) =>
  ranges.map(([high, low], index) => ({ timestamp: 10 + index * 1000, high, low }));
const period = (startsAt, endsAt, open, high, low, close) => ({
  startsAt,
  endsAt,
  open,
  high,
  low,
  close
});
const previous = period(0, 100, 10, 16, 8, 15);
const current = period(100, 400, 18, 22, 17, 21);
const strength = { left: 1, right: 1 };

test("ADR averages price ranges instead of using previous closes or a percent", () => {
  const bars = candles([
    [12, 8],
    [20, 12],
    [10, 7],
    [30, 20],
    [40, 40]
  ]);
  const values = averageDailyRange(bars, 3);
  assert.deepEqual(values.slice(0, 4), [null, null, 5, 7]);
  assert.ok(Math.abs(values[4] - 13 / 3) < 1e-12);
  assert.deepEqual(averageDailyRange(bars, 1), [4, 8, 3, 10, 0]);
});

test("ADR skips incomplete observations, keeps their output absent, and rejects inverted ranges", () => {
  const bars = candles([
    [5, 1],
    [null, 0],
    [9, 3],
    [1, null],
    [15, 7]
  ]);
  assert.deepEqual(averageDailyRange(bars, 2), [null, null, 5, null, 7]);
  assert.throws(() => averageDailyRange(candles([[1, 2]]), 1), RangeError);
  assert.throws(() => averageDailyRange(bars, 0), RangeError);
});

test("pivot highs and lows use independent windows and preserve confirmation times", () => {
  const bars = candles([
    [3, 2],
    [6, 1],
    [4, 3],
    [5, 2],
    [6, 1],
    [5, 3]
  ]);
  const high = { left: 1, right: 2 };
  const low = { left: 2, right: 1 };
  assert.deepEqual(pivotPointsHighLow(bars.slice(0, 3), high, low), []);
  assert.deepEqual(pivotPointsHighLow(bars, high, low), [
    { kind: "high", timestamp: 1010, confirmedTimestamp: 3010, value: 6 },
    { kind: "low", timestamp: 4010, confirmedTimestamp: 5010, value: 1 }
  ]);
});

test("ties and holes disqualify the affected side while confirmed pivots survive append", () => {
  const bars = candles([
    [3, 2],
    [6, 1],
    [6, 2],
    [null, 3],
    [5, 2],
    [2, 0]
  ]);
  const confirmed = [{ kind: "low", timestamp: 1010, confirmedTimestamp: 2010, value: 1 }];
  assert.deepEqual(pivotPointsHighLow(bars.slice(0, 3), strength, strength), confirmed);
  assert.deepEqual(pivotPointsHighLow(bars, strength, strength), confirmed);
  assert.throws(() => pivotPointsHighLow([bars[1], bars[0]], strength, strength), RangeError);
  assert.throws(() => pivotPointsHighLow(bars, { left: 1, right: 0 }, strength), RangeError);
});

test("linear pivot windows agree with a direct scan for asymmetric windows and gaps", () => {
  const bars = candles(
    Array.from({ length: 240 }, (_, index) => [
      index % 61 === 14 ? null : 20 + ((index * 173) % 37),
      index % 57 === 10 ? null : (index * 89) % 19
    ])
  );
  const high = { left: 5, right: 4 };
  const low = { left: 3, right: 7 };
  const expected = bars.flatMap((bar, index) => {
    const result = [];
    for (const [kind, { left, right }] of [
      ["high", high],
      ["low", low]
    ]) {
      const value = bar[kind];
      if (value === null || index - left < 0 || index + right >= bars.length) continue;
      const neighbors = [
        ...bars.slice(index - left, index),
        ...bars.slice(index + 1, index + right + 1)
      ];
      if (
        neighbors.every(
          (neighbor) =>
            neighbor[kind] !== null &&
            (kind === "high" ? neighbor[kind] < value : neighbor[kind] > value)
        )
      ) {
        result.push({
          kind,
          timestamp: bar.timestamp,
          confirmedTimestamp: bars[index + right].timestamp,
          value
        });
      }
    }
    return result;
  });
  assert.deepEqual(pivotPointsHighLow(bars, high, low), expected);
});

const exactPivots = {
  traditional: {
    P: 13,
    R1: 18,
    S1: 10,
    R2: 21,
    S2: 5,
    R3: 26,
    S3: 2,
    R4: 31,
    S4: -1,
    R5: 36,
    S5: -4
  },
  fibonacci: { P: 13, R1: 16.056, S1: 9.944, R2: 17.944, S2: 8.056, R3: 21, S3: 5 },
  woodie: { P: 15, R1: 22, S1: 14, R2: 23, S2: 7, R3: 30, S3: 6, R4: 38, S4: -2 },
  classic: { P: 13, R1: 18, S1: 10, R2: 21, S2: 5, R3: 29, S3: -3, R4: 37, S4: -11 },
  dm: { P: 13.75, R1: 19.5, S1: 11.5 },
  camarilla: {
    P: 13,
    R1: 15.733333333333333,
    S1: 14.266666666666667,
    R2: 16.466666666666665,
    S2: 13.533333333333333,
    R3: 17.2,
    S3: 12.8,
    R4: 19.4,
    S4: 10.6,
    R5: 30,
    S5: 0
  }
};
for (const [method, expected] of Object.entries(exactPivots)) {
  test(`standard pivots calculate the ${method} formula for the current period`, () => {
    const sets = standardPivotPoints([previous, current], method);
    assert.equal(sets.length, 1);
    const [{ startsAt, endsAt, levels }] = sets;
    assert.equal(startsAt, 100);
    assert.equal(endsAt, 400);
    assert.deepEqual(Object.keys(levels).sort(), Object.keys(expected).sort());
    for (const [id, value] of Object.entries(expected)) {
      assert.ok(Math.abs(levels[id] - value) < 1e-12, `${id} was ${levels[id]}, expected ${value}`);
    }
  });
}

test("Woodie depends on the current open and allows it to be the only current price", () => {
  const openOnly = period(100, 400, 18, null, null, null);
  const incompletePrevious = { ...previous, close: null };
  const result = standardPivotPoints([incompletePrevious, openOnly], "woodie");
  assert.equal(result[0].levels.P, 15);
  assert.deepEqual(standardPivotPoints([incompletePrevious, openOnly], "traditional"), []);
  assert.deepEqual(standardPivotPoints([previous, { ...openOnly, open: null }], "woodie"), []);
});

test("DM branches on the previous open and Camarilla omits only the undefined outer pair", () => {
  const dmAtOpen = (open) => standardPivotPoints([{ ...previous, open }, current], "dm")[0].levels;
  assert.deepEqual(dmAtOpen(15), { P: 13.5, R1: 19, S1: 11 });
  assert.deepEqual(dmAtOpen(16), { P: 11.75, R1: 15.5, S1: 7.5 });
  assert.deepEqual(standardPivotPoints([{ ...previous, open: null }, current], "dm"), []);
  const { levels } = standardPivotPoints([{ ...previous, low: 0 }, current], "camarilla")[0];
  assert.equal(Object.keys(levels).length, 9);
  assert.equal(levels.R5, undefined);
  assert.equal(levels.S5, undefined);
});

test("gaps flagged by the source and invalid period bounds never produce adjacent levels", () => {
  const afterKnownGap = { ...current, startsAt: 200, followsPrevious: false };
  assert.deepEqual(standardPivotPoints([previous, afterKnownGap], "classic"), []);
  assert.deepEqual(multiTimePeriodBoxes([previous, afterKnownGap], "true-range"), []);
  assert.equal(standardPivotPoints([previous, { ...current, startsAt: 200 }], "classic").length, 1);
  for (const calculate of [standardPivotPoints, multiTimePeriodBoxes]) {
    assert.throws(() => calculate([previous, { ...current, startsAt: 50 }]), RangeError);
  }
});

test("MTPC represents both OHLC ranges, direction, and caller-supplied period boundaries", () => {
  const down = period(0, 75, 7, 9, 1, 3);
  assert.deepEqual(multiTimePeriodBoxes([down], "ohlc"), [
    { startsAt: 0, endsAt: 75, kind: "high-low", top: 9, bottom: 1, direction: "down" },
    { startsAt: 0, endsAt: 75, kind: "open-close", top: 7, bottom: 3, direction: "down" }
  ]);
  assert.deepEqual(multiTimePeriodBoxes([{ ...down, close: 7 }], "high-low"), [
    { startsAt: 0, endsAt: 75, kind: "high-low", top: 9, bottom: 1, direction: "up" }
  ]);
  assert.deepEqual(multiTimePeriodBoxes([{ ...down, open: null }], "open-close"), []);
  assert.deepEqual(multiTimePeriodBoxes([{ ...down, high: null, low: null }], "open-close"), [
    { startsAt: 0, endsAt: 75, kind: "open-close", top: 7, bottom: 3, direction: "down" }
  ]);
});

test("MTPC True Range uses the previous close on both sides of price gaps", () => {
  const gapUp = period(100, 300, 18, 22, 17, 21);
  const gapDown = period(300, 400, 11, 12, 7, 9);
  assert.deepEqual(multiTimePeriodBoxes([previous, gapUp, gapDown], "true-range"), [
    { startsAt: 100, endsAt: 300, kind: "true-range", top: 22, bottom: 15, direction: "up" },
    { startsAt: 300, endsAt: 400, kind: "true-range", top: 21, bottom: 7, direction: "down" }
  ]);
  assert.deepEqual(multiTimePeriodBoxes([{ ...previous, close: null }, gapUp], "true-range"), []);
});

test("the two automatic timeframe policies use distinct thresholds", () => {
  assert.deepEqual(
    ["1m", "15m", "30m", "45m", "4h", "1d", "1w", "1M", "12M"].map(autoStandardPivotInterval),
    ["1d", "1d", "1w", "1w", "1w", "1M", "1M", "1M", "1M"]
  );
  assert.deepEqual(
    ["1m", "15m", "30m", "45m", "4h", "1d", "1w", "1M", "3M", "6M", "12M"].map(
      autoMultiTimePeriodInterval
    ),
    ["1d", "1d", "1d", "1d", "1d", "1w", "1M", "3M", "12M", "12M", "12M"]
  );
});
