import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { loadOkxSpotTradeHistory } = load("services/providers/okx/trade-history.js");
const { OkxHttp } = load("services/providers/okx/http.js");
const { netVolumeForChart } = load("model/technical-indicators/catalog-expansion/net-volume.js");
const { technicalCatalogEntries } = load("model/technical-indicators/catalog.js");
const { calculateTechnicalIndicator, createTechnicalIndicatorInstance } = load(
  "model/technical-indicators/index.js"
);
const { TechnicalRenderData } = load("charts/technical-render-data.js");

const ref = { provider: "okx", category: "spot", symbol: "BTC-USDT" };
const instrumentKey = "okx:spot:BTC-USDT";
const raw = (id, ts, px = 10, sz = 2) => ({
  instId: ref.symbol,
  tradeId: String(id),
  ts: String(ts),
  px: String(px),
  sz: String(sz)
});
const tape = (pages) => ({
  seen: [],
  get(path, query, signal) {
    if (signal?.aborted) throw signal.reason;
    this.seen.push({ path, query });
    return Promise.resolve(pages.shift() ?? []);
  }
});

test("OKX pagination excludes the right timestamp and retains ticks tied within one ms", async () => {
  const base = 9_007_199_254_741_000n;
  const history = tape([
    [raw(base + 3n, 119), raw(base + 4n, 119), raw(base + 5n, 125)],
    [raw(base + 1n, 100), raw(base + 2n, 119), raw(base, 99)]
  ]);
  const loaded = await loadOkxSpotTradeHistory(history, ref, { from: 100, to: 130 });
  assert.deepEqual(loaded.coverage, { from: 100, to: 130 });
  assert.equal(loaded.previous.id, String(base));
  assert.deepEqual(
    loaded.trades.map((trade) => trade.id),
    [1n, 2n, 3n, 4n, 5n].map((id) => String(base + id))
  );
  assert.deepEqual(
    history.seen.map(({ query }) => [query.type, query.after]),
    [
      ["2", "130"],
      ["1", String(base + 3n)]
    ]
  );
});

test("a gap or page cap discards the incomplete first millisecond and retains an actual seed", async () => {
  const request = { from: 100, to: 200 };
  const page = [raw(103, 180), raw(102, 180), raw(101, 170)];
  const gap = await loadOkxSpotTradeHistory(tape([[...page, raw(99, 130)]]), ref, request);
  const capped = await loadOkxSpotTradeHistory(tape([page]), ref, request, undefined, 1);
  for (const entry of [gap, capped]) {
    assert.deepEqual(entry.coverage, { from: 171, to: 200 });
    assert.equal(entry.previous.id, "101");
    assert.deepEqual(
      entry.trades.map(({ id }) => id),
      ["102", "103"]
    );
  }
  assert.equal((await loadOkxSpotTradeHistory(tape([[]]), ref, request)).coverage, null);
  const provenEmpty = await loadOkxSpotTradeHistory(tape([[raw(100, 99)]]), ref, request);
  assert.deepEqual(provenEmpty.coverage, request);
  assert.equal(provenEmpty.previous.id, "100");
  assert.deepEqual(provenEmpty.trades, []);
});

test("malformed chronology, wrong instrument and cancellation fail closed", async () => {
  const range = { from: 100, to: 200 };
  await assert.rejects(loadOkxSpotTradeHistory(tape([[raw(102, 200)]]), ref, range), {
    kind: "pagination"
  });
  await assert.rejects(
    loadOkxSpotTradeHistory(tape([[raw(102, 170), raw(101, 171)]]), ref, range),
    { kind: "pagination" }
  );
  await assert.rejects(
    loadOkxSpotTradeHistory(tape([[{ ...raw(102, 170), instId: "ETH-USDT" }]]), ref, range),
    { kind: "protocol" }
  );
  await assert.rejects(
    loadOkxSpotTradeHistory(tape([[raw(102, 170)], [raw(102, 170)]]), ref, range),
    { kind: "pagination" }
  );
  const abort = new AbortController();
  abort.abort();
  const noRequest = tape([]);
  await assert.rejects(loadOkxSpotTradeHistory(noRequest, ref, range, abort.signal), {
    name: "AbortError"
  });
  assert.deepEqual(noRequest.seen, []);
});

test("the OKX transport loads only the approved public tape without credentials", async () => {
  const requests = [];
  const http = new OkxHttp({
    fetch: (url, init) => {
      requests.push({ url: new URL(url), init });
      return Promise.resolve(Response.json({ code: "0", data: [raw(102, 99)] }));
    }
  });
  const result = await loadOkxSpotTradeHistory(http, ref, { from: 100, to: 200 });
  assert.equal(result.instrumentKey, instrumentKey);
  assert.equal(requests[0].url.host, "openapi.okx.com");
  assert.equal(requests[0].url.pathname, "/api/v5/market/history-trades");
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(requests[0].init.method, "GET");
  await assert.rejects(http.get("/api/v5/trade/fills", {}), { kind: "protocol" });
});

const minute = 60000;
const timestamp = 10 * minute;
const chart = [-1, 0, 1, 2, 3].map((index) => ({
  timestamp: timestamp + minute * index,
  open: null,
  close: null,
  low: null,
  high: null,
  volume: null
}));
const row = (id, ms, price, quantity) => ({ id: String(id), timestamp: ms, price, quantity });
const input = {
  instrumentKey,
  coverage: { from: timestamp, to: timestamp + 3 * minute },
  previous: row(10, timestamp - 1, 10, 1),
  trades: [
    row(11, timestamp, 12, 2),
    row(12, timestamp, 11, 3),
    row(13, timestamp + 1, 11, 20),
    row(14, timestamp + minute, 10, 8)
  ]
};

test("Net Volume seeds from a real tick, excludes unchanged prices, and blanks uncovered candles", () => {
  assert.deepEqual(netVolumeForChart(chart, "1m", input), [null, -1, -8, 0, null]);
  assert.deepEqual(
    netVolumeForChart(chart, "1m", { ...input, previous: null }),
    chart.map(() => null)
  );
  const partial = {
    ...input,
    coverage: { ...input.coverage, from: timestamp + 1 },
    previous: input.trades[1],
    trades: input.trades.slice(2)
  };
  assert.deepEqual(netVolumeForChart(chart, "1m", partial), [null, null, -8, 0, null]);
});

test("registered Net Volume receives only matching asynchronous spot trade history", () => {
  assert.ok(technicalCatalogEntries("en").find(({ id }) => id === "STD;Net%1Volume").available);
  const instance = createTechnicalIndicatorInstance("net-volume", "net-volume");
  const context = { historicalVolatilityPeriodsPerYear: 365, chartInterval: "1m" };
  assert.equal(
    calculateTechnicalIndicator(instance, chart, context).unavailableReason,
    "volume-unavailable"
  );
  const data = new TechnicalRenderData(context);
  data.setData(chart);
  const supplements = { volumeStudies: { netVolumeTrades: input } };
  assert.equal(data.setSupplementalInputs(supplements, "other"), false);
  assert.deepEqual(
    data.compile([instance]).outputs[0].values,
    chart.map(() => null)
  );
  assert.equal(data.setSupplementalInputs(supplements, instrumentKey), true);
  assert.deepEqual(data.compile([instance]).outputs[0].values, [null, -1, -8, 0, null]);
});
