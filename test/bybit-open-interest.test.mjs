import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { BybitHttp } = load("services/providers/bybit/http.js");
const { loadBybitOpenInterest } = load("services/providers/bybit/open-interest.js");
const { MarketClient } = load("services/market-client.js");
const ref = { provider: "bybit", category: "linear", symbol: "BTCUSDT" };
const start = Date.UTC(2026, 10, 26, 9);
const hour = 3_600_000;
const end = start + 3 * hour;
const request = { from: start, to: end };
const row = (timestamp, singleOpenInterest, openInterest = "87") => ({
  timestamp: String(timestamp),
  singleOpenInterest,
  openInterest
});
const response = (list, rest = {}) =>
  new Response(
    JSON.stringify({
      retCode: 0,
      time: end + hour,
      result: { category: ref.category, symbol: ref.symbol, list, nextPageCursor: "", ...rest }
    })
  );

function setup(responses) {
  const calls = [];
  const http = new BybitHttp({
    fetch: (input, init) => {
      calls.push({ url: new URL(input), init });
      const result = responses.shift();
      assert.ok(result, "unexpected Bybit request");
      return Promise.resolve(result());
    }
  });
  return { calls, http };
}

test("Bybit open interest requests native pages without credentials and preserves units, gaps and actual zero", async () => {
  const cursor = "lastid%3D11%26lasttime%3D1795680000";
  const { calls, http } = setup([
    () => response([row(end, "24.125"), row(end - hour, "0")], { nextPageCursor: cursor }),
    () => response([row(end - hour, "12"), row(start, undefined)])
  ]);
  const observed = [];
  const result = await loadBybitOpenInterest(http, ref, "BTC", "1h", request, undefined, (page) => {
    observed.push(page.rows);
  });
  assert.deepEqual(result, {
    instrumentKey: "bybit:linear:BTCUSDT",
    unit: { kind: "base", currency: "BTC" },
    rows: [
      { timestamp: start, value: null },
      { timestamp: end - hour, value: 0 },
      { timestamp: end, value: 24.125 }
    ]
  });
  assert.equal(observed.length, 2);
  assert.equal(calls[0].url.pathname, "/v5/market/open-interest");
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    category: "linear",
    symbol: "BTCUSDT",
    intervalTime: "1h",
    startTime: String(start),
    endTime: String(end),
    limit: "200"
  });
  assert.equal(calls[1].url.searchParams.get("cursor"), cursor);
  assert.ok(calls.every(({ init }) => init.method === "GET" && init.credentials === "omit"));
});

test("Bybit open interest rejects bad provider identity, rows, and repeated pagination", async () => {
  const wrongInstrument = setup([() => response([], { symbol: "ETHUSDT" })]);
  await assert.rejects(loadBybitOpenInterest(wrongInstrument.http, ref, "BTC", "1h", request), {
    kind: "protocol"
  });
  const badRow = setup([() => response([row(end, "-2")])]);
  await assert.rejects(loadBybitOpenInterest(badRow.http, ref, "BTC", "1h", request), {
    kind: "protocol"
  });
  const stuck = setup([
    () => response([row(end, "1")], { nextPageCursor: "one" }),
    () => response([row(end - hour, "2")], { nextPageCursor: "one" })
  ]);
  await assert.rejects(loadBybitOpenInterest(stuck.http, ref, "BTC", "1h", request), {
    kind: "pagination"
  });
  const unused = setup([]);
  await assert.rejects(loadBybitOpenInterest(unused.http, ref, "BTC", "1m", request), RangeError);
  await assert.rejects(
    loadBybitOpenInterest(unused.http, { ...ref, category: "spot" }, "BTC", "5m", request),
    RangeError
  );
  assert.equal(unused.calls.length, 0);
});

test("Reading Bybit open interest through MarketClient leaves active market subscriptions intact", async () => {
  const { calls, http } = setup([() => response([row(end, "7")])]);
  const subscriptions = [];
  const client = new MarketClient(
    null,
    "test",
    {},
    {
      http,
      stream: () => ({
        setSubscriptions: (subscription) => subscriptions.push(subscription),
        start() {},
        dispose() {}
      })
    }
  );
  const linearUid = "bybit:linear:BTCUSDT",
    spotUid = "bybit:spot:BTCUSDT";
  client.rows = [
    { uid: linearUid, symbol: linearUid, providerRef: ref, baseCoin: "BTC" },
    { uid: spotUid, symbol: spotUid, providerRef: { ...ref, category: "spot" }, baseCoin: "BTC" },
    { uid: "shares", symbol: "SBER" }
  ];
  client.subscribeCandles(linearUid, "1h");
  const prior = subscriptions.length;
  assert.ok(prior > 0);
  const signal = new AbortController().signal;
  assert.equal(await client.loadOpenInterest(spotUid, "1h", request, signal), null);
  assert.equal(await client.loadOpenInterest("shares", "1h", request, signal), null);
  assert.equal(await client.loadOpenInterest(linearUid, "1m", request, signal), null);
  assert.equal(calls.length, 0);
  const observed = await client.loadOpenInterest(linearUid, "1h", request, signal);
  assert.deepEqual(observed.rows, [{ timestamp: end, value: 7 }]);
  assert.equal(calls.length, 1);
  assert.equal(subscriptions.length, prior);
});

test("Bybit open interest discards a late response after the chart switches source", async () => {
  const controller = new AbortController();
  const { calls, http } = setup([
    () => {
      controller.abort();
      return response([row(end, "42")]);
    }
  ]);
  let notifications = 0;
  await assert.rejects(
    loadBybitOpenInterest(
      http,
      ref,
      "BTC",
      "1h",
      request,
      controller.signal,
      () => notifications++
    ),
    { name: "AbortError" }
  );
  assert.equal(calls.length, 1);
  assert.equal(notifications, 0);
});
