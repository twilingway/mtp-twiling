import assert from "node:assert/strict";
import test from "node:test";
import { deferred, row, sourceModules } from "./helpers/watchlist-sections.mjs";

const vtb = { uid: "vtb-share", ticker: "VTBR", name: "ВТБ", kind: "share" };
const future = (uid, ticker) => ({ uid, ticker, name: "ВТБ фьючерс", kind: "future" });
const december = future("vtb-december", "VBZ6");
const march = future("vtb-march", "VBH7");
const settled = () => new Promise(setImmediate);

function hookFixture(t, request) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slots = [];
  let index = 0;
  let effects = [];
  let observer;
  const elements = [vtb, december, march].map((item) => ({
    dataset: { searchQuoteUid: item.uid }
  }));
  const root = { querySelectorAll: () => elements };
  const equal = (a, b) => a?.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: Observer
  });
  t.after(() => {
    if (previousObserver)
      Object.defineProperty(globalThis, "IntersectionObserver", previousObserver);
    else delete globalThis.IntersectionObserver;
  });
  const load = sourceModules({
    react: {
      useRef: () => {
        const i = index++;
        return (slots[i] ??= { current: root });
      },
      useMemo: (factory, deps) => {
        const i = index++;
        if (!equal(slots[i]?.deps, deps)) slots[i] = { deps, value: factory() };
        return slots[i].value;
      },
      useState: (initial) => {
        const i = index++;
        if (!(i in slots)) slots[i] = { value: initial };
        return [
          slots[i].value,
          (value) => {
            slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
          }
        ];
      },
      useEffect: (action, deps) => {
        const i = index++;
        if (!equal(slots[i]?.deps, deps))
          effects.push(() => {
            slots[i]?.cleanup?.();
            slots[i] = { deps, cleanup: action() };
          });
      }
    },
    "services/instrument-search-public-prices.ts": { loadPublicSearchPrices: async () => new Map() }
  });
  const { useInstrumentSearchPrices } = load("screens/terminal/use-instrument-search-prices.js");
  const client = { request };
  const rows = [{ ...row("VTBR", vtb.uid), price: 82.11 }];
  const items = [vtb, december, march];
  const render = (revision = 0, owner = "owner", results = items) => {
    index = 0;
    effects = [];
    const result = useInstrumentSearchPrices(client, owner, revision, results, rows);
    for (const effect of effects) effect();
    return result;
  };
  const visible = (...uids) =>
    observer.callback(
      elements.map((target) => ({
        target,
        isIntersecting: uids.includes(target.dataset.searchQuoteUid)
      }))
    );
  t.after(() => slots.forEach((slot) => slot?.cleanup?.()));
  return { render, visible, tick: () => t.mock.timers.tick(150) };
}

test("visible VTB futures fetch in one batch beside a priced watchlist VTBR and cache exact UIDs", async (t) => {
  const calls = [];
  const f = hookFixture(t, async (_service, _method, body) => {
    calls.push(body);
    return {
      lastPrices: [
        { instrumentUid: december.uid, price: { units: "83", nano: 125000000 } },
        { instrumentUid: "same-ticker-other-venue", price: { units: "999", nano: 0 } },
        { instrumentUid: march.uid, price: { units: "0", nano: 0 } }
      ]
    };
  });
  f.render();
  f.visible(vtb.uid, december.uid, march.uid);
  f.render();
  f.tick();
  await settled();
  assert.deepEqual(calls[0].instrumentId, [december.uid, march.uid]);
  assert.deepEqual([...f.render().prices], [[december.uid, 83.125]]);
  f.tick();
  assert.equal(calls.length, 1, "missing quotes and watchlist ticks do not cause a request loop");
  f.render(1);
  f.visible(december.uid, march.uid);
  f.render(1);
  f.tick();
  await settled();
  assert.equal(calls.length, 1, "query changes reuse only this session's exact identity cache");
  assert.equal(f.render(1, "other-owner").prices.size, 0);
});

test("offscreen results are not requested and rapid query changes abort stale completions", async (t) => {
  const first = deferred();
  const calls = [];
  const f = hookFixture(t, async (_service, _method, body, signal) => {
    calls.push({ body, signal });
    if (calls.length === 1) return first.promise;
    return { lastPrices: [{ instrumentUid: march.uid, price: { units: "84", nano: 0 } }] };
  });
  f.render();
  f.visible(december.uid);
  f.render();
  f.tick();
  assert.deepEqual(calls[0].body.instrumentId, [december.uid]);
  f.render(1, "owner", [march]);
  assert.equal(calls[0].signal.aborted, true);
  f.visible(march.uid);
  f.render(1, "owner", [march]);
  f.tick();
  await settled();
  first.resolve({
    lastPrices: [{ instrumentUid: december.uid, price: { units: "999", nano: 0 } }]
  });
  await settled();
  assert.deepEqual([...f.render(1, "owner", [march]).prices], [[march.uid, 84]]);
});

test("bank identities include futures, currency, index, and instrumentUid without ticker substitution", () => {
  const { bankSearchQuoteUid, instrumentSearchQuoteId } = sourceModules()(
    "services/instrument-search-prices.js"
  );
  for (const kind of ["share", "future", "currency", "index"])
    assert.equal(bankSearchQuoteUid({ ...december, kind }), december.uid);
  assert.equal(
    bankSearchQuoteUid({ ...march, uid: undefined, instrumentUid: march.uid }),
    march.uid
  );
  assert.equal(bankSearchQuoteUid({ ...march, uid: undefined }), undefined);
  assert.equal(
    instrumentSearchQuoteId({
      ...march,
      providerRef: { provider: "okx", category: "linear", symbol: "BTC-USDT-SWAP" }
    }),
    "okx:linear:BTC-USDT-SWAP"
  );
});

test("public result REST uses exact product identities without a bank key or catalogue request", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.hostname === "api.bybit.com") {
      const category = url.searchParams.get("category");
      const symbol = url.searchParams.get("symbol");
      return new Response(
        JSON.stringify({
          retCode: 0,
          time: 1790000000000,
          result: {
            category,
            list: [{ symbol, lastPrice: category === "spot" ? "0.12345" : "0.23456" }]
          }
        })
      );
    }
    assert.equal(url.pathname, "/api/v5/market/ticker");
    assert.equal(url.searchParams.get("instId"), "BTC-USDT");
    return new Response(
      JSON.stringify({
        code: "0",
        data: [
          {
            instType: "SPOT",
            instId: "BTC-USDT",
            last: "0.34567",
            ts: "1790000000000"
          }
        ]
      })
    );
  });
  const { loadInstrumentSearchPrices } = sourceModules()("services/instrument-search-prices.js");
  const prices = await loadInstrumentSearchPrices(
    {
      authenticated: false,
      request: () => assert.fail("anonymous public quotes never call the bank")
    },
    ["bybit:spot:BTCUSDT", "bybit:linear:BTCUSDT", "okx:spot:BTC-USDT", december.uid],
    new AbortController().signal
  );
  assert.deepEqual([...prices].sort(), [
    ["bybit:linear:BTCUSDT", 0.23456],
    ["bybit:spot:BTCUSDT", 0.12345],
    ["okx:spot:BTC-USDT", 0.34567]
  ]);
  assert.equal(calls.length, 3);
  for (const { url, options } of calls) {
    if (url.hostname === "api.bybit.com") assert.equal(url.pathname, "/v5/market/tickers");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
  }
});

test("public failures and missing bank quotes remain empty while another source succeeds", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 429 }));
  const { loadInstrumentSearchPrices } = sourceModules()("services/instrument-search-prices.js");
  const prices = await loadInstrumentSearchPrices(
    {
      request: async () => ({
        lastPrices: [
          {
            instrumentUid: december.uid,
            price: { units: "83", nano: 1000000 }
          }
        ]
      })
    },
    [december.uid, march.uid, "bybit:spot:BTCUSDT"],
    new AbortController().signal
  );
  assert.deepEqual([...prices], [[december.uid, 83.001]]);
});
