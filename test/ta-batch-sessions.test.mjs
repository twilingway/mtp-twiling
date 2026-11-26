import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { priceGaps } = load("model/technical-indicators/ta-batch-sessions-gaps.ts");
const { performanceTable } = load("model/technical-indicators/ta-batch-sessions-performance.ts");
const { seasonalChanges } = load("model/technical-indicators/ta-batch-sessions-seasonality.ts");
const { tradingSessionRanges } = load("model/technical-indicators/ta-batch-sessions-trading.ts");
const { moonPhases } = load("model/technical-indicators/ta-batch-sessions-moon.ts");

function bar(timestamp, low, high, open = low, close = high) {
  return { timestamp, low, high, open, close, volume: null };
}

const anchorBars = Array.from({ length: 13 }, (_, index) => bar(index, 10, 12));
const gapOptions = { maxGaps: 12 };

test("Gaps waits for 14 adjacent ranges and applies an inclusive relative width threshold", () => {
  const gap = priceGaps([...anchorBars, bar(13, 13, 15)], { ...gapOptions, deviationPercent: 50 });
  assert.deepEqual(gap, [
    {
      direction: "up",
      detectionTimestamp: 13,
      segments: [{ startTimestamp: 12, endTimestamp: null, lower: 12, upper: 13 }]
    }
  ]);
  assert.deepEqual(priceGaps([...anchorBars, bar(13, 12.25, 14.25)], gapOptions), []);
  assert.deepEqual(priceGaps([...anchorBars.slice(1), bar(13, 13, 15)], gapOptions), []);
  assert.deepEqual(
    priceGaps([bar(0, null, null), ...anchorBars.slice(1), bar(13, 13, 15)], gapOptions),
    []
  );
});

test("Gaps shortens both changing edges in partial mode and otherwise closes at first entry", () => {
  const rising = [
    ...anchorBars,
    bar(13, 14, 16),
    bar(14, 14, 16),
    bar(15, 13, 16),
    bar(16, 12, 16)
  ];
  const falling = [...anchorBars, bar(13, 6, 8), bar(14, 6, 8), bar(15, 6, 9), bar(16, 6, 10)];
  assert.deepEqual(priceGaps(rising, { ...gapOptions, closePartially: true })[0].segments, [
    { startTimestamp: 12, endTimestamp: 15, lower: 12, upper: 14 },
    { startTimestamp: 15, endTimestamp: 16, lower: 12, upper: 13 }
  ]);
  assert.deepEqual(priceGaps(falling, { ...gapOptions, closePartially: true })[0], {
    direction: "down",
    detectionTimestamp: 13,
    segments: [
      { startTimestamp: 12, endTimestamp: 15, lower: 8, upper: 10 },
      { startTimestamp: 15, endTimestamp: 16, lower: 9, upper: 10 }
    ]
  });
  assert.deepEqual(priceGaps(rising, gapOptions)[0].segments, [
    { startTimestamp: 12, endTimestamp: 15, lower: 12, upper: 14 }
  ]);
});

test("Gaps applies the configured trail to the left edge and clips the oldest events", () => {
  const bars = [...anchorBars, bar(13, 14, 16), bar(14, 14, 16), bar(15, 18, 20)];
  assert.deepEqual(
    priceGaps(bars, { maxGaps: 2, maxTrailBars: 2 }).map(
      ({ segments }) => segments.at(-1).endTimestamp
    ),
    [14, null]
  );
  assert.equal(priceGaps(bars, { maxGaps: 1, maxTrailBars: 1 })[0].segments[0].endTimestamp, 15);
  assert.throws(() => priceGaps(bars, { maxGaps: 0 }), RangeError);
});

const at = (value) => Date.parse(value);
const daily = (timestamp, close) => ({ timestamp: at(timestamp), close });
const symbol = (dailyBars, timeZone = "UTC") => ({ symbol: "TEST", dailyBars, timeZone });

test("Performance uses anchor close on an earlier trading day for a weekend and a nonzero base", () => {
  const bars = [
    daily("2025-10-09T00:00:00Z", 100),
    daily("2025-10-10T00:00:00Z", 110),
    daily("2025-10-13T00:00:00Z", 121)
  ];
  const [short, long] = performanceTable([symbol(bars)], ["2D", "1W"])[0].cells;
  assert.deepEqual(short, {
    timeframe: "2D",
    percent: 10,
    anchorTimestamp: bars[1].timestamp,
    anchorClose: 110
  });
  assert.equal(long.percent, null);
  assert.equal(long.anchorTimestamp, null);
  const [zero] = performanceTable([symbol([{ ...bars[1], close: 0 }, bars[2]])], ["2D"])[0].cells;
  assert.equal(zero.anchorClose, 0);
  assert.equal(zero.percent, null);
});

test("Performance clamps leap date, supports YTD and keeps different symbols independent", () => {
  const bars = [
    daily("2023-02-28T10:00:00Z", 120),
    daily("2023-12-29T10:00:00Z", 150),
    daily("2024-01-01T10:00:00Z", 160),
    daily("2024-01-29T10:00:00Z", 175),
    daily("2024-02-29T10:00:00Z", 180)
  ];
  const results = performanceTable(
    [symbol(bars), { ...symbol([]), symbol: "OTHER" }],
    ["1Y", "YTD", "M"]
  );
  assert.deepEqual(
    results[0].cells.map(({ anchorClose }) => anchorClose),
    [120, 150, 175]
  );
  assert.deepEqual(
    results[1].cells.map(({ percent }) => percent),
    [null, null, null]
  );
  assert.throws(() => performanceTable([symbol(bars)], ["XYZ"]), RangeError);
});

test("Performance uses local civil time for months and elapsed hours for days across DST", () => {
  const bars = [
    daily("2026-02-09T14:30:00Z", 90),
    daily("2026-03-05T14:30:00Z", 95),
    daily("2026-03-06T14:30:00Z", 100),
    daily("2026-03-09T13:30:00Z", 125)
  ];
  const [month, days] = performanceTable([symbol(bars, "America/New_York")], ["M", "3D"])[0].cells;
  assert.equal(month.anchorClose, 90);
  assert.equal(days.anchorClose, 95);
});

const month = (year, month, close, complete = true) => ({ year, month, close, complete });

test("Seasonality projects each month using previous-year observations at its opening", () => {
  const sample = [
    month(2024, 1, 100),
    month(2024, 2, 110),
    month(2025, 1, 200),
    month(2025, 2, 180),
    month(2026, 1, 300),
    month(2026, 2, 312, false)
  ];
  const { cells, statistics } = seasonalChanges(sample, { startYear: 2024 });
  assert.equal(cells[1].projection, null);
  assert.ok(Math.abs(cells[3].projection.expectedClose - 220) < 1e-12);
  assert.equal(cells[3].projection.historical.average, 10);
  assert.equal(cells[5].changePercent, 4);
  assert.equal(cells[5].projection.expectedClose, 300);
  assert.deepEqual(statistics[1], {
    count: 2,
    average: 0,
    standardDeviation: 10,
    percentPositive: 50
  });
});

test("Seasonality omits missing adjacent months and keeps actual closes after ignored periods", () => {
  const { cells, statistics } = seasonalChanges(
    [month(2024, 12, 100), month(2025, 1, 120), month(2025, 2, 150), month(2025, 4, 200)],
    { startYear: 2025, ignoredMonths: ["2025-01"] }
  );
  assert.deepEqual(
    cells.map(({ changePercent }) => changePercent),
    [null, 25, null]
  );
  assert.equal(statistics[0].count, 0);
  assert.equal(statistics[1].count, 1);
  assert.throws(
    () => seasonalChanges([month(2025, 1, 1, false), month(2025, 2, 2)], { startYear: 2025 }),
    RangeError
  );
});

test("Trading Sessions uses IANA daylight changes and excludes the closing boundary", () => {
  const winter = at("2025-01-03T14:30:00Z");
  const summer = at("2025-07-03T13:30:00Z");
  const bars = [
    bar(winter - 60_000, 1, 9),
    bar(winter, 10, 14, 11, 12),
    bar(winter + 60_000, 11, 15, 12, 14),
    bar(summer, 20, 22),
    bar(summer + 60_000, 25, 30)
  ];
  const ranges = tradingSessionRanges(
    bars,
    [{ id: "ny", startMinute: 570, endMinute: 571, timeZone: "America/New_York" }],
    { intraday: true, tickSize: 0.5 }
  );
  assert.deepEqual(
    ranges.map(({ startTimestamp }) => startTimestamp),
    [winter, summer]
  );
  assert.deepEqual(
    ranges.map(({ barCount, tickRange }) => [barCount, tickRange]),
    [
      [1, 8],
      [1, 4]
    ]
  );
});

test("Trading Sessions keeps overnight ranges together and reports real open, close and mean", () => {
  const bars = [
    bar(at("2025-07-03T15:30:00Z"), 10, 12, 10, 11),
    bar(at("2025-07-03T18:00:00Z"), 9, 14, 11, 13),
    bar(at("2025-07-03T19:29:00Z"), 10, 12, 11, 12),
    bar(at("2025-07-03T19:30:00Z"), 3, 50)
  ];
  const sessions = [{ id: "overnight", startMinute: 1320, endMinute: 120 }];
  const [range] = tradingSessionRanges(bars, sessions, {
    intraday: true,
    exchangeTimeZone: "GMT+0630"
  });
  assert.equal(range.calendarStartDay, at("2025-07-03T00:00:00Z"));
  assert.deepEqual(
    [range.open, range.close, range.high, range.low, range.averageClose],
    [10, 12, 14, 9, 12]
  );
  assert.equal(range.lastTimestamp, bars[2].timestamp);
  assert.equal(range.barCount, 3);
  assert.equal(range.tickRange, null);
  assert.deepEqual(tradingSessionRanges(bars, sessions, { intraday: false }), []);
  assert.throws(() => tradingSessionRanges(bars, sessions, { intraday: true }), RangeError);
});

test("Trading Sessions treats equal boundaries as a 24-hour session from the chosen time", () => {
  const bars = [
    bar(at("2025-07-03T17:00:00Z"), 10, 12),
    bar(at("2025-07-04T16:59:00Z"), 10, 12),
    bar(at("2025-07-04T17:00:00Z"), 10, 12)
  ];
  const ranges = tradingSessionRanges(
    bars,
    [{ id: "full", startMinute: 1020, endMinute: 1020, timeZone: "UTC" }],
    { intraday: true }
  );
  assert.deepEqual(
    ranges.map(({ barCount }) => barCount),
    [2, 1]
  );
});

test("Moon Phases aligns real USNO UTC events to the first eligible opening and stops at coverage", () => {
  const phases = [
    { kind: "new", timestamp: at("2026-01-18T19:52:00Z") },
    { kind: "full", timestamp: at("2026-02-01T22:09:00Z") }
  ];
  const ephemeris = {
    startTimestamp: at("2026-01-11T00:00:00Z"),
    endTimestamp: at("2026-02-10T00:00:00Z"),
    phases
  };
  const bars = ["2026-01-18", "2026-01-19", "2026-02-01", "2026-02-02", "2026-02-10"].map(
    (date) => ({ timestamp: at(date) })
  );
  const aligned = moonPhases(bars, ephemeris);
  assert.deepEqual(
    aligned.map(({ stage }) => stage),
    [null, "waxing", "waxing", "waning", null]
  );
  assert.deepEqual(
    aligned.map(({ markers }) => markers),
    [[], [phases[0]], [], [phases[1]], []]
  );
  assert.deepEqual(moonPhases(bars.slice(2), ephemeris)[0], {
    ...bars[2],
    stage: "waxing",
    markers: []
  });
  assert.ok(moonPhases(bars).every(({ stage, markers }) => stage === null && markers.length === 0));
});
