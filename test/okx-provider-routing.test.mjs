import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const start = 1_699_999_980_000;
const until = start + 60_000;

function market(base, quote = "USDT", linear = false) {
  return {
    symbol: `${base}${quote}`,
    baseCoin: base,
    quoteCoin: quote,
    status: "Trading",
    symbolType: linear ? "innovation" : "",
    ...(linear ? { settleCoin: "USDT", contractType: "LinearPerpetual" } : {})
  };
}

function okxMarket(base, quote = "USDT", linear = false) {
  const pair = `${base}-${quote}`;
  return {
    instId: linear ? `${pair}-SWAP` : pair,
    instType: linear ? "SWAP" : "SPOT",
    instCategory: "1",
    state: "live",
    baseCcy: base,
    quoteCcy: quote,
    ctType: "linear",
    settleCcy: "USDT",
    instFamily: pair,
    uly: pair,
    tickSz: "0.0001",
    listTime: String(start)
  };
}

function fixture({ saved = [], holdOkxCatalog, nextBybitPage, serveOkxTickers } = {}) {
  const requests = [],
    writes = [],
    notices = [],
    reconnects = [],
    candles = [],
    streams = [];
  const bybitCatalog = { spot: [market("BTC")], linear: [market("GLM", "USDT", true)] };
  const okxCatalog = {
    SPOT: [okxMarket("BTC"), okxMarket("BTC", "USD"), okxMarket("GLM")],
    SWAP: [okxMarket("GLM", "USDT", true), okxMarket("BTC", "USDT", true)]
  };
  const fault = {};
  const recent = async (path, params, signal) => {
    signal?.throwIfAborted();
    requests.push({ provider: "okx", path, params });
    if (path.endsWith("/instruments")) {
      if (holdOkxCatalog) await holdOkxCatalog();
      if (fault.okx) throw new Error(fault.okx);
      return okxCatalog[params.instType];
    }
    if (path.endsWith("/tickers")) {
      if (serveOkxTickers) return serveOkxTickers(params.instType);
      return okxCatalog[params.instType].map(({ instId, instType }) => ({
        instId,
        instType,
        ts: String(start),
        last: "110",
        open24h: "100"
      }));
    }
    assert.equal(path, "/api/v5/market/history-candles");
    return Number(params.after) > start
      ? [[String(start), "100", "110", "99", "106", "2", "2", "211", "1"]]
      : [];
  };
  const bybit = async (path, params, signal) => {
    signal?.throwIfAborted();
    requests.push({ provider: "bybit", path, params });
    if (path.endsWith("instruments-info")) {
      if (fault.bybit) throw new Error(fault.bybit);
      const list = params.cursor ? nextBybitPage : bybitCatalog[params.category];
      const nextPageCursor =
        params.category === "linear" && !params.cursor && nextBybitPage ? "continue" : "";
      return { time: start, result: { category: params.category, list, nextPageCursor } };
    }
    assert.ok(path.endsWith("tickers"));
    return { time: start, result: { category: params.category, list: [] } };
  };
  const cache = {
    loadWatchlist: async () => structuredClone(saved),
    loadMarket: async () => undefined,
    saveWatchlistSnapshot: async (_owner, rows) => writes.push({ rows: structuredClone(rows) }),
    saveMarket: async () => {},
    loadHistory: async (_owner, uid) => {
      requests.push({ cache: uid });
      return [];
    },
    loadCoverage: async () => [],
    saveHistory: async (_owner, uid, timeframe, bars, coverage) =>
      writes.push({ uid, timeframe, bars, coverage })
  };
  const createStream = (provider, category, options) => {
    const stream = {
      provider,
      category,
      options,
      setSubscriptions(value) {
        this.subscriptions = value;
      },
      start() {},
      dispose() {
        this.disposed = true;
      }
    };
    streams.push(stream);
    return stream;
  };
  const load = sourceLoader();
  const { MarketClient } = load("services/market-client.ts");
  const { okxCatalogInstrument, publicMarketRow } = load("services/market-public-mapping.ts");
  const { normaliseOkxInstrument } = load("services/providers/okx/catalog.ts");
  const client = new MarketClient(null, "profile", cache, {
    http: { get: bybit },
    online: () => true,
    stream: (category, options) => createStream("bybit", category, options),
    okx: { http: { get: recent }, stream: (options) => createStream("okx", null, options) }
  });
  client.addEventListener("notice", (event) => notices.push(event.detail));
  client.addEventListener("market-reconnect", (event) => reconnects.push(event.detail));
  client.addEventListener("candle", (event) => candles.push(event.detail));
  return {
    client,
    requests,
    writes,
    notices,
    reconnects,
    candles,
    streams,
    bybitCatalog,
    okxCatalog,
    fault,
    row: (base) =>
      publicMarketRow(okxCatalogInstrument(normaliseOkxInstrument("spot", okxMarket(base))))
  };
}

test("compares the exact market across complete catalogs and keeps distinct OKX quote currencies", async () => {
  const f = fixture();
  await f.client.start();
  try {
    const found = await f.client.searchInstruments("BTC", "crypto");
    assert.deepEqual(
      found.map((item) => item.uid),
      ["bybit:spot:BTCUSDT", "okx:spot:BTC-USD", "okx:linear:BTC-USDT-SWAP"]
    );
    assert.equal(found.find((item) => item.uid === "okx:spot:BTC-USD").currency, "USD");
    assert.deepEqual(
      (await f.client.searchInstruments("GLM-USDT", "crypto")).map((r) => r.uid),
      ["bybit:linear:GLMUSDT", "okx:spot:GLM-USDT"]
    );
  } finally {
    await f.client.close();
  }
});

test("does not offer OKX when its exact Bybit market lies beyond the search limit", async () => {
  const f = fixture();
  const inactive = Array.from({ length: 300 }, (_, index) => ({
    ...market(`ZZZ${String(index).padStart(3, "0")}`),
    status: "Settled"
  }));
  f.bybitCatalog.spot.push(...inactive, market("ZZZZ"));
  f.okxCatalog.SPOT.push(okxMarket("ZZZZ"));
  try {
    assert.deepEqual(await f.client.searchInstruments("ZZZ", "crypto"), []);
    assert.equal(
      (await f.client.searchInstruments("ZZZZUSDT", "crypto"))[0]?.uid,
      "bybit:spot:ZZZZUSDT"
    );
  } finally {
    await f.client.close();
  }
});

test("never establishes OKX fallback from missing Bybit categories or failed Bybit requests", async () => {
  for (const problem of ["Bybit HTTP 403", "Bybit HTTP 429", null]) {
    const f = fixture();
    if (problem) f.fault.bybit = problem;
    else f.bybitCatalog.linear = [];
    try {
      await assert.rejects(
        f.client.searchInstruments("GLM", "crypto"),
        problem ? { message: problem } : /Полный каталог Bybit/
      );
      assert.ok(!f.requests.some((request) => request.provider === "okx"));
    } finally {
      await f.client.close();
    }
  }
});

test("does not request OKX if a Bybit cursor page is empty or only repeats known markets", async () => {
  for (const nextBybitPage of [[], [market("GLM", "USDT", true)]]) {
    const f = fixture({ nextBybitPage });
    try {
      await assert.rejects(f.client.searchInstruments("GLM", "crypto"), { kind: "pagination" });
      assert.ok(f.requests.some((request) => request.params?.cursor === "continue"));
      assert.ok(!f.requests.some((request) => request.provider === "okx"));
    } finally {
      await f.client.close();
    }
  }
});

test("cancelling an OKX catalog search keeps the shared request usable by another search", async () => {
  let entered, release;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({
    holdOkxCatalog: () => {
      entered();
      return gate;
    }
  });
  try {
    const abort = new AbortController();
    const cancelled = f.client.searchInstruments("GLM", "crypto", abort.signal);
    const rejected = assert.rejects(cancelled, { name: "AbortError" });
    await ready;
    const remaining = f.client.searchInstruments("GLM", "crypto");
    abort.abort();
    await rejected;
    release();
    assert.ok((await remaining).some((instrument) => instrument.uid === "okx:spot:GLM-USDT"));
    assert.equal(
      f.requests.filter((request) => request.path === "/api/v5/public/instruments").length,
      2
    );
  } finally {
    await f.client.close();
  }
});

test("keeps a newer OKX stream price when REST arrives late and accepts a fresher REST price", async () => {
  const ticker = (timestamp, price) => [
    {
      instType: "SPOT",
      instId: "GLM-USDT",
      ts: String(timestamp),
      last: price,
      open24h: "100"
    }
  ];
  let reply;
  const old = new Promise((resolve) => {
    reply = resolve;
  });
  let requests = 0;
  const f = fixture({
    serveOkxTickers: () => (++requests === 1 ? old : ticker(start + 2_000, "150"))
  });
  await f.client.start();
  try {
    const row = f.row("GLM");
    f.client.rows = [row];
    let changes = 0;
    f.client.addEventListener("state", () => {
      changes++;
    });
    const pending = f.client.publicMarket.snapshot();
    assert.equal(requests, 1);
    const stream = f.streams.find((item) => item.provider === "okx");
    stream.options.onQuote({
      ref: row.providerRef,
      seriesId: row.uid,
      timestamp: start + 1_000,
      lastPrice: 140,
      previousPrice24h: 100,
      changePercent24h: 40
    });
    reply(ticker(start, "110"));
    await pending;
    assert.equal(row.price, 140);
    assert.equal(row.time, new Date(start + 1_000).toISOString());
    assert.equal(changes, 1);

    await f.client.publicMarket.snapshot();
    assert.equal(row.price, 150);
    assert.equal(row.time, new Date(start + 2_000).toISOString());
    assert.equal(changes, 2);
  } finally {
    await f.client.close();
  }
});

test("keeps found Bybit pairs and reports an OKX catalog failure", async () => {
  const f = fixture();
  f.fault.okx = "OKX HTTP 429";
  try {
    assert.deepEqual(
      (await f.client.searchInstruments("BTC", "crypto")).map((r) => r.uid),
      ["bybit:spot:BTCUSDT"]
    );
    assert.deepEqual(f.notices, ["OKX HTTP 429"]);
    await assert.rejects(f.client.searchInstruments("DOGE", "crypto"), { message: f.fault.okx });
  } finally {
    await f.client.close();
  }
});

test("rechecks an OKX fallback immediately before adding, and leaves saved OKX on its own source", async () => {
  const f = fixture();
  await f.client.start();
  try {
    const found = await f.client.searchInstruments("GLM", "crypto");
    const fallback = found.find((r) => r.uid === "okx:spot:GLM-USDT");
    f.bybitCatalog.spot.push(market("GLM"));
    await assert.rejects(f.client.addInstrument(fallback), /пара появилась на Bybit/);
    assert.equal(f.client.rows.length, 0);

    f.client.rows = [f.row("GLM")];
    f.fault.bybit = "Bybit HTTP 403";
    const history = await f.client.candles("okx:spot:GLM-USDT", "1m", { from: start, to: until });
    assert.match(history.source, /OKX/);
    assert.deepEqual(
      history.candles.map((candle) => candle.timestamp),
      [start]
    );
    assert.ok(f.requests.some((request) => request.cache === "okx:spot:GLM-USDT"));
    assert.ok(f.writes.some((write) => write.uid === "okx:spot:GLM-USDT"));
    assert.ok(
      !f.requests.some((request) => request.provider === "bybit" && request.path.endsWith("kline"))
    );
  } finally {
    await f.client.close();
  }
});

test("keeps mixed exchanges subscribed and delivers only selected OKX candles and scoped reconnects", async () => {
  const f = fixture();
  await f.client.start();
  try {
    const [bybit] = await f.client.searchInstruments("BTCUSDT", "crypto");
    const okx = (await f.client.searchInstruments("GLM", "crypto")).find(
      (r) => r.uid === "okx:spot:GLM-USDT"
    );
    await f.client.addInstrument(bybit);
    const row = await f.client.addInstrument(okx);
    f.client.subscribeCandles(row.uid, "1m");
    const okxStream = f.streams.find((stream) => stream.provider === "okx");
    const bybitStream = f.streams.find((stream) => stream.provider === "bybit");
    assert.deepEqual(okxStream.subscriptions.tickers, [row.providerRef]);
    assert.deepEqual(okxStream.subscriptions.candle, { ref: row.providerRef, timeframe: "1m" });
    assert.deepEqual(bybitStream.subscriptions, { tickers: ["BTCUSDT"], candles: [] });
    const tick = {
      timestamp: start,
      open: 100,
      high: 110,
      low: 99,
      close: 102,
      baseVolume: 17,
      quoteTurnover: 1017,
      confirmed: true
    };
    okxStream.options.onCandles(row.providerRef, "5m", [tick]);
    okxStream.options.onCandles(row.providerRef, "1m", [tick]);
    assert.deepEqual(
      f.candles.map(({ uid, bar }) => [uid, bar.volume]),
      [[row.uid, 17]]
    );
    okxStream.options.onReconnect();
    assert.deepEqual(f.reconnects, [{ provider: "okx", category: "spot" }]);
    f.client.subscribeCandles(bybit.uid, "1m");
    okxStream.options.onReconnect();
    assert.equal(okxStream.subscriptions.candle, null);
    assert.equal(f.reconnects.length, 1);
    bybitStream.options.onState("open");
    bybitStream.options.onState("open");
    assert.deepEqual(f.reconnects.at(-1), { provider: "bybit", category: "spot" });
    assert.equal(bybitStream.subscriptions.candles.length, 1);
    await f.client.flush();
    assert.ok(f.writes.some((write) => write.uid === row.uid && write.bars[0].volume === 17));
  } finally {
    await f.client.close();
  }
  assert.ok(f.streams.every((stream) => stream.disposed));
});
