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
function fixture({ token = null, holdCatalog, holdHistory } = {}) {
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
    saveHistory: async (...args) => writes.push({ history: args })
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
        if (holdHistory) await holdHistory(signal);
        signal?.throwIfAborted();
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
  f.stored.set("bank-owner", [f.bankRow]);
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
    assert.equal(f.stored.get("bank-owner").length, 2);
    await f.client.candles("SBER", "1m", { from: start, to: start + 60_000 }, { uid: "bank-uid" });
    assert.ok(f.calls.some((x) => x.bankCandles));
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
