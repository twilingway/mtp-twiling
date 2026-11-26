import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { compileQuoteTurnover, quoteTurnoverWindow, readQuoteTurnover, turnoverInterval } = load(
  "model/technical-indicators/ta-batch-volume-flow-turnover.js"
);
const { loadPublicQuoteTurnover } = load("services/market-turnover.js");
const { calculateTechnicalIndicator, createTechnicalIndicatorInstance } = load(
  "model/technical-indicators/index.js"
);
const day = 86_400_000;
const minute = 60_000;
const fiveMinutes = 5 * minute;
const candle = (timestamp) => ({ timestamp, open: 9, high: 11, low: 8, close: 10, volume: 9000 });
const sample = (timestamp, quoteTurnover = 2) => ({ timestamp, quoteTurnover });
const bybit = {
  uid: "bybit:spot:BTCUSDT",
  quoteCoin: "USDT",
  assetClass: "crypto",
  providerRef: { provider: "bybit", category: "spot", symbol: "BTCUSDT" }
};
const okx = {
  uid: "okx:linear:BTC-USDT-SWAP",
  quoteCoin: "USDT",
  assetClass: "crypto",
  providerRef: { provider: "okx", category: "linear", symbol: "BTC-USDT-SWAP" }
};
const history = (range, bars, interval = "1m") => ({
  instrumentKey: bybit.uid,
  currency: bybit.quoteCoin,
  interval,
  range,
  bars
});

test("24h source interval and request budget depend on the chart interval", () => {
  assert.equal(turnoverInterval("1m"), "1m");
  assert.equal(turnoverInterval("4h"), "1m");
  assert.equal(turnoverInterval("1d"), "5m");
  assert.equal(turnoverInterval("1w"), "5m");
  assert.equal(turnoverInterval("1M"), "1h");
  assert.deepEqual(quoteTurnoverWindow("5m", 2 * day + minute, 3 * day + minute), {
    from: day,
    to: 3 * day
  });
  assert.deepEqual(quoteTurnoverWindow("1m", 0, 20 * day), {
    from: 20 * day - 5_999 * minute,
    to: 20 * day
  });
});

test("turnover uses the provider quote field and its original currency only", async () => {
  const calls = [];
  const reply = (source) => async (ref, interval, range, signal) => {
    assert.equal(signal.aborted, false);
    calls.push([source, ref, interval, range]);
    return [
      { timestamp: -minute, baseVolume: 123456, quoteTurnover: 300 },
      { timestamp: 0, baseVolume: 123456, quoteTurnover: 0 },
      { timestamp: minute, baseVolume: 123456, quoteTurnover: 81 }
    ];
  };
  const signal = new AbortController().signal;
  for (const row of [bybit, okx]) {
    const received = await loadPublicQuoteTurnover(
      row,
      "1m",
      { from: 0, to: minute },
      signal,
      reply("bybit"),
      reply("okx")
    );
    assert.equal(received.instrumentKey, row.uid);
    assert.equal(received.currency, "USDT");
    assert.deepEqual(received.bars, [sample(0, 0), sample(minute, 81)]);
  }
  assert.deepEqual(
    calls.map(([source, ref]) => [source, ref.provider]),
    [
      ["bybit", "bybit"],
      ["okx", "okx"]
    ]
  );
  assert.equal(
    await loadPublicQuoteTurnover(
      { ...bybit, uid: "bank" },
      "1m",
      { from: 0, to: minute },
      signal,
      reply("bybit"),
      reply("okx")
    ),
    null
  );
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    loadPublicQuoteTurnover(
      bybit,
      "1m",
      { from: 0, to: minute },
      stopped.signal,
      reply("bybit"),
      reply("okx")
    ),
    { name: "AbortError" }
  );
  assert.equal(calls.length, 2);
});

test("the rolling total excludes the left boundary and a missing lower candle poisons only its window", () => {
  const range = { from: 0, to: 2 * day };
  const bars = Array.from({ length: 2881 }, (_, i) => sample(i * minute, i === 0 ? 40 : 2));
  const complete = compileQuoteTurnover(history(range, bars));
  assert.equal(complete.values[1438], null);
  assert.equal(complete.values[1439], 2918);
  assert.equal(complete.values[1440], 2880);
  const sparse = compileQuoteTurnover(
    history(
      range,
      bars.filter(({ timestamp }) => timestamp !== minute)
    )
  );
  assert.deepEqual(
    readQuoteTurnover(sparse, [candle(day), candle(day + minute), candle(3 * day)], "1m"),
    [null, 2880, null]
  );
});

test("the registered indicator uses only lower observations before the chart close", () => {
  const to = day + 20 * minute;
  const bars = Array.from({ length: to / fiveMinutes + 1 }, (_, i) =>
    sample(i * fiveMinutes, i < 288 ? 2 : 10)
  );
  const turnover24Hours = compileQuoteTurnover(history({ from: 0, to }, bars, "5m"));
  const higher = [candle(0), candle(day), candle(2 * day)];
  const instance = createTechnicalIndicatorInstance("volume-24-hours", "turnover-1");
  const context = { historicalVolatilityPeriodsPerYear: 365, chartInterval: "1d" };
  assert.equal(
    calculateTechnicalIndicator(instance, higher, context).unavailableReason,
    "volume-unavailable"
  );
  const result = calculateTechnicalIndicator(instance, higher, {
    ...context,
    volumeStudies: { turnover24Hours }
  });
  assert.deepEqual(result.series.value, [576, 616, null]);
  assert.equal(result.historyRequirement.windowMs, day);
});
