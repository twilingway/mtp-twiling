import assert from "node:assert/strict";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const {
  marketBreadthStudies,
  marketBreadthCoverage,
  parseMarketBreadthFile,
  MAX_MARKET_BREADTH_FILE_SIZE
} = load("model/technical-indicators/catalog-expansion/market-breadth.js");

function observed(date, advancing, declining, unchanged, advancingVolume, decliningVolume) {
  return {
    date,
    kind: "observed",
    counts: { advancing, declining, unchanged, universeSize: advancing + declining + unchanged },
    volumes: { advancing: advancingVolume, declining: decliningVolume }
  };
}

function dataset() {
  return {
    schemaVersion: 1,
    marketId: "X:test",
    universe: "Historical day-specific members of the test segment",
    source: "Test fixture",
    timeZone: "Europe/Moscow",
    volumeUnit: "shares",
    from: "2026-10-23",
    to: "2026-10-29",
    baseline: { line: -5, volume: 100 },
    rows: [
      observed("2026-10-23", 3, 1, 2, 120, 80),
      { date: "2026-10-24", kind: "closed" },
      { date: "2026-10-25", kind: "closed" },
      observed("2026-10-26", 2, 3, 1, 150, 200),
      { date: "2026-10-27", kind: "unknown" },
      observed("2026-10-28", 0, 2, 5, 0, 100),
      observed("2026-10-29", 4, 0, 5, 200, 0)
    ]
  };
}

function parse(raw = dataset()) {
  return parseMarketBreadthFile(JSON.stringify(raw));
}

function bars(timestamps) {
  return timestamps.map((time) => ({
    timestamp: Date.parse(time),
    open: 4,
    high: 7,
    low: 2,
    close: 6,
    volume: 11
  }));
}

function context(data, marketId = data.metadata.marketId, dateBasis = "utc-date") {
  return {
    chartInterval: "1d",
    historicalVolatilityPeriodsPerYear: 365,
    marketBreadth: { data, marketId, dateBasis }
  };
}

const [line, ratio, cvi] = marketBreadthStudies;
test("import validates calendar coverage and computes statistics from day-specific market breadth", () => {
  const source = parse();
  assert.deepEqual(source.coverage, {
    countDays: 4,
    volumeDays: 4,
    availableDays: { line: 2, ratio: 3, cvi: 2 }
  });
  assert.deepEqual(source.series, {
    line: [-3, null, null, -4, null, null, null],
    ratio: [3, null, null, 2 / 3, null, 0, null],
    cvi: [140, null, null, 90, null, null, null]
  });
  assert.equal(source.metadata.source, "Test fixture");
  assert.equal(source.metadata.volumeUnit, "shares");
  assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.series.line));
});

test("projection keeps cumulative values from earlier market dates outside the view and blanks unknown dates", () => {
  const source = parse();
  const prices = bars([
    "2026-10-22T00:00:00Z",
    "2026-10-24T00:00:00Z",
    "2026-10-26T00:00:00Z",
    "2026-10-28T00:00:00Z",
    "2026-10-30T00:00:00Z"
  ]);
  assert.deepEqual(line.calculate(prices, {}, context(source)).value, [null, null, -4, null, null]);
  assert.deepEqual(ratio.calculate(prices, {}, context(source)).value, [
    null,
    null,
    2 / 3,
    0,
    null
  ]);
  assert.deepEqual(cvi.calculate(prices, {}, context(source)).value, [null, null, 90, null, null]);
  assert.deepEqual(marketBreadthCoverage(prices, context(source).marketBreadth), {
    line: true,
    ratio: true,
    cvi: true
  });
  assert.deepEqual(marketBreadthCoverage(prices.slice(-2), context(source).marketBreadth), {
    line: false,
    ratio: true,
    cvi: false
  });
  assert.deepEqual(marketBreadthCoverage(prices.slice(-1), context(source).marketBreadth), {
    line: false,
    ratio: false,
    cvi: false
  });
  assert.equal(line.history({}).historyRequirement.lookbackBars, null);
  assert.equal(ratio.history({}).historyRequirement.lookbackBars, 1);
});

test("exchange-local matching uses the exact market date for a previous-UTC-day open", () => {
  const source = parse();
  const prices = bars(["2026-10-22T21:00:00Z", "2026-10-25T21:00:00Z"]);
  assert.deepEqual(
    line.calculate(prices, {}, context(source, "X:test", "exchange-local")).value,
    [-3, -4]
  );
  assert.deepEqual(line.calculate(prices, {}, context(source)).value, [null, null]);
  const duplicateDays = bars(["2026-10-23T07:00:00Z", "2026-10-23T12:00:00Z"]);
  assert.deepEqual(ratio.calculate(duplicateDays, {}, context(source)).value, [null, null]);
});

test("missing market, wrong market, unknown time basis, and non-daily charts leave all studies unavailable", () => {
  const source = parse();
  const wrongMarket = context(source, "Y:test");
  const prices = bars(["2026-10-23T00:00:00Z"]);
  for (const study of marketBreadthStudies)
    for (const scope of [
      undefined,
      wrongMarket,
      { ...context(source), chartInterval: "1h" },
      { ...context(source), chartInterval: "1w" },
      context(source, "X:test", "unknown"),
      context(JSON.parse(JSON.stringify(source)))
    ]) {
      assert.equal(study.unavailableReason(prices.length, {}, scope), "external-data-unavailable");
      assert.deepEqual(study.calculate(prices, {}, scope).value, [null]);
    }
});

test("count-only and volume-only days leave the other aggregate unknown independently", () => {
  const raw = dataset();
  raw.rows[0].volumes = null;
  raw.rows[3].counts = null;
  const source = parse(raw);
  assert.deepEqual(source.series.line, [-3, null, null, null, null, null, null]);
  assert.deepEqual(source.series.ratio, [3, null, null, null, null, 0, null]);
  assert.ok(source.series.cvi.every((value) => value === null));
  assert.equal(source.coverage.volumeDays, 3);
  assert.equal(cvi.unavailableReason(1, {}, context(source)), "external-data-unavailable");

  raw.baseline.line = null;
  const noBaseline = parse(raw);
  assert.ok(noBaseline.series.line.every((value) => value === null));
  assert.equal(noBaseline.series.ratio[0], 3);
});

test("rejects invalid dates, reordered or missing coverage, mismatched counts, unclassified volume and unitless sums", () => {
  for (const update of [
    (raw) => (raw.schemaVersion = 2),
    (raw) => (raw.source = ""),
    (raw) => (raw.timeZone = "invalid"),
    (raw) => (raw.from = "2026-02-30"),
    (raw) => raw.rows.splice(4, 1),
    (raw) => (raw.rows[4].date = raw.rows[3].date),
    (raw) => (raw.rows[2].kind = "observed"),
    (raw) => (raw.rows[1].unknownField = true),
    (raw) => (raw.rows[0].counts.universeSize = 999),
    (raw) => (raw.rows[0].counts.advancing = -1),
    (raw) => (raw.rows[0].counts.declining = 0.5),
    (raw) => (raw.rows[0].counts.unchanged = Number.MAX_SAFE_INTEGER + 1),
    (raw) => (raw.rows[5].volumes.advancing = 120),
    (raw) => (raw.rows[0].volumes.advancing = -1),
    (raw) => (raw.volumeUnit = null)
  ]) {
    const raw = dataset();
    update(raw);
    assert.throws(() => parse(raw), RangeError);
  }
  assert.throws(
    () => parseMarketBreadthFile(" ".repeat(MAX_MARKET_BREADTH_FILE_SIZE + 1)),
    RangeError
  );
  assert.throws(() => parseMarketBreadthFile("{"), SyntaxError);
  assert.equal(parseMarketBreadthFile("\uFEFF" + JSON.stringify(dataset())).series.ratio[0], 3);
});

function find(root, type) {
  if (Array.isArray(root)) return root.map((node) => find(node, type)).find(Boolean);
  if (!root?.props) return undefined;
  return root.type === type ? root : find(root.props.children, type);
}

test("local picker validates before replacing the source and invalidates pending reads on disconnect", async () => {
  const state = [];
  let index = 0;
  let cleanup;
  let data = null;
  const changes = [];
  const view = createSourceLoader({
    "react/jsx-runtime": jsx,
    react: {
      useState(initial) {
        const position = index++;
        if (!(position in state)) state[position] = initial;
        return [state[position], (value) => (state[position] = value)];
      },
      useRef(initial) {
        const position = index++;
        return (state[position] ??= { current: initial });
      },
      useEffect: (effect) => {
        cleanup ??= effect();
      }
    }
  })("screens/terminal/MarketBreadthFilePicker.js").MarketBreadthFilePicker;
  const render = () => {
    index = 0;
    return view({
      english: false,
      data,
      onChange(next) {
        changes.push(next);
        data = next;
      }
    });
  };
  const select = async (file) => {
    const input = { files: [file], value: "file.json" };
    find(render(), "input").props.onChange({ currentTarget: input });
    assert.equal(input.value, "");
    await new Promise(setImmediate);
  };
  await select({ size: 100, text: async () => JSON.stringify(dataset()) });
  assert.equal(changes[0].series.ratio[0], 3);
  await select({ size: 100, text: async () => "{}" });
  assert.equal(changes.length, 1);
  assert.equal(find(render(), "p").props.role, "alert");
  await select({
    size: MAX_MARKET_BREADTH_FILE_SIZE + 1,
    text: () => assert.fail("oversize file was read")
  });
  assert.equal(changes.length, 1);
  let finish;
  const reading = select({
    size: 100,
    text: () => new Promise((resolve) => (finish = resolve))
  });
  find(render(), "button").props.onClick();
  finish(JSON.stringify(dataset()));
  await reading;
  assert.deepEqual(changes, [changes[0], null]);
  cleanup();
});
