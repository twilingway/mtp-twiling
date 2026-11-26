import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { confirmedZigzag, williamsFractals } = load(
  "model/technical-indicators/ta-batch-fib-pivots.js"
);
const { fibonacciRetracementLevels, fibonacciExtensionLevels, pitchforkGeometry } = load(
  "model/technical-indicators/ta-batch-fib-geometry.js"
);
const { trendlinePivotRuns, trendlineBreakout } = load(
  "model/technical-indicators/ta-batch-fib-trendlines.js"
);
const { autoKeyLevelsForPeriod } = load("model/technical-indicators/ta-batch-fib-key-levels.js");

const timestamp = (index) => 1000 + index * 60_000;
const bar = (index, price) => ({
  timestamp: timestamp(index),
  open: price,
  close: price,
  high: price,
  low: price,
  volume: (index + 1) * 10
});
const bars = (prices) => prices.map((price, index) => bar(index, price));
const anchor = (index, value) => ({ index, timestamp: timestamp(index), value });
const profileRows = (volumes) => volumes.map((volume, low) => ({ low, high: low + 1, volume }));

test("Williams fractals anchor the marker to the center and wait for two closed bars", () => {
  const input = bars([10, 12, 15, 13, 11, 8, 9, 10]);
  assert.deepEqual(williamsFractals(input.slice(0, 4)), []);
  assert.deepEqual(williamsFractals(input), [
    { ...anchor(2, 15), confirmedAt: 4, kind: "high" },
    { ...anchor(5, 8), confirmedAt: 7, kind: "low" }
  ]);
});

test("Williams fractals reject equal highs and gaps while allowing a wide two-sided bar", () => {
  assert.deepEqual(williamsFractals(bars([1, 2, 4, 4, 3])), []);
  assert.deepEqual(williamsFractals(bars([1, null, 4, 2, 1])), []);
  const input = bars([10, 10, 10, 10, 10]);
  input[2] = { ...input[2], high: 30, low: 0 };
  assert.deepEqual(
    williamsFractals(input).map((point) => [point.kind, point.value]),
    [
      ["high", 30],
      ["low", 0]
    ]
  );
});

test("rolling pivot windows agree with strict direct comparisons on ties and long runs", () => {
  const input = bars(Array.from({ length: 3000 }, (_, index) => (index * 61 + (index % 43)) % 29));
  for (const radius of [1, 2, 7, 20, 45]) {
    const expected = [];
    for (let index = radius; index < input.length - radius; index++) {
      const peers = input
        .slice(index - radius, index + radius + 1)
        .filter((point) => point !== input[index]);
      for (const kind of ["high", "low"]) {
        const value = input[index][kind];
        if (peers.every((peer) => (kind === "high" ? value > peer.high : value < peer.low)))
          expected.push({ ...anchor(index, value), confirmedAt: index + radius, kind });
      }
    }
    assert.deepEqual(williamsFractals(input, radius), expected);
  }
});

test("Zigzag waits for pivots, replaces the last extreme and includes an exactly equal threshold", () => {
  const input = bars([90, 100, 96, 110, 99, 101]);
  assert.deepEqual(confirmedZigzag(input.slice(0, 5), 3, 10), []);
  assert.deepEqual(confirmedZigzag(input, 3, 10), [
    {
      from: { ...anchor(3, 110), confirmedAt: 4, kind: "high" },
      to: { ...anchor(4, 99), confirmedAt: 5, kind: "low" },
      priceChange: -11,
      percentChange: -10,
      volume: 50
    }
  ]);
});

test("Zigzag handles negative prices, right ties and unknown volume", () => {
  const negative = bars([-80, -50, -55, -40, -65, -62]);
  negative[4].volume = null;
  const [reversal] = confirmedZigzag(negative, 2, 20);
  assert.equal(reversal.from.index, 3);
  assert.equal(reversal.percentChange, -62.5);
  assert.equal(reversal.volume, null);
  const [plateau] = confirmedZigzag(bars([5, 7, 7, 6, 8]), 2, 10);
  assert.equal(plateau.from.index, 1);
  assert.equal(plateau.to.index, 3);
});

test("Zigzag keeps disconnected price runs and avoids ambiguous zero-based percentages", () => {
  const input = bars([2, 8, 1, 4, null, 9, 2, 7, 4]);
  assert.deepEqual(
    confirmedZigzag(input, 2, 0).map(({ from, to }) => [from.index, to.index]),
    [
      [1, 2],
      [6, 7]
    ]
  );
  const zero = bars([9, 0, 4, 1]);
  assert.deepEqual(confirmedZigzag(zero, 2, 1), []);
  assert.equal(confirmedZigzag(zero, 2, 0)[0].percentChange, null);
  assert.throws(() => confirmedZigzag(zero, 1, 5), RangeError);
});

test("Fibonacci levels use the impulse direction and the retracement origin", () => {
  const a = anchor(0, 100);
  const b = anchor(2, 130);
  const c = anchor(4, 110);
  assert.deepEqual(
    fibonacciRetracementLevels([a, b], [0, 0.5, 1]).map(({ value }) => value),
    [130, 115, 100]
  );
  assert.deepEqual(
    fibonacciRetracementLevels([a, b], [0, 1], true).map(({ value }) => value),
    [100, 130]
  );
  assert.deepEqual(
    fibonacciExtensionLevels([a, b, c], [0, 1, 2]).map(({ value }) => value),
    [110, 140, 170]
  );
  assert.equal(fibonacciExtensionLevels([a, b, c], [1], true)[0].value, 110);
  assert.equal(fibonacciExtensionLevels([anchor(0, 130), anchor(2, 100), c], [2])[0].value, 50);
  assert.throws(() => fibonacciRetracementLevels([b, a]), RangeError);
});

test("all four pitchforks build the documented median in bar coordinates", () => {
  const points = [anchor(0, 100), anchor(2, 130), anchor(6, 110)];
  const p = (index, value) => ({ index, value });
  const expected = {
    original: { from: p(0, 100), through: p(4, 120) },
    schiff: { from: p(0, 115), through: p(4, 120) },
    "modified-schiff": { from: p(1, 115), through: p(4, 120) },
    inside: { from: p(1, 115), through: p(6, 110) }
  };
  for (const [variant, median] of Object.entries(expected))
    assert.deepEqual(pitchforkGeometry(points, variant).median, median);
  const { levels } = pitchforkGeometry(points, "original", [1]);
  assert.deepEqual(levels, [
    {
      ratio: 1,
      upper: { from: p(0, 120), through: p(4, 140) },
      lower: { from: p(0, 80), through: p(4, 100) }
    }
  ]);
  assert.throws(() => pitchforkGeometry(points, "schiff", [-1]), RangeError);
});

test("trendline swing input covers actual small and large windows with ATR warm-up", () => {
  const input = bars(Array(130).fill(100));
  for (const [index, price] of [
    [3, 60],
    [18, 135],
    [33, 75],
    [65, 50],
    [100, 150]
  ])
    input[index] = bar(index, price);
  const small = trendlinePivotRuns(input, "small");
  const large = trendlinePivotRuns(input, "large");
  assert.deepEqual(
    small[0].map((p) => [p.index, p.confirmedAt]),
    [
      [18, 23],
      [65, 70],
      [100, 105]
    ]
  );
  assert.deepEqual(
    large[0].map((p) => [p.index, p.confirmedAt]),
    [
      [65, 90],
      [100, 125]
    ]
  );
  assert.deepEqual(trendlinePivotRuns(input.slice(0, 50), "large"), []);
});

test("trendline reversal rejects a move inside the configured ATR distance", () => {
  const input = bars(Array(40).fill(100)).map((candle) => ({ ...candle, high: 120, low: 80 }));
  input[16].high = 121;
  input[26].low = 79;
  assert.deepEqual(
    trendlinePivotRuns(input, "small")[0].map((p) => p.index),
    [16]
  );
});

test("trendline candidates have at most 5000 bars of anchor history", () => {
  const input = bars(Array(5200).fill(100));
  for (const [index, price] of [
    [100, 155],
    [150, 40],
    [220, 145],
    [250, 70]
  ])
    input[index] = bar(index, price);
  assert.deepEqual(
    trendlinePivotRuns(input, "small")
      .flat()
      .map((point) => point.index),
    [220, 250]
  );
});

test("a line breakout uses consecutive closes on the correct side and resets on missing bars", () => {
  const input = bars([10, 11, 10, 9, 10, 9, 8, null, 9, 8, 7]);
  assert.equal(
    trendlineBreakout(input.slice(0, -1), anchor(0, 10), anchor(2, 10), "support"),
    null
  );
  assert.deepEqual(trendlineBreakout(input, anchor(0, 10), anchor(2, 10), "support"), {
    firstOutsideIndex: 8,
    confirmedAt: 10,
    timestamp: timestamp(10)
  });
  assert.deepEqual(
    trendlineBreakout(bars([10, 10, 11, 12, 13]), anchor(0, 10), anchor(1, 10), "resistance"),
    {
      firstOutsideIndex: 2,
      confirmedAt: 4,
      timestamp: timestamp(4)
    }
  );
  assert.throws(
    () => trendlineBreakout(input, anchor(2, 10), anchor(2, 10), "support"),
    RangeError
  );
});

test("key levels return observed OHLC independently of the supplied volume profile", () => {
  assert.deepEqual(autoKeyLevelsForPeriod(bars([10, 12, 8, 11])), {
    prices: { open: 10, high: 12, low: 8, close: 11 },
    profile: null
  });
  assert.deepEqual(autoKeyLevelsForPeriod(bars([10, null, 11])), { prices: null, profile: null });
  assert.equal(autoKeyLevelsForPeriod([], profileRows([0, 0])).profile, null);
});

test("value area resolves ties, stops on overshoot and keeps the lowest tied POC", () => {
  const rows = profileRows([1, 4, 10, 4, 4]);
  assert.deepEqual(autoKeyLevelsForPeriod([], rows, 14 / 23).profile, { poc: 2.5, vah: 4, val: 2 });
  assert.deepEqual(autoKeyLevelsForPeriod([], rows, 18 / 23).profile, { poc: 2.5, vah: 4, val: 1 });
  assert.deepEqual(autoKeyLevelsForPeriod([], profileRows([2, 10, 8])).profile, {
    poc: 1.5,
    vah: 2,
    val: 1
  });
  assert.deepEqual(autoKeyLevelsForPeriod([], profileRows([10, 10, 1])).profile, {
    poc: 0.5,
    vah: 1,
    val: 0
  });
  assert.deepEqual(autoKeyLevelsForPeriod([], profileRows([0, 2, 0]), 1).profile, {
    poc: 1.5,
    vah: 3,
    val: 0
  });
  assert.throws(
    () =>
      autoKeyLevelsForPeriod(
        [],
        profileRows([1, 0, 2]).filter((row) => row.volume)
      ),
    RangeError
  );
});
