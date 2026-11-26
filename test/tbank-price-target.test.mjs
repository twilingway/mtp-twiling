import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { loadTbankConsensusForecasts, loadTbankPriceTarget, normalizeTbankConsensusForecast } = load(
  "services/instrument-details/tbank-price-target.ts"
);
const { priceTargetLevels } = load("model/technical-indicators/ta-batch-external.ts");
const instrumentUid = "bank-instrument";
const assetUid = "bank-asset";
const asOf = Date.parse("2024-03-04T14:00:00Z");
const signal = new AbortController().signal;
const quote = (units, nano = 0) => ({ units: String(units), nano });
const date = "2024-02-29T00:00:00Z";
const recordTime = "2024-03-01T06:00:00Z";

function forecast(patch = {}) {
  return {
    uid: "forecast-current",
    assetUid,
    currency: "rub",
    prognosisDate: date,
    createdAt: recordTime,
    bestTargetLow: quote(100),
    bestTargetPrice: quote(120, 500_000_000),
    bestTargetHigh: quote(150),
    totalBuyRecommend: 3,
    totalHoldRecommend: 1,
    totalSellRecommend: 0,
    ...patch
  };
}

function page(pageNumber, limit, totalCount, items) {
  return { page: { pageNumber, limit, totalCount }, items };
}

function fixture({ pages = [page(0, 100, 1, [forecast()])], instrument = {}, candles, hold } = {}) {
  const calls = [];
  const client = {
    owner: "profile-a",
    authenticated: true,
    closed: false,
    async request(service, method, body, requestSignal) {
      calls.push({ service, method, body });
      if (method === "GetInstrumentBy")
        return {
          instrument: {
            uid: instrumentUid,
            assetUid,
            instrumentType: "share",
            currency: "RUB",
            ...instrument
          }
        };
      if (method === "GetConsensusForecasts") {
        await hold?.(requestSignal);
        return pages[body.paging.pageNumber];
      }
      assert.equal(method, "GetCandles");
      return (
        candles ?? {
          priceCurrency: "rub",
          candles: [{ time: date, close: quote(110), isComplete: true }]
        }
      );
    }
  };
  return { client, calls };
}

test("normalizes actual T-Bank identity, source dates, quote fractions and counts", () => {
  assert.deepEqual(normalizeTbankConsensusForecast(forecast()), {
    uid: "forecast-current",
    assetUid,
    currency: "RUB",
    recordCreatedTimestamp: Date.parse(recordTime),
    forecastTimestamp: Date.parse(date),
    low: 100,
    target: 120.5,
    high: 150,
    analystCount: 4
  });
  assert.equal(
    normalizeTbankConsensusForecast(forecast({ totalSellRecommend: undefined })).analystCount,
    null
  );
  for (const invalid of [
    { prognosisDate: "2024-02-30T00:00:00Z" },
    { prognosisDate: "2024-02-29" },
    { createdAt: undefined },
    { currency: "rub/usd" },
    { bestTargetPrice: quote("0x78") },
    { bestTargetPrice: quote(120, -1) },
    { bestTargetPrice: quote(120, 1e9) },
    { bestTargetLow: quote("9007199254740992") },
    { bestTargetLow: { units: null, nano: 12 } },
    { bestTargetLow: quote(121) },
    { bestTargetHigh: quote(119) }
  ])
    assert.equal(normalizeTbankConsensusForecast(forecast(invalid)), null);
});

test("uses the latest observable forecast for the exact asset and currency after full pagination", async () => {
  const { client, calls } = fixture({
    pages: [
      page(0, 3, 5, [
        forecast({ uid: "forecast-other-asset", assetUid: "other-asset" }),
        forecast({ uid: "forecast-other-currency", currency: "USD" }),
        forecast({
          uid: "forecast-older",
          prognosisDate: "2024-02-27T00:00:00Z",
          createdAt: "2024-02-28T06:00:00Z"
        })
      ]),
      page(1, 3, 5, [
        forecast(),
        forecast({ uid: "forecast-unseen", createdAt: "2024-03-05T00:00:00Z" })
      ])
    ],
    candles: {
      priceCurrency: "rub",
      candles: [
        { time: "2024-02-28T00:00:00Z", close: quote(90), isComplete: true },
        { time: date, close: quote(110), isComplete: true },
        { time: date, close: quote(180), isComplete: false },
        { time: "2024-03-01T00:00:00Z", close: quote(140), isComplete: true }
      ]
    }
  });
  const result = await loadTbankPriceTarget(client, instrumentUid, asOf, signal);
  assert.deepEqual(calls, [
    {
      service: "InstrumentsService",
      method: "GetInstrumentBy",
      body: { idType: "INSTRUMENT_ID_TYPE_UID", id: instrumentUid }
    },
    {
      service: "InstrumentsService",
      method: "GetConsensusForecasts",
      body: { paging: { limit: 100, pageNumber: 0 } }
    },
    {
      service: "InstrumentsService",
      method: "GetConsensusForecasts",
      body: { paging: { limit: 100, pageNumber: 1 } }
    },
    {
      service: "MarketDataService",
      method: "GetCandles",
      body: {
        instrumentId: instrumentUid,
        interval: "CANDLE_INTERVAL_DAY",
        candleSourceType: "CANDLE_SOURCE_EXCHANGE",
        from: "2024-02-29T00:00:00.000Z",
        to: "2024-03-01T00:00:00.000Z"
      }
    }
  ]);
  assert.deepEqual(result.referenceClose, {
    instrumentKey: instrumentUid,
    currency: "RUB",
    timestamp: Date.parse(date),
    close: 110
  });
  assert.equal(result.forecast.publicationTimestamp, Date.parse(recordTime));
  assert.equal(result.forecast.horizonTimestamp, Date.parse("2025-02-28T00:00:00Z"));
  const levels = priceTargetLevels(result.forecast, result.referenceClose, asOf);
  assert.equal(levels.levels.mean.price, 120.5);
  assert.ok(Math.abs(levels.levels.mean.changePercent - 9.545454545454545) < 1e-12);
});

test("rejects partial, drifting, repeated or over-budget forecast pages", async () => {
  for (const pages of [
    [page(0, 2, 3, [forecast()])],
    [page(0, 1, 2, [forecast()]), page(1, 1, 3, [forecast({ uid: "additional" })])],
    [page(0, 1, 2, [forecast()]), page(1, 1, 2, [forecast()])],
    [page(0, 1, 33, [forecast()])]
  ]) {
    const { client } = fixture({ pages });
    await assert.rejects(
      loadTbankConsensusForecasts(client, signal),
      /CONSENSUS_FORECAST_COVERAGE/
    );
  }
  const { client } = fixture({ pages: [page(0, 100, 0, [])] });
  assert.deepEqual(await loadTbankConsensusForecasts(client, signal), []);
});

test("conflicting forecasts with the same identity rank cannot depend on provider row order", async () => {
  const { client, calls } = fixture({
    pages: [
      page(0, 100, 2, [
        forecast(),
        forecast({ uid: "forecast-same-time", bestTargetPrice: quote(121) })
      ])
    ]
  });
  assert.equal(await loadTbankPriceTarget(client, instrumentUid, asOf, signal), null);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["GetInstrumentBy", "GetConsensusForecasts"]
  );
});

test("does not substitute adjacent, incomplete, ambiguous or different-currency reference candles", async () => {
  for (const candles of [
    { candles: [{ time: "2024-03-01T00:00:00Z", close: quote(140), isComplete: true }] },
    { candles: [{ time: date, close: quote(110), isComplete: false }] },
    {
      candles: [
        { time: date, close: quote(110), isComplete: true },
        { time: date, close: quote(111), isComplete: true }
      ]
    },
    { priceCurrency: "usd", candles: [{ time: date, close: quote(110), isComplete: true }] }
  ]) {
    const { client } = fixture({ candles });
    assert.equal(await loadTbankPriceTarget(client, instrumentUid, asOf, signal), null);
  }
  for (const instant of ["2024-02-29T14:00:00Z", "2025-02-28T00:00:00Z"]) {
    const { client, calls } = fixture({
      pages: [page(0, 100, 1, [forecast({ createdAt: date })])]
    });
    assert.equal(
      await loadTbankPriceTarget(client, instrumentUid, Date.parse(instant), signal),
      null
    );
    assert.equal(calls.filter(({ method }) => method === "GetCandles").length, 0);
  }
});

test("no bank data request for crypto IDs and no generic ticker or asset lookup fallback", async () => {
  const { client, calls } = fixture({ instrument: { instrumentType: "bond" } });
  assert.equal(await loadTbankPriceTarget(client, "bybit:spot:BTCUSDT", asOf, signal), null);
  assert.equal(calls.length, 0);
  assert.equal(await loadTbankPriceTarget(client, instrumentUid, asOf, signal), null);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["GetInstrumentBy"]
  );
  const invalid = fixture({ instrument: { uid: "wrong-instrument" } });
  await assert.rejects(
    loadTbankPriceTarget(invalid.client, instrumentUid, asOf, signal),
    /INSTRUMENT_RESPONSE/
  );
});

test("rejects cancelled or changed-session forecast requests before fetching a reference price", async () => {
  for (const invalidate of [
    (_client, controller) => controller.abort(),
    (client) => {
      client.owner = "new-profile";
    },
    (client) => {
      client.authenticated = false;
    },
    (client) => {
      client.closed = true;
    }
  ]) {
    let started, release;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    const { client, calls } = fixture({
      hold: () => {
        started();
        return pending;
      }
    });
    const rejected = assert.rejects(
      loadTbankPriceTarget(client, instrumentUid, asOf, controller.signal),
      { name: "AbortError" }
    );
    await entered;
    invalidate(client, controller);
    release();
    await rejected;
    assert.deepEqual(
      calls.map(({ method }) => method),
      ["GetInstrumentBy", "GetConsensusForecasts"]
    );
  }
});
