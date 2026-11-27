import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
const start = 1_700_000_000_000;
const instrument = (symbol, base, symbolType = "", extra = {}) => ({
  symbol,
  baseCoin: base,
  quoteCoin: "USDT",
  status: "Trading",
  symbolType,
  priceFilter: { tickSize: "0.000000000001" },
  ...extra
});
function fixture({ token = null, holdCatalog, holdHistory, holdHistoryWrite } = {}) {
  const calls = [],
    writes = [],
    streams = [],
    stored = new Map();
  const bankRow = {
    symbol: "SBER",
    uid: "bank-uid",
    ticker: "SBER",
    name: "Sber",
    currency: "RUB",
    color: "#ffffff",
    mark: "S",
    figi: null,
    step: 0.01,
    price: 300,
    previousClose: 299,
    availability: "available"
  };
  const cache = {
    loadWatchlist: async (owner) => stored.get(owner),
    loadMarket: async () => undefined,
    saveWatchlist: async () => {},
    saveWatchlistSnapshot: async (owner, rows) => {
      stored.set(owner, structuredClone(rows));
      writes.push({ owner, rows: structuredClone(rows) });
    },
    saveMarket: async (owner, data) => writes.push({ owner, ...structuredClone(data) }),
    loadCatalog: async () => undefined,
    saveCatalog: async () => {},
    loadHistory: async () => [],
    loadCoverage: async () => [],
    saveHistory: async (...args) => {
      if (holdHistoryWrite) await holdHistoryWrite();
      writes.push({ history: args });
    }
  };
  const bank = new (class extends EventTarget {
    rows = [bankRow];
    authenticated = true;
    cachePaused = false;
    async start() {
      this.rows = (await this.cache.loadWatchlist("bank-owner")) ?? [bankRow];
      return this.snapshot();
    }
    snapshot() {
      return { status: "connected", rows: this.rows, error: null };
    }
    async searchInstruments() {
      return [{ uid: "bank-uid", ticker: "SBER", name: "Sber" }];
    }
    async candles(...args) {
      calls.push({ bankCandles: args });
      return { candles: [], source: "bank" };
    }
    request(...args) {
      calls.push({ bankRequest: args });
      return Promise.resolve({});
    }
    subscribeCandles(...args) {
      calls.push({ bankSubscribe: args });
    }
    unsubscribeCandles() {
      calls.push({ bankUnsubscribe: true });
    }
    async flush() {}
    async close() {}
  })();
  const load = sourceLoader({
    "services/tbank-client.ts": {
      TBankClient: class {
        constructor() {
          assert.fail("unexpected bank transport");
        }
      }
    },
    "services/profile-key.ts": { profileKey: async () => "bank-owner" }
  });
  const http = {
    async get(path, params, signal) {
      signal?.throwIfAborted();
      calls.push({ path, params });
      if (path.endsWith("instruments-info")) {
        if (holdCatalog) await holdCatalog(signal);
        const list =
          params.category === "spot"
            ? [instrument("BTCUSDT", "BTC"), instrument("AAPLXUSDT", "AAPLX", "xstocks")]
            : [
                instrument("BTCUSDT", "BTC", "", {
                  fullName: "Bitcoin",
                  contractType: "LinearPerpetual",
                  settleCoin: "USDT"
                }),
                instrument("AAPLUSDT", "AAPL", "stock", {
                  contractType: "LinearPerpetual",
                  settleCoin: "USDT"
                })
              ];
        return { time: start, result: { category: params.category, list } };
      }
      if (path.endsWith("tickers"))
        return {
          time: start,
          result: {
            category: params.category,
            list: [
              { symbol: "BTCUSDT", lastPrice: "110", prevPrice24h: "100", price24hPcnt: "0.1" }
            ]
          }
        };
      if (path.endsWith("kline")) {
        if (holdHistory) await holdHistory(signal, params);
        return {
          time: start,
          result: {
            category: params.category,
            symbol: params.symbol,
            list:
              Number(params.end) >= start
                ? [[String(start), "100", "112", "99", "110", "2", "210"]]
                : []
          }
        };
      }
      assert.fail(path);
    }
  };
  const { MarketClient } = load("services/market-client.ts");
  const client = new MarketClient(token, "profile", cache, {
    owner: "device",
    http,
    okx: {
      http: {
        get: async (path, params) => {
          assert.equal(path, "/api/v5/public/instruments");
          return [
            {
              instType: params.instType,
              instId: params.instType === "SPOT" ? "ETH-USDT" : "ETH-USDT-SWAP",
              state: "live",
              instCategory: "1",
              baseCcy: "ETH",
              quoteCcy: "USDT",
              instFamily: "ETH-USDT",
              uly: "ETH-USDT",
              settleCcy: "USDT",
              ctType: "linear"
            }
          ];
        }
      }
    },
    online: () => true,
    bankFactory: (_token, _name, view) => {
      bank.cache = view;
      return bank;
    },
    stream: (category, options) => {
      const stream = {
        category,
        options,
        setSubscriptions(value) {
          this.subscriptions = value;
        },
        start() {
          this.started = true;
        },
        dispose() {
          this.disposed = true;
        }
      };
      streams.push(stream);
      return stream;
    }
  });
  return { client, cache, calls, writes, streams, stored, bank, bankRow, load };
}

test("anonymous crypto search/add/history uses public provider identity and never claims bank login", async () => {
  const f = fixture();
  await f.client.start();
  try {
    assert.equal(f.client.snapshot().marketReady, true);
    assert.equal(f.client.authenticated, false);
    assert.equal(f.client.snapshot().status, "offline");
    const found = await f.client.searchInstruments("Bitcoin", "crypto");
    assert.equal(found.length, 2);
    assert.deepEqual(found.map((x) => x.uid).sort(), [
      "bybit:linear:BTCUSDT",
      "bybit:spot:BTCUSDT"
    ]);
    const spot = await f.client.addInstrument(found.find((x) => x.providerRef.category === "spot"));
    const perp = await f.client.addInstrument(
      found.find((x) => x.providerRef.category === "linear")
    );
    assert.equal(spot.symbol, spot.uid);
    assert.notEqual(spot.symbol, perp.symbol);
    assert.equal(spot.ticker, "BTCUSDT");
    assert.equal(spot.step, 1e-12);
    const result = await f.client.candles(
      spot.symbol,
      "1m",
      { from: start, to: start + 60_000 },
      { uid: spot.uid }
    );
    assert.equal(result.candles.length, 1);
    assert.equal(result.candles[0].timestamp, start);
    assert.ok(
      f.calls.some(
        (call) =>
          call.path?.endsWith("kline") &&
          call.params.category === "spot" &&
          call.params.symbol === "BTCUSDT"
      )
    );
    assert.ok(!f.calls.some((call) => call.bankRequest || call.bankCandles));
    const stream = f.streams.find((x) => x.category === "spot");
    stream.options.onEvent({
      kind: "quote",
      quote: {
        seriesId: spot.uid,
        lastPrice: 120,
        previousPrice24h: 100,
        changePercent24h: 20,
        timestamp: start
      }
    });
    assert.equal(spot.price, 120);
    assert.equal(spot.previousClose, null);
    assert.equal(spot.comparisonBasis, "rolling-24h");
    await assert.rejects(
      f.client.candles(spot.symbol, "2m", { from: start, to: start + 60_000 }, { uid: spot.uid }),
      /Unsupported/
    );
    assert.equal((await f.client.searchInstruments("AAPL", "crypto")).length, 0);
    assert.equal((await f.client.searchInstruments("AAPL", "future"))[0].assetClass, "stock");
    assert.equal(
      (await f.client.searchInstruments("AAPL", "tokenized-stock"))[0].assetClass,
      "tokenized-stock"
    );
  } finally {
    await f.client.close();
  }
  assert.ok(f.streams.every((x) => x.disposed));
});

test("mixed watchlist keeps order; bank cache and requests receive only bank identities", async () => {
  const f = fixture({ token: "test-token" });
  await f.client.prepareOwner();
  f.stored.set("device", [f.bankRow]);
  await f.client.start();
  try {
    const instrument = (await f.client.searchInstruments("BTC", "crypto"))[0];
    const publicRow = await f.client.addInstrument(instrument);
    assert.deepEqual(
      f.client.rows.map((x) => x.uid),
      ["bank-uid", publicRow.uid]
    );
    assert.deepEqual(
      (await f.bank.cache.loadWatchlist("bank-owner")).map((x) => x.uid),
      ["bank-uid"]
    );
    await f.bank.cache.saveWatchlistSnapshot("bank-owner", []);
    assert.equal(f.stored.get("device").length, 2);
    assert.equal(f.stored.has("bank-owner"), false);
    await f.client.candles("SBER", "1m", { from: start, to: start + 60_000 }, { uid: "bank-uid" });
    assert.ok(f.calls.some((x) => x.bankCandles));
    const deselects = f.calls.filter((x) => x.bankUnsubscribe).length;
    await f.client.loadCandles(
      publicRow.symbol,
      "1m",
      { from: start, to: start + 60_000 },
      { uid: publicRow.uid }
    );
    assert.equal(f.calls.filter((x) => x.bankUnsubscribe).length, deselects);
    assert.throws(
      () => f.client.request("MarketDataService", "GetCandles", { instrumentId: publicRow.uid }),
      /Bybit/
    );
    assert.equal(f.calls.filter((x) => x.bankRequest).length, 0);
    assert.throws(
      () =>
        f.client.request("MarketDataService", "GetCandles", { instrument: publicRow.providerRef }),
      /Bybit/
    );
  } finally {
    await f.client.close();
  }
});

test("cancelled catalog caller does not poison a concurrent search; close cancels pending history before persistence", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ holdCatalog: () => gate });
  await f.client.start();
  const abort = new AbortController();
  const first = f.client.searchInstruments("BTC", "crypto", abort.signal);
  const second = f.client.searchInstruments("BTC", "crypto");
  abort.abort();
  await assert.rejects(first, { name: "AbortError" });
  release();
  assert.equal((await second).length, 2);
  await f.client.close();
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const g = fixture({
    holdHistory: (signal) =>
      new Promise((_resolve, reject) => {
        entered();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
  });
  await g.client.start();
  const row = await g.client.addInstrument((await g.client.searchInstruments("BTC", "crypto"))[0]);
  const history = g.client.candles(
    row.symbol,
    "1m",
    { from: start, to: start + 60_000 },
    { uid: row.uid }
  );
  const rejected = assert.rejects(history, { name: "AbortError" });
  await ready;
  await g.client.close();
  await rejected;
  assert.equal(g.writes.filter((x) => x.history).length, 0);
});

test("background candle history and reference-counted streams leave other charts live", async () => {
  let requested;
  const entered = new Promise((resolve) => {
    requested = resolve;
  });
  const f = fixture({
    holdHistory: (signal, params) =>
      params.category === "linear"
        ? new Promise((_resolve, reject) => {
            requested();
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          })
        : Promise.resolve()
  });
  await f.client.start();
  try {
    const instruments = await f.client.searchInstruments("BTCUSDT", "crypto");
    const spot = await f.client.addInstrument(
      instruments.find((item) => item.providerRef.category === "spot")
    );
    const linear = await f.client.addInstrument(
      instruments.find((item) => item.providerRef.category === "linear")
    );
    const spotStream = f.streams.find((item) => item.category === "spot");
    const linearStream = f.streams.find((item) => item.category === "linear");
    const range = { from: start, to: start + 60_000 };
    const update = (stream, row, interval, close) =>
      stream.options.onEvent({
        kind: "candles",
        ref: row.providerRef,
        interval,
        candles: [{ timestamp: start, open: 100, high: 115, low: 99, close, baseVolume: 2 }]
      });
    f.client.subscribeCandles(spot.uid, "1m");
    const spotEvents = [],
      linearEvents = [],
      peerEvents = [];
    const releaseSpot = f.client.watchCandles(spot.uid, "1m", ({ bar }) =>
      spotEvents.push(bar.close)
    );
    const stop = new AbortController();
    const releaseLinear = f.client.watchCandles(
      linear.uid,
      "5m",
      ({ bar }) => linearEvents.push(bar.close),
      stop.signal
    );
    const releasePeer = f.client.watchCandles(linear.uid, "5m", ({ bar }) =>
      peerEvents.push(bar.close)
    );
    const concurrent = f.client.loadCandles(linear.symbol, "5m", range, {
      uid: linear.uid,
      signal: stop.signal
    });
    const rejected = assert.rejects(concurrent, { name: "AbortError" });
    await entered;
    assert.deepEqual(spotStream.subscriptions.candles, [{ symbol: "BTCUSDT", interval: "1m" }]);
    assert.deepEqual(linearStream.subscriptions.candles, [{ symbol: "BTCUSDT", interval: "5m" }]);
    update(spotStream, spot, "1m", 101);
    update(linearStream, linear, "1m", 104);
    update(linearStream, linear, "5m", 106);
    stop.abort();
    await rejected;
    assert.equal(f.writes.filter((write) => write.history?.[4]).length, 0);
    update(linearStream, linear, "5m", 107);
    releasePeer();
    releaseLinear();
    update(linearStream, linear, "5m", 108);
    assert.deepEqual(linearStream.subscriptions.candles, []);
    releaseSpot();
    assert.deepEqual(spotStream.subscriptions.candles, [{ symbol: "BTCUSDT", interval: "1m" }]);
    assert.deepEqual(spotEvents, [101]);
    assert.deepEqual(linearEvents, [106]);
    assert.deepEqual(peerEvents, [106, 107]);
    assert.equal(
      (
        await f.client.loadCandles(spot.symbol, "5m", range, {
          uid: spot.uid
        })
      ).timeframe,
      "5m"
    );
    assert.deepEqual(spotStream.subscriptions.candles, [{ symbol: "BTCUSDT", interval: "1m" }]);
  } finally {
    await f.client.close();
  }
});

test("a history purge fences a delayed auxiliary response without releasing its live stream", async () => {
  let release, entered;
  const pending = new Promise((resolve) => (release = resolve));
  const serverStarted = new Promise((resolve) => (entered = resolve));
  // Return a response even after cancellation to test the fence beyond the network transport.
  const f = fixture({
    holdHistory: (signal) => {
      entered(signal);
      return pending;
    }
  });
  await f.client.start();
  try {
    const [instrument] = await f.client.searchInstruments("BTCUSDT", "crypto");
    const row = await f.client.addInstrument(instrument);
    const stream = f.streams.find((item) => item.category === row.providerRef.category);
    const live = [];
    f.client.watchCandles(row.uid, "1m", ({ bar }) => live.push(bar.close));
    const read = () =>
      f.client.loadCandles(row.symbol, "1m", { from: start, to: start + 60_000 }, { uid: row.uid });
    const rejected = assert.rejects(read(), { name: "AbortError" });
    const requestSignal = await serverStarted;
    f.client.cachePaused = true;
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(read(), { name: "AbortError" });
    await f.client.flush();
    f.client.cachePaused = false;
    release();
    await rejected;
    assert.equal(f.writes.filter((entry) => entry.history).length, 0);
    assert.deepEqual(stream.subscriptions.candles, [{ symbol: "BTCUSDT", interval: "1m" }]);
    stream.options.onEvent({
      kind: "candles",
      ref: row.providerRef,
      interval: "1m",
      candles: [{ timestamp: start, open: 100, high: 115, low: 99, close: 108, baseVolume: 2 }]
    });
    assert.deepEqual(live, [108]);
    assert.equal((await read()).candles.length, 1);
    assert.equal(f.writes.filter((entry) => entry.history).length, 1);
  } finally {
    release();
    await f.client.close();
  }
});

test("a history purge waits for writes accepted before it paused the cache", async () => {
  let release, entered;
  const pending = new Promise((resolve) => (release = resolve));
  const writeStarted = new Promise((resolve) => (entered = resolve));
  const f = fixture({
    holdHistoryWrite: () => {
      entered();
      return pending;
    }
  });
  await f.client.start();
  try {
    const [instrument] = await f.client.searchInstruments("BTCUSDT", "crypto");
    const row = await f.client.addInstrument(instrument);
    const read = f.client.loadCandles(
      row.symbol,
      "1m",
      { from: start, to: start + 60_000 },
      { uid: row.uid }
    );
    const rejected = assert.rejects(read, { name: "AbortError" });
    await writeStarted;
    f.client.cachePaused = true;
    let flushed = false;
    const flushing = f.client.flush().then(() => {
      flushed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(flushed, false);
    release();
    await flushing;
    await rejected;
    assert.equal(f.writes.filter((entry) => entry.history).length, 1);
  } finally {
    release();
    await f.client.close();
  }
});
