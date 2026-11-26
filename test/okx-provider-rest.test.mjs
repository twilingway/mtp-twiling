import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { OkxHttp } = load("services/providers/okx/http.ts");
const { OkxError, okxInstrumentRef, okxSeriesId } = load("services/providers/okx/types.ts");
const { loadOkxCatalog, normaliseOkxInstrument } = load("services/providers/okx/catalog.ts");
const { loadOkxHistory, loadOkxQuotes, normaliseOkxCandle, normaliseOkxQuote, okxNativeInterval } =
  load("services/providers/okx/market.ts");

const opened = Date.UTC(2026, 10, 26);
const day = 86_400_000;
const spot = (overrides = {}) => ({
  instType: "SPOT",
  instId: "BTC-USD",
  state: "live",
  instCategory: "1",
  baseCcy: "BTC",
  quoteCcy: "USD",
  tickSz: "0.01",
  listTime: String(opened),
  ...overrides
});
const swap = (overrides = {}) => ({
  instType: "SWAP",
  instId: "BTC-USDT-SWAP",
  state: "live",
  instCategory: "1",
  ctType: "linear",
  settleCcy: "USDT",
  instFamily: "BTC-USDT",
  uly: "BTC-USDT",
  ...overrides
});
const response = (data, code = "0") => new Response(JSON.stringify({ code, data }));
const kind = (expected) => (error) => error instanceof OkxError && error.kind === expected;

test("OKX HTTP permits only read-only public data, without credentials or redirects", async () => {
  const calls = [];
  const http = new OkxHttp({
    fetch: async (url, options) => {
      calls.push([url, options]);
      return response([spot()]);
    }
  });
  assert.deepEqual(await http.get("/api/v5/public/instruments", { instType: "SPOT" }), [spot()]);
  assert.equal(calls[0][0].origin, "https://openapi.okx.com");
  assert.equal(calls[0][0].searchParams.get("instType"), "SPOT");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].redirect, "error");
  await assert.rejects(http.get("/api/v5/trade/order", {}), kind("protocol"));
  await assert.rejects(http.get("//example.org/api/v5/public/instruments", {}), kind("protocol"));
  assert.equal(calls.length, 1);
});

test("HTTP throttling, API throttling, forbidden and malformed replies remain errors", async () => {
  const checks = [
    [new Response("{}", { status: 403 }), "forbidden"],
    [new Response("{}", { status: 429 }), "rate-limit"],
    [response([], "50011"), "rate-limit"],
    [response([], "51000"), "api"],
    [response([], 0), "protocol"],
    [response({ list: [] }), "protocol"],
    [new Response("plain text"), "protocol"]
  ];
  for (const [result, expected] of checks) {
    const http = new OkxHttp({ fetch: async () => result });
    await assert.rejects(http.get("/api/v5/market/tickers", {}), kind(expected));
  }
});

test("abort prevents applying a late public response or starting the next history request", async () => {
  const controller = new AbortController();
  const http = new OkxHttp({
    fetch: async () => {
      controller.abort();
      return response([]);
    }
  });
  await assert.rejects(http.get("/api/v5/market/tickers", {}, controller.signal), {
    name: "AbortError"
  });

  let requests = 0;
  const queued = new OkxHttp({
    fetch: async () => {
      requests++;
      return response([]);
    }
  });
  await queued.get("/api/v5/market/history-candles", {});
  const pendingController = new AbortController();
  const pending = queued.get("/api/v5/market/history-candles", {}, pendingController.signal);
  pendingController.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requests, 1);
});

test("catalog keeps exact crypto spot and USDT swaps, skipping unsupported instruments", async () => {
  const types = [];
  const rows = await loadOkxCatalog({
    async get(path, { instType }) {
      assert.equal(path, "/api/v5/public/instruments");
      types.push(instType);
      return instType === "SPOT"
        ? [
            spot({ tradeQuoteCcyList: ["USDT"] }),
            spot({ instId: "AAPL-USD", baseCcy: "AAPL", instCategory: "3" }),
            spot({ instCategory: "" }),
            spot({ state: "suspend" })
          ]
        : [
            swap(),
            swap({ instId: "BTC-USD-SWAP", ctType: "inverse", settleCcy: "BTC" }),
            swap({ instCategory: "5" })
          ];
    }
  });
  assert.deepEqual(types, ["SPOT", "SWAP"]);
  assert.deepEqual(rows, [
    {
      ref: okxInstrumentRef("spot", "BTC-USD"),
      baseCoin: "BTC",
      quoteCoin: "USD",
      settleCoin: null,
      tickSize: 0.01,
      launchTime: opened
    },
    {
      ref: okxInstrumentRef("linear", "BTC-USDT-SWAP"),
      baseCoin: "BTC",
      quoteCoin: "USDT",
      settleCoin: "USDT",
      tickSize: null,
      launchTime: null
    }
  ]);
  assert.equal(okxSeriesId(rows[0].ref), "okx:spot:BTC-USD");
  assert.equal(okxSeriesId(rows[1].ref), "okx:linear:BTC-USDT-SWAP");
});

test("catalog refuses missing fields, inconsistent tuples, duplicate IDs and incomplete markets", async () => {
  for (const [category, row] of [
    ["spot", spot({ instCategory: undefined })],
    ["spot", spot({ quoteCcy: "USDT" })],
    ["linear", swap({ settleCcy: undefined })],
    ["linear", swap({ uly: "ETH-USDT" })],
    ["linear", swap({ instFamily: "BTC-USDC" })]
  ])
    assert.throws(() => normaliseOkxInstrument(category, row), kind("protocol"));

  for (const spotRows of [[], [spot(), spot()]]) {
    await assert.rejects(
      loadOkxCatalog({
        async get(_path, { instType }) {
          return instType === "SPOT" ? spotRows : [swap()];
        }
      }),
      kind("protocol")
    );
  }
  const failed = new OkxError("network", "unavailable");
  await assert.rejects(
    loadOkxCatalog({
      async get(_path, { instType }) {
        if (instType === "SWAP") throw failed;
        return [spot()];
      }
    }),
    (error) => error === failed
  );
});

test("ticker comparison uses rolling 24 hours and preserves missing prices", async () => {
  const ref = okxInstrumentRef("spot", "BTC-USD");
  const fixture = {
    instType: "SPOT",
    instId: "BTC-USD",
    last: "105",
    open24h: "100",
    sodUtc0: "50",
    ts: String(opened)
  };
  assert.equal(normaliseOkxQuote(ref, fixture).changePercent24h, 5);
  assert.equal(normaliseOkxQuote(ref, { ...fixture, last: "100" }).changePercent24h, 0);
  assert.equal(normaliseOkxQuote(ref, { ...fixture, last: "" }).lastPrice, null);
  assert.equal(normaliseOkxQuote(ref, { ...fixture, open24h: "0" }).changePercent24h, null);
  assert.throws(() => normaliseOkxQuote(ref, { ...fixture, instType: "SWAP" }), kind("protocol"));
  const quotes = await loadOkxQuotes(
    {
      async get(_path, { instType }) {
        assert.equal(instType, "SPOT");
        return [fixture, { ...fixture, last: "99", ts: String(opened - 1) }];
      }
    },
    "spot"
  );
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].lastPrice, 105);
});

const bar = (time, confirmed = "1") => [
  String(time),
  "3",
  "6",
  "1",
  "5",
  "9",
  "11",
  "15",
  confirmed
];

test("candle units, prices and confirmation are validated against the native layout", () => {
  const row = bar(opened, "0");
  assert.deepEqual(normaliseOkxCandle(row, "spot"), {
    timestamp: opened,
    open: 3,
    high: 6,
    low: 1,
    close: 5,
    baseVolume: 9,
    quoteTurnover: 15,
    confirmed: false
  });
  assert.equal(normaliseOkxCandle(row, "linear").baseVolume, 11);
  assert.equal(normaliseOkxCandle(bar(opened), "linear").confirmed, true);
  for (const [index, value] of [
    [0, ""],
    [1, "0"],
    [2, "4"],
    [3, "4"],
    [5, "-1"],
    [7, "-1"],
    [8, "true"]
  ]) {
    const invalid = row.slice();
    invalid[index] = value;
    assert.throws(() => normaliseOkxCandle(invalid, "spot"), kind("protocol"));
  }
});

test("OKX history walks exclusive backward cursors in UTC, including the requested end", async () => {
  const calls = [];
  const pages = [
    [bar(opened, "0"), bar(opened - day)],
    [bar(opened - 3 * day), bar(opened - 2 * day)]
  ];
  const candles = await loadOkxHistory(
    {
      async get(path, params) {
        assert.equal(path, "/api/v5/market/history-candles");
        calls.push(params);
        return pages.shift();
      }
    },
    okxInstrumentRef("spot", "BTC-USD"),
    "1d",
    { from: opened - 2 * day, to: opened }
  );
  assert.deepEqual(calls, [
    { instId: "BTC-USD", bar: "1Dutc", after: String(opened + 1), limit: "300" },
    { instId: "BTC-USD", bar: "1Dutc", after: String(opened - day), limit: "300" }
  ]);
  assert.deepEqual(
    candles.map(({ timestamp }) => timestamp),
    [opened - 2 * day, opened - day, opened]
  );
  assert.equal(candles.at(-1).confirmed, false);
  assert.equal(okxNativeInterval("4h"), "4H");
  assert.equal(okxNativeInterval("6h"), "6Hutc");
  assert.equal(okxNativeInterval("12h"), "12Hutc");
  assert.equal(okxNativeInterval("1w"), "1Wutc");
  assert.equal(okxNativeInterval("1M"), "1Mutc");
  assert.throws(() => okxNativeInterval("10m"), RangeError);
});

test("history rejects repeated pages and exhausted budgets and distinguishes listing boundary", async () => {
  const ref = okxInstrumentRef("spot", "BTC-USD");
  const range = { from: opened - 5 * day, to: opened };
  const repeated = {
    async get() {
      return [bar(opened)];
    }
  };
  await assert.rejects(loadOkxHistory(repeated, ref, "1d", range), kind("pagination"));
  await assert.rejects(
    loadOkxHistory(repeated, ref, "1d", { ...range, maxPages: 1 }),
    kind("pagination")
  );
  let calls = 0;
  const history = await loadOkxHistory(
    {
      async get() {
        return calls++ ? [] : [bar(opened)];
      }
    },
    ref,
    "1d",
    range
  );
  assert.deepEqual(
    history.map(({ timestamp }) => timestamp),
    [opened]
  );
  assert.equal(calls, 2);
});
