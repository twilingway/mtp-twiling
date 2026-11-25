import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(name) {
  const filename = new URL(`../src/model/intervals/${name}.ts`, import.meta.url);
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(
    require,
    module,
    module.exports
  );
  return module.exports;
}
const { INTERVALS, getInterval, isIntervalId } = load("registry");
const { aggregateCalendarMonths, aggregateSessionCandles } = load("aggregate");
const at = (text) => Date.parse(text);
const candle = (date, value = 10, extra = {}) => ({
  timestamp: at(date),
  open: value,
  high: value + 4,
  low: value - 2,
  close: value + 1,
  volume: 3,
  ...extra
});
const month = (date, value, extra) => candle(`${date}-01T00:00:00Z`, value, extra);
const later = { asOf: at("2030-01-01T00:00:00Z") };

test("registry exposes exactly the accepted 18 IDs without aliases", () => {
  assert.deepEqual(
    INTERVALS.map((item) => item.id),
    [
      "1m",
      "2m",
      "3m",
      "5m",
      "10m",
      "15m",
      "30m",
      "45m",
      "1h",
      "2h",
      "3h",
      "4h",
      "1d",
      "1w",
      "1M",
      "3M",
      "6M",
      "12M"
    ]
  );
  for (const item of INTERVALS) assert.equal(isIntervalId(item.id), true);
  for (const value of ["1y", "1s", "5s", "1mo", "1H", null, {}, 1])
    assert.equal(isIntervalId(value), false);
  assert.throws(() => getInterval("unknown"), RangeError);
});
test("native history and stream mapping matches official proto, including new minute/hour IDs", () => {
  const expected = {
    "1m": [1, "1_MIN", "ONE_MINUTE"],
    "5m": [2, "5_MIN", "FIVE_MINUTES"],
    "15m": [3, "15_MIN", "FIFTEEN_MINUTES"],
    "1h": [4, "HOUR", "ONE_HOUR"],
    "1d": [5, "DAY", "ONE_DAY"],
    "2m": [6, "2_MIN", "2_MIN"],
    "3m": [7, "3_MIN", "3_MIN"],
    "10m": [8, "10_MIN", "10_MIN"],
    "30m": [9, "30_MIN", "30_MIN"],
    "2h": [10, "2_HOUR", "2_HOUR"],
    "4h": [11, "4_HOUR", "4_HOUR"],
    "1w": [12, "WEEK", "WEEK"],
    "1M": [13, "MONTH", "MONTH"]
  };
  assert.equal(INTERVALS.filter((item) => item.kind === "native").length, 13);
  for (const [id, [number, history, stream]] of Object.entries(expected)) {
    const item = getInterval(id);
    assert.equal(item.history.enumValue, number);
    assert.equal(item.history.apiInterval, `CANDLE_INTERVAL_${history}`);
    assert.equal(item.stream.enumValue, number);
    assert.equal(item.stream.apiInterval, `SUBSCRIPTION_INTERVAL_${stream}`);
  }
  assert.equal(getInterval("2h").alignment, "utc-midnight");
  assert.equal(getInterval("4h").alignment, "utc-midnight");
});
test("derived IDs expose real source rather than a fake bank enum", () => {
  for (const [id, source] of [
    ["45m", "15m"],
    ["3h", "1h"],
    ["3M", "1M"],
    ["6M", "1M"],
    ["12M", "1M"]
  ]) {
    const item = getInterval(id);
    assert.equal(item.kind, "derived");
    assert.equal(item.source, source);
    assert.equal(Object.hasOwn(item, "history"), false);
    assert.equal(Object.hasOwn(item, "stream"), false);
  }
});
test("leap-year quarter uses calendar arithmetic and preserves OHLCV", () => {
  const source = [month("2024-03", 20), month("2024-01", 10), month("2024-02", 5)];
  const before = structuredClone(source);
  const [bar] = aggregateCalendarMonths(source, 3, later);
  assert.deepEqual(bar, {
    timestamp: at("2024-01-01T00:00:00Z"),
    endTimestamp: at("2024-04-01T00:00:00Z"),
    open: 10,
    high: 24,
    low: 3,
    close: 21,
    volume: 9,
    sourceCount: 3,
    hasGaps: false,
    isComplete: true
  });
  assert.deepEqual(source, before);
});
test("cross-year quarters and gaps produce separate actual bars without synthetic months", () => {
  const result = aggregateCalendarMonths(
    [month("2023-12", 12), month("2024-01", 1), month("2024-03", 3)],
    3,
    later
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].timestamp, at("2023-10-01T00:00:00Z"));
  assert.equal(result[0].endTimestamp, at("2024-01-01T00:00:00Z"));
  assert.equal(result[1].volume, 6);
  assert.equal(result[1].hasGaps, true);
  assert.equal(result[1].isComplete, false);
});
test("calendar half-year and year end on exact UTC boundaries", () => {
  const source = Array.from({ length: 12 }, (_, index) =>
    month(`2024-${String(index + 1).padStart(2, "0")}`, index + 10)
  );
  const halves = aggregateCalendarMonths(source, 6, later);
  assert.equal(halves.length, 2);
  assert.equal(halves[0].endTimestamp, at("2024-07-01T00:00:00Z"));
  assert.equal(halves[1].endTimestamp, at("2025-01-01T00:00:00Z"));
  const [year] = aggregateCalendarMonths(source, 12, later);
  assert.equal(year.sourceCount, 12);
  assert.equal(year.isComplete, true);
  assert.equal(year.endTimestamp - year.timestamp, 366 * 86_400_000);
});
test("current quarter and incomplete native monthly bar stay incomplete", () => {
  const source = [month("2024-01", 10), month("2024-02", 11), month("2024-03", 12)];
  assert.equal(
    aggregateCalendarMonths(source, 3, { asOf: at("2024-03-15T00:00:00Z") })[0].isComplete,
    false
  );
  source[2].isComplete = false;
  assert.equal(aggregateCalendarMonths(source, 3, later)[0].isComplete, false);
});
test("duplicate stream updates replace a month without double-counting volume", () => {
  const result = aggregateCalendarMonths(
    [month("2024-01", 10), month("2024-01", 20), month("2024-02", 30), month("2024-03", 40)],
    3,
    later
  );
  assert.equal(result[0].open, 20);
  assert.equal(result[0].sourceCount, 3);
  assert.equal(result[0].volume, 9);
});
test("calendar source contract rejects nonmonthly data and invalid prices", () => {
  assert.throws(
    () => aggregateCalendarMonths([candle("2024-01-15T00:00:00Z")], 3, later),
    /monthly/
  );
  assert.throws(
    () => aggregateCalendarMonths([month("2024-01", 10, { volume: -1 })], 3, later),
    /Invalid source/
  );
  assert.throws(() => aggregateCalendarMonths([], 3, { asOf: NaN }), /asOf/);
  assert.deepEqual(aggregateCalendarMonths([], 3, later), []);
});
const session = { start: at("2024-02-29T07:00:00Z"), end: at("2024-02-29T09:00:00Z") };
const sessionOptions = { ...later, sessionFor: () => session };
test("45-minute bars anchor to supplied session, not UTC multiples", () => {
  const source = Array.from({ length: 8 }, (_, index) => ({
    ...candle("2024-02-29T07:00:00Z", 10 + index),
    timestamp: session.start + index * 15 * 60_000
  }));
  const before = structuredClone(source);
  const result = aggregateSessionCandles(source, "45m", sessionOptions);
  assert.deepEqual(
    result.map((c) => new Date(c.timestamp).toISOString()),
    ["2024-02-29T07:00:00.000Z", "2024-02-29T07:45:00.000Z", "2024-02-29T08:30:00.000Z"]
  );
  assert.deepEqual(
    result.map((c) => c.sourceCount),
    [3, 3, 2]
  );
  assert.equal(result[2].endTimestamp, session.end);
  assert.equal(result[2].isComplete, true);
  assert.equal(result[0].open, 10);
  assert.equal(result[0].close, 13);
  assert.equal(result[0].volume, 9);
  assert.deepEqual(source, before);
});
test("3-hour bars also require explicit alignment and recognize missing source hours", () => {
  const longSession = { start: session.start, end: session.start + 6 * 3_600_000 };
  const source = [0, 1, 2, 3, 5].map((index) => ({
    ...candle("2024-02-29T07:00:00Z", 10 + index),
    timestamp: session.start + index * 3_600_000
  }));
  const result = aggregateSessionCandles(source, "3h", { ...later, sessionFor: () => longSession });
  assert.equal(result[0].isComplete, true);
  assert.equal(result[1].hasGaps, true);
  assert.equal(result[1].isComplete, false);
  assert.equal(result[1].timestamp, at("2024-02-29T10:00:00Z"));
});
test("different sessions never merge across holidays or the year boundary", () => {
  const sessions = [
    { start: at("2023-12-29T07:00:00Z"), end: at("2023-12-29T07:45:00Z") },
    { start: at("2024-01-03T07:00:00Z"), end: at("2024-01-03T07:45:00Z") }
  ];
  const source = sessions.flatMap((s) =>
    [0, 1, 2].map((index) => ({
      ...candle("2023-12-29T07:00:00Z"),
      timestamp: s.start + index * 900_000
    }))
  );
  const result = aggregateSessionCandles(source, "45m", {
    ...later,
    sessionFor: (t) => sessions.find((s) => t >= s.start && t < s.end) ?? null
  });
  assert.equal(result.length, 2);
  assert.ok(result.every((c) => c.isComplete));
});
test("missing session, out-of-session timestamps and incompatible source alignment fail explicitly", () => {
  const source = [candle("2024-02-29T07:00:00Z")];
  assert.throws(
    () => aggregateSessionCandles(source, "45m", { ...later, sessionFor: () => null }),
    /explicit trading session/
  );
  assert.throws(
    () => aggregateSessionCandles([candle("2024-02-29T09:00:00Z")], "45m", sessionOptions),
    /explicit trading session/
  );
  assert.throws(
    () => aggregateSessionCandles([candle("2024-02-29T07:05:00Z")], "45m", sessionOptions),
    /not aligned/
  );
});
test("partial session bar stays incomplete before its actual end", () => {
  const result = aggregateSessionCandles(
    [0, 1, 2].map((index) => ({
      ...candle("2024-02-29T07:00:00Z"),
      timestamp: session.start + index * 900_000
    })),
    "45m",
    {
      asOf: at("2024-02-29T07:35:00Z"),
      sessionFor: () => session
    }
  );
  assert.equal(result[0].hasGaps, false);
  assert.equal(result[0].isComplete, false);
});
test("inconsistent session boundaries cannot silently merge source bars", () => {
  const source = [candle("2024-02-29T07:00:00Z"), candle("2024-02-29T07:15:00Z")];
  assert.throws(
    () =>
      aggregateSessionCandles(source, "45m", {
        ...later,
        sessionFor: (timestamp) => ({
          start: session.start,
          end: timestamp === session.start ? session.start + 30 * 60_000 : session.end
        })
      }),
    /Inconsistent trading session/
  );
});
