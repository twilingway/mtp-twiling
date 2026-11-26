import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { correlationStudies } = load("model/technical-indicators/catalog-expansion/correlation.js");
const { loadCorrelationComparison, selectCorrelationComparison } = load(
  "services/correlation-history.js"
);
const { compilePresentation } = load("model/technical-indicators/presentation.js");
const [study] = correlationStudies;
const day = 86_400_000;
const start = Date.UTC(2025, 0, 1);
const time = (index) => start + index * day;
const coin = (category, symbol = "BTCUSDT") => ({
  symbol: `bybit:${category}:${symbol}`,
  uid: `bybit:${category}:${symbol}`,
  ticker: symbol,
  providerRef: { provider: "bybit", category, symbol }
});
const futures = coin("linear");
const spot = coin("spot");
const bank = { symbol: "SBER", uid: "bank-unique", ticker: "SBER" };

function bar(index, close, open = close) {
  return {
    timestamp: time(index),
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1
  };
}

function context(bars, timeframe = "1d", instrumentUid = spot.uid) {
  return {
    historicalVolatilityPeriodsPerYear: 365,
    chartInterval: "1d",
    correlationHistory: {
      primaryUid: futures.uid,
      timeframe,
      comparisons: new Map([[spot.uid, { instrumentUid, timeframe, bars }]])
    }
  };
}

test("Correlation preserves the exact listed identity through equal labels, missing rows, and ambiguous IDs", () => {
  assert.deepEqual(selectCorrelationComparison([spot, futures, bank], spot.uid, futures.uid), {
    uid: spot.uid,
    symbol: spot.symbol
  });
  assert.deepEqual(selectCorrelationComparison([spot, futures, bank], bank.uid, futures.uid), {
    uid: bank.uid,
    symbol: bank.symbol
  });
  assert.equal(selectCorrelationComparison([spot, futures], "BTCUSDT", futures.uid), null);
  assert.equal(selectCorrelationComparison([spot, futures], futures.uid, futures.uid), null);
  assert.equal(selectCorrelationComparison([spot, spot], spot.uid, futures.uid), null);
  assert.equal(selectCorrelationComparison([spot], bank.uid, futures.uid), null);
  assert.equal(
    selectCorrelationComparison([{ ...spot, symbol: futures.symbol }], spot.uid, futures.uid),
    null
  );
  assert.equal(study.validParams({ comparisonUid: "" }), true);
  assert.equal(study.validParams({ comparisonUid: "bybit:spot:btc" }), false);
  assert.equal(study.validParams({ comparisonUid: "unsafe\nuid" }), false);
});

test("Comparison loads the same interval and bounds through a read-only source and clips other timestamps", async () => {
  const abort = new AbortController();
  const intended = { from: time(0), to: time(2) };
  const calls = [];
  const result = await loadCorrelationComparison(
    {
      loadCandles(symbol, timeframe, range, options) {
        calls.push({ symbol, timeframe, range, options });
        return Promise.resolve({
          symbol,
          timeframe,
          candles: [bar(-1, 10), bar(0, 11), bar(2, 13), bar(3, 14)]
        });
      }
    },
    spot,
    "1d",
    intended,
    abort.signal
  );
  assert.deepEqual(calls, [
    {
      symbol: spot.symbol,
      timeframe: "1d",
      range: intended,
      options: { uid: spot.uid, signal: abort.signal }
    }
  ]);
  assert.deepEqual(result, {
    instrumentUid: spot.uid,
    timeframe: "1d",
    bars: [bar(0, 11), bar(2, 13)]
  });
});

test("Comparison rejects mismatched replies and drops a late result from a switched chart", async () => {
  const abort = new AbortController();
  const range = { from: time(0), to: time(2) };
  await assert.rejects(
    loadCorrelationComparison(
      {
        loadCandles: async () => ({ symbol: spot.symbol, timeframe: "1h", candles: [bar(0, 11)] })
      },
      spot,
      "1d",
      range,
      abort.signal
    ),
    /requested symbol and interval/
  );
  const result = loadCorrelationComparison(
    {
      async loadCandles() {
        abort.abort();
        await Promise.resolve();
        return { symbol: spot.symbol, timeframe: "1d", candles: [bar(0, 5)] };
      }
    },
    spot,
    "1d",
    range,
    abort.signal
  );
  await assert.rejects(result, { name: "AbortError" });
});

test("Correlation uses complete exact-timestamp windows, the selected source, and defined zero separately", () => {
  const first = [bar(0, 1), bar(1, 2), bar(2, 3), bar(3, 5), bar(4, 6), bar(5, 7), bar(6, 8)];
  const second = [bar(0, 1, 3), bar(1, 3, 1), bar(2, 2, 2), bar(4, 6), bar(5, 7), bar(6, 8)];
  const params = { comparisonUid: spot.uid, length: 3, source: "close" };
  const output = study.calculate(first, params, context(second)).value;
  assert.deepEqual(output.slice(0, 2), [null, null]);
  assert.ok(Math.abs(output[2] - 0.5) < 1e-12);
  assert.deepEqual(output.slice(3, 6), [null, null, null]);
  assert.ok(Math.abs(output[6] - 1) < 1e-12);
  const opens = study.calculate(first, { ...params, source: "open" }, context(second)).value;
  assert.ok(Math.abs(opens[2] + 0.5) < 1e-12);
  const flat = [bar(0, 2), bar(1, 2), bar(2, 2)];
  assert.deepEqual(
    study.calculate(first, params, context(flat)).value,
    first.map(() => null)
  );
  const zero = [bar(0, 1), bar(1, 3), bar(2, 1)];
  const zeroValue = study.calculate(first, params, context(zero)).value[2];
  assert.ok(zeroValue !== null && Math.abs(zeroValue) < 1e-12);
});

test("An empty selection or mismatched cached context leaves an empty series and explicit unavailability", () => {
  const bars = [bar(0, 1), bar(1, 2)];
  const params = { comparisonUid: spot.uid, length: 2, source: "close" };
  for (const input of [undefined, context(bars, "1h"), context(bars, "1d", bank.uid)]) {
    assert.equal(study.unavailableReason(bars.length, params, input), "external-data-unavailable");
    assert.deepEqual(study.calculate(bars, params, input).value, [null, null]);
  }
  assert.equal(
    study.unavailableReason(100_000, { ...params, length: 10_000 }, context(bars)),
    "calculation-limit"
  );
  assert.deepEqual(study.history(params), {
    warmupBars: 2,
    historyRequirement: {
      kind: "finite",
      lookbackBars: 2,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    }
  });
  assert.equal(study.definition.parameters.find(({ key }) => key === "length").defaultValue, 20);
  assert.equal(
    study.definition.parameters.find(({ key }) => key === "source").defaultValue,
    "close"
  );
});

test("Correlation compiles a gapped area and independently styled reference levels", () => {
  const result = compilePresentation(study.definition.presentation, {
    timestamps: [time(0), time(1), time(2), time(3)],
    series: { value: [0.5, 0, null, -0.5] },
    visible: true,
    collapsed: false,
    styles: { correlationZero: { color: "#ff0000", width: 2, visible: false } }
  });
  assert.deepEqual(result.plots[0].geometry, { kind: "line", gaps: "break" });
  assert.deepEqual(result.fills[0].from, [0.5, 0, null, -0.5]);
  assert.deepEqual(result.fills[0].to, [0, 0, 0, 0]);
  assert.deepEqual(
    result.referenceLevels.map(({ value }) => value),
    [1, 0, -1]
  );
  assert.equal(result.referenceLevels[1].visible, false);
});
