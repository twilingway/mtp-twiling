import assert from "node:assert/strict";
import test from "node:test";
import { loadBybit } from "./helpers/bybit-loader.mjs";

const {
  BybitHttp,
  BybitError,
  instrumentRef,
  seriesId,
  loadCatalog,
  searchCatalog,
  normaliseInstrument,
  enrichSpotNames,
  loadHistory,
  loadQuotes,
  nativeInterval
} = loadBybit();
const { decimal } = loadBybit("types.ts");
const { normaliseCandle, bybitIntervalStart } = loadBybit("market.ts");
const now = 1_795_636_000_000;
const spot = (extra = {}) => ({
  symbol: "BTCUSDT",
  baseCoin: "BTC",
  quoteCoin: "USDT",
  status: "Trading",
  symbolType: "",
  priceFilter: { tickSize: "0.1" },
  ...extra
});
const linear = (extra = {}) =>
  spot({ contractType: "LinearPerpetual", settleCoin: "USDT", fullName: "Bitcoin", ...extra });
const response = (result, options = {}) =>
  new Response(JSON.stringify({ retCode: 0, result, time: now, ...options }));
const kind = (expected) => (error) => error instanceof BybitError && error.kind === expected;
function client(handler, options) {
  const calls = [];
  const http = new BybitHttp({
    fetch: async (input, init) => {
      const url = new URL(input);
      calls.push({ url, init });
      return handler(url, init, calls.length);
    },
    ...options
  });
  return { http, calls };
}

test("Bybit identity isolates native series and strict numbers never coerce missing values", () => {
  assert.equal(seriesId(instrumentRef("spot", "BTCUSDT")), "bybit:spot:BTCUSDT");
  assert.notEqual(
    seriesId(instrumentRef("linear", "BTCUSDT")),
    seriesId(instrumentRef("spot", "BTCUSDT"))
  );
  for (const symbol of ["btc", "BTC/USDT", "", "../BTC", "BTC:USDT"])
    assert.throws(() => instrumentRef("spot", symbol));
  assert.throws(() => seriesId({ provider: "tbank", category: "spot", symbol: "BTCUSDT" }));
  for (const value of [
    "",
    " ",
    "1e2",
    "0x10",
    "1 ",
    true,
    false,
    null,
    undefined,
    2,
    "NaN",
    "Infinity"
  ])
    assert.equal(decimal(value), null);
  assert.equal(decimal("0"), 0);
  assert.equal(decimal("-0.25"), -0.25);
});

test("public fetch is credential-free, bound to browser global and restricted to market GET", async () => {
  const previous = globalThis.fetch;
  let thisValue, initValue;
  try {
    globalThis.fetch = function (input, init) {
      thisValue = this;
      initValue = init;
      assert.equal(new URL(input).hostname, "api.bybit.com");
      return Promise.resolve(response({}));
    };
    const http = new BybitHttp();
    await http.get("/v5/market/tickers", { category: "spot" });
    assert.equal(thisValue, globalThis);
    assert.equal(initValue.credentials, "omit");
    assert.equal(initValue.method, "GET");
    assert.equal(initValue.headers, undefined);
    await assert.rejects(http.get("/v5/order/create", {}), kind("protocol"));
  } finally {
    globalThis.fetch = previous;
  }
});

test("403, 429, API, malformed and network errors are distinct from missing instruments", async () => {
  for (const [status, expected] of [
    [403, "forbidden"],
    [429, "rate-limit"],
    [502, "http"]
  ]) {
    const { http } = client(() => new Response("{}", { status, headers: { "retry-after": "7" } }));
    await assert.rejects(
      http.get("/v5/market/tickers", {}),
      (error) => kind(expected)(error) && error.retryAfter === "7"
    );
  }
  for (const [result, expected] of [
    [response({}, { retCode: 10006 }), "rate-limit"],
    [response({}, { retCode: 10001 }), "api"],
    [new Response("bad"), "protocol"],
    [response({}, { time: "" }), "protocol"]
  ]) {
    const { http } = client(() => result);
    await assert.rejects(http.get("/v5/market/tickers", {}), kind(expected));
  }
  const { http } = client(() => {
    throw new Error("offline");
  });
  await assert.rejects(http.get("/v5/market/tickers", {}), kind("network"));
});

test("HTTP abort and bounded timeout cancel transport, including abort during body read", async () => {
  const pending = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
    );
  const { http } = client(pending);
  const controller = new AbortController();
  const request = http.get("/v5/market/tickers", {}, controller.signal);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  const timeout = client(pending, { timeoutMs: 2 });
  await assert.rejects(timeout.http.get("/v5/market/tickers", {}), kind("timeout"));
  const bodyAbort = new AbortController();
  const bodyClient = client(() => ({
    ok: true,
    status: 200,
    json: async () => {
      bodyAbort.abort();
      return { retCode: 0, result: {}, time: now };
    }
  }));
  await assert.rejects(bodyClient.http.get("/v5/market/tickers", {}, bodyAbort.signal), {
    name: "AbortError"
  });
  assert.throws(() => new BybitHttp({ timeoutMs: 60001 }));
});

test("catalog exhausts linear cursors, omits spot pagination and preserves TradFi metadata", async () => {
  const { http, calls } = client((url) => {
    const category = url.searchParams.get("category");
    if (category === "spot")
      return response({
        category,
        list: [
          spot(),
          spot({
            symbol: "AAPLXUSDT",
            baseCoin: "AAPLX",
            symbolType: "xstocks",
            xstockMultiplier: "1.003"
          })
        ]
      });
    if (!url.searchParams.get("cursor"))
      return response({ category, list: [linear()], nextPageCursor: "a+b=" });
    assert.equal(url.searchParams.get("cursor"), "a+b=");
    return response({
      category,
      list: [
        linear(),
        linear({
          symbol: "AAPLUSDT",
          baseCoin: "AAPL",
          fullName: "Apple",
          symbolType: "stock",
          marketRegion: "US",
          underlyingTicker: "AAPL"
        })
      ],
      nextPageCursor: ""
    });
  });
  const catalog = await loadCatalog(http);
  assert.equal(catalog.complete, true);
  assert.equal(catalog.observedAt, now);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.searchParams.has("limit"), false);
  assert.equal(calls[1].url.searchParams.get("limit"), "1000");
  const aapl = catalog.instruments.find((i) => i.ref.symbol === "AAPLUSDT");
  assert.equal(aapl.assetClass, "stock");
  assert.equal(aapl.cryptoEligible, false);
  assert.equal(aapl.underlyingTicker, "AAPL");
  assert.equal(
    catalog.instruments.find((i) => i.ref.symbol === "AAPLXUSDT").xstockMultiplier,
    1.003
  );
  assert.equal(searchCatalog(catalog, "bitCOIN").length, 2);
  assert.equal(searchCatalog(catalog, "BTC / USDT").length, 2);
  assert.equal(searchCatalog(catalog, "apple").length, 0);
  assert.equal(searchCatalog(catalog, "apple", { cryptoOnly: false }).length, 1);
  assert.equal(
    searchCatalog(catalog, "биток", { aliases: { "bybit:spot:BTCUSDT": ["биток"] } }).length,
    1
  );
});

test("catalog rejects cursor loops or later-page failure without returning partial completeness", async () => {
  for (const loop of [true, false]) {
    const { http } = client((url, _init, count) => {
      const category = url.searchParams.get("category");
      if (category === "spot") return response({ category, list: [] });
      if (count === 3 && !loop) return new Response("{}", { status: 403 });
      return response({ category, list: [linear()], nextPageCursor: "same" });
    });
    await assert.rejects(loadCatalog(http), kind(loop ? "pagination" : "forbidden"));
  }
  const controller = new AbortController();
  const { http, calls } = client((url) => {
    controller.abort();
    return response({ category: url.searchParams.get("category"), list: [] });
  });
  await assert.rejects(loadCatalog(http, controller.signal), { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("catalog rejects a cursor page with no new instruments", async () => {
  for (const page of [[], [linear()]]) {
    const { http, calls } = client((url) => {
      const category = url.searchParams.get("category");
      if (category === "spot") return response({ category, list: [spot()] });
      return url.searchParams.has("cursor")
        ? response({ category, list: page })
        : response({ category, list: [linear()], nextPageCursor: "continue" });
    });
    await assert.rejects(loadCatalog(http), kind("pagination"));
    assert.equal(calls.at(-1).url.searchParams.get("cursor"), "continue");
  }
});

test("crypto eligibility fails closed for foreign/unknown/inactive product classes", () => {
  for (const symbolType of [
    "stock",
    "ETF",
    "forex",
    "commodity",
    "xstocks",
    "mstocks",
    "new-unknown"
  ])
    for (const category of ["spot", "linear"])
      assert.equal(normaliseInstrument(category, linear({ symbolType })).cryptoEligible, false);
  assert.equal(
    normaliseInstrument("linear", linear({ contractType: "LinearFutures" })).cryptoEligible,
    false
  );
  assert.equal(normaliseInstrument("linear", linear({ settleCoin: "USDC" })).cryptoEligible, false);
  assert.equal(normaliseInstrument("spot", spot({ status: "PendingOpen" })).cryptoEligible, false);
  assert.equal(
    normaliseInstrument("linear", linear({ symbolType: "innovation" })).cryptoEligible,
    true
  );
  assert.throws(
    () => normaliseInstrument("spot", spot({ symbolType: undefined })),
    kind("protocol")
  );
});

test("spot full names require unambiguous exact base, never multiplier stripping", () => {
  const items = [
    normaliseInstrument("spot", spot()),
    normaliseInstrument("linear", linear()),
    normaliseInstrument(
      "linear",
      linear({ symbol: "BTCUSDC", quoteCoin: "USDC", fullName: "Other Bitcoin" })
    )
  ];
  assert.equal(enrichSpotNames(items)[0].fullName, null);
  const scaled = normaliseInstrument("spot", spot({ symbol: "1000BTCUSDT", baseCoin: "1000BTC" }));
  assert.equal(enrichSpotNames([scaled, items[1]])[0].fullName, null);
});

test("successful empty default catalog is distinct from errors and cross-category tags fail closed", async () => {
  const { http } = client((url) =>
    response({ category: url.searchParams.get("category"), list: [] })
  );
  const catalog = await loadCatalog(http);
  assert.equal(catalog.complete, true);
  assert.deepEqual(catalog.instruments, []);
  assert.equal(
    normaliseInstrument("linear", linear({ symbolType: "adventure" })).cryptoEligible,
    false
  );
  assert.equal(
    normaliseInstrument("spot", spot({ symbolType: "innovation" })).cryptoEligible,
    false
  );
});

test("history pages sort/dedupe UTC milliseconds with real gaps and explicit interval mapping", async () => {
  const row = (timestamp, close = "11") => [String(timestamp), "10", "12", "9", close, "0", "0"];
  const { http, calls } = client((url, _init, count) =>
    response({
      category: "spot",
      symbol: "BTCUSDT",
      list: count === 1 ? [row(5000), row(4000), row(4000, "12")] : [row(2000), row(1000)]
    })
  );
  const candles = await loadHistory(http, instrumentRef("spot", "BTCUSDT"), "1m", {
    from: 1000,
    to: 5000
  });
  assert.deepEqual(
    candles.map((i) => i.timestamp),
    [1000, 2000, 4000, 5000]
  );
  assert.equal(candles[2].close, 12);
  assert.equal(candles[0].confirmed, null);
  assert.equal(candles[0].baseVolume, 0);
  assert.equal(calls[1].url.searchParams.get("end"), "3999");
  assert.equal(nativeInterval("1M"), "M");
  assert.equal(nativeInterval("2h"), "120");
  for (const interval of ["2m", "10m", "toString", "45m"]) {
    await assert.rejects(
      loadHistory(http, instrumentRef("spot", "BTCUSDT"), interval, { from: 1000, to: 5000 }),
      /Unsupported/
    );
  }
  assert.equal(calls.length, 2);
  assert.throws(() => normaliseCandle(row(1000, "")), kind("protocol"));
  assert.throws(() => normaliseCandle(row(1000, "13")), kind("protocol"));
});

test("history aborts bad page boundaries and page budget rather than claiming full coverage", async () => {
  const { http } = client(() =>
    response({
      category: "linear",
      symbol: "BTCUSDT",
      list: [["4000", "1", "1", "1", "1", "0", "0"]]
    })
  );
  const ref = instrumentRef("linear", "BTCUSDT");
  await assert.rejects(
    loadHistory(http, ref, "1m", { from: 1000, to: 5000, maxPages: 1 }),
    kind("pagination")
  );
  await assert.rejects(loadHistory(http, ref, "1m", { from: 1000, to: 5000 }), kind("pagination"));
});

test("spot accepts only the containing start candle observed in live daily responses", async () => {
  const from = 1795469926764,
    to = 1795642726756;
  const timestamps = [1795564800000, 1795478400000, 1795392000000];
  const row = (timestamp) => [String(timestamp), "10", "12", "9", "11", "1", "10"];
  const { http, calls } = client(() =>
    response({ category: "spot", symbol: "BTCUSDT", list: timestamps.map(row) })
  );
  const candles = await loadHistory(http, instrumentRef("spot", "BTCUSDT"), "1d", { from, to });
  assert.deepEqual(
    candles.map((item) => item.timestamp),
    [...timestamps].reverse()
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("start"), String(from));
  assert.equal(bybitIntervalStart(from, "1d"), 1795392000000);
  for (const invalid of [1795392000000 - 86400000, 1795392000000 + 1, to + 1]) {
    const broken = client(() =>
      response({ category: "spot", symbol: "BTCUSDT", list: [row(invalid)] })
    );
    await assert.rejects(
      loadHistory(broken.http, instrumentRef("spot", "BTCUSDT"), "1d", { from, to }),
      kind("pagination")
    );
  }
});

test("containing intervals use UTC minute/hour/day, Monday weeks and calendar months", () => {
  const time = Date.UTC(2026, 1, 15, 13, 47, 3);
  for (const [interval, expected] of [
    ["1m", Date.UTC(2026, 1, 15, 13, 47)],
    ["3m", Date.UTC(2026, 1, 15, 13, 45)],
    ["5m", Date.UTC(2026, 1, 15, 13, 45)],
    ["15m", Date.UTC(2026, 1, 15, 13, 45)],
    ["30m", Date.UTC(2026, 1, 15, 13, 30)],
    ["1h", Date.UTC(2026, 1, 15, 13)],
    ["2h", Date.UTC(2026, 1, 15, 12)],
    ["4h", Date.UTC(2026, 1, 15, 12)],
    ["6h", Date.UTC(2026, 1, 15, 12)],
    ["12h", Date.UTC(2026, 1, 15, 12)],
    ["1d", Date.UTC(2026, 1, 15)],
    ["1w", Date.UTC(2026, 1, 9)],
    ["1M", Date.UTC(2026, 1, 1)]
  ])
    assert.equal(bybitIntervalStart(time, interval), expected, interval);
  assert.throws(() => bybitIntervalStart(time, "2m"), /Unsupported/);
  assert.throws(() => bybitIntervalStart(Number.MAX_SAFE_INTEGER, "1M"), /calendar/);
});

test("quotes expose rolling24h basis, native units and null empty prices, without bank close fields", async () => {
  const { http } = client(() =>
    response({
      category: "linear",
      list: [
        {
          symbol: "BTCUSDT",
          lastPrice: "100",
          markPrice: "",
          indexPrice: "99",
          prevPrice24h: "90",
          price24hPcnt: "0.1",
          volume24h: "2",
          turnover24h: "200"
        }
      ]
    })
  );
  const [quote] = await loadQuotes(http, "linear", "BTCUSDT");
  assert.equal(quote.comparisonBasis, "rolling-24h");
  assert.equal(quote.changePercent24h, 10);
  assert.equal(quote.markPrice, null);
  assert.equal(quote.baseVolume24h, 2);
  assert.equal(quote.quoteTurnover24h, 200);
  assert.equal("previousClose" in quote, false);
  assert.equal(quote.seriesId, "bybit:linear:BTCUSDT");
});
