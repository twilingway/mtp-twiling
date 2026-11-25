import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const json = (value) => JSON.parse(JSON.stringify(value));
function sources(overrides = {}, globals = {}) {
  const cells = new Map();
  const context = vm.createContext({
    console,
    Date,
    Math,
    Promise,
    TextEncoder,
    TextDecoder,
    crypto,
    Blob,
    EventTarget,
    Event,
    CustomEvent,
    AbortController,
    AbortSignal,
    DOMException,
    navigator: { onLine: true },
    setTimeout,
    clearTimeout,
    ...globals
  });
  function load(relative) {
    let filename = path.resolve(root, relative).replace(/\.js$/, ".ts");
    if (!existsSync(filename)) filename += "x";
    const key = path.relative(root, filename).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cells.has(key)) return cells.get(key).exports;
    const module = { exports: {} };
    cells.set(key, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) =>
        Object.hasOwn(overrides, specifier)
          ? overrides[specifier]
          : load(path.relative(root, path.resolve(path.dirname(filename), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
const currency = (uid, ticker = "USD000UTSTOM", extra = {}) => ({
  uid,
  ticker,
  name: "Доллар США",
  classCode: "CETS",
  exchange: "moex_close",
  realExchange: "REAL_EXCHANGE_MOEX",
  currency: "rub",
  minPriceIncrement: { units: "0", nano: 2500000 },
  ...extra
});
const currencies = [
  currency("moex"),
  currency("dealer", "USD000UTSTOM", {
    classCode: "CNGDOTC",
    exchange: "dealer_fx_otc",
    realExchange: "REAL_EXCHANGE_DEALER"
  }),
  currency("ees", "USDRUB", { classCode: "EES_CETS" }),
  currency("eur", "EUR_RUB__TOM", { name: "Евро" })
];
const catalog = (extra = {}) => ({
  at: Date.now(),
  shares: [],
  futures: [],
  indicatives: [],
  ...extra
});

test("currency aliases find distinct real instruments without rewriting ticker or UID", async () => {
  const search = sources()("services/tbank-instruments.ts").searchCatalog;
  const input = catalog({ currencies });
  const before = JSON.stringify(input);
  for (const query of ["USDRUB_TOM", "USD/RUB", "usd rub", "доллар рубль", "долларрубль"]) {
    const rows = await search(input, query, "currency", () =>
      assert.fail("local alias must not request remote search")
    );
    assert.deepEqual(Array.from(rows, (row) => row.uid).sort(), ["dealer", "ees", "moex"]);
    assert.equal(rows.filter((row) => row.ticker === "USD000UTSTOM").length, 2);
    assert.ok(rows.every((row) => row.kind === "currency"));
  }
  const eur = await search(input, "EURRUB_TOM", "currency", () => assert.fail("local EUR alias"));
  assert.equal(eur[0].ticker, "EUR_RUB__TOM");
  assert.equal(eur[0].uid, "eur");
  assert.equal(JSON.stringify(input), before);
  const shares = await search(input, "USDRUB_TOM", "share", async () => []);
  assert.equal(shares.length, 0);
});

test("fallback classifies currency string and enum and keeps aliases in query only", async () => {
  const search = sources()("services/tbank-instruments.ts").searchCatalog;
  for (const extra of [
    { instrumentType: "currency" },
    { instrumentKind: "INSTRUMENT_TYPE_CURRENCY" }
  ]) {
    const calls = [];
    const rows = await search(undefined, "USDRUB_TOM", "currency", async (query) => {
      calls.push(query);
      return [currency("real", "USD000UTSTOM", extra)];
    });
    assert.deepEqual(calls, ["USD000UTSTOM"]);
    assert.equal(rows[0].kind, "currency");
    assert.equal(rows[0].ticker, "USD000UTSTOM");
    assert.equal(rows[0].uid, "real");
  }
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (
      await search(
        undefined,
        "USDRUB_TOM",
        "currency",
        () => assert.fail("already aborted"),
        abort.signal
      )
    ).length,
    0
  );
  const later = new AbortController();
  assert.equal(
    (
      await search(
        undefined,
        "USDRUB_TOM",
        "currency",
        async () => {
          later.abort();
          return [currency("stale", "USD000UTSTOM", { instrumentType: "currency" })];
        },
        later.signal
      )
    ).length,
    0
  );
});

test("normalization preserves legacy absence, currency enum and public source metadata", () => {
  const types = sources()("services/types.ts");
  assert.equal(Object.hasOwn(types.normaliseCatalog(catalog()), "currencies"), false);
  assert.deepEqual(json(types.normaliseCatalog(catalog({ currencies: [] })).currencies), []);
  const item = types.normaliseInstrument(
    currency("one", "USD000UTSTOM", {
      instrumentKind: "INSTRUMENT_TYPE_CURRENCY",
      kind: "currency"
    })
  );
  assert.equal(item.instrumentKind, "INSTRUMENT_TYPE_CURRENCY");
  assert.equal(item.kind, "currency");
  assert.equal(item.exchange, "moex_close");
  assert.equal(item.realExchange, "REAL_EXCHANGE_MOEX");
  const row = types.normaliseRows([
    {
      ...currency("one"),
      symbol: "USD000UTSTOM",
      type: "currency",
      price: null,
      previousClose: null
    }
  ])[0];
  assert.equal(row.type, "currency");
  assert.equal(row.classCode, "CETS");
  assert.equal(row.exchange, "moex_close");
});

test("fresh legacy cache upgrades just Currencies and current empty catalog is not repeatedly loaded", async () => {
  const { loadBankCatalog } = sources()("services/tbank-catalog.ts");
  let saved;
  const calls = [];
  const legacy = catalog({ shares: [{ uid: "stock", ticker: "SBER", name: "Sber" }] });
  const result = await loadBankCatalog(
    {
      loadCatalog: async () => legacy,
      saveCatalog: async (value) => {
        saved = value;
      }
    },
    async (service, method, body) => {
      calls.push({ service, method, body });
      return { instruments: currencies };
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "Currencies");
  assert.equal(calls[0].body.instrumentStatus, "INSTRUMENT_STATUS_ALL");
  assert.equal(result.at, legacy.at);
  assert.equal(result.shares[0].uid, "stock");
  assert.equal(saved.currencies.length, 4);
  const current = catalog({ currencies: [] });
  assert.equal(
    await loadBankCatalog(
      { loadCatalog: async () => current, saveCatalog: () => assert.fail("fresh") },
      () => assert.fail("fresh")
    ),
    current
  );
});

test("optional Currencies failure preserves fresh and stale caches while Shares remains required", async () => {
  const { loadBankCatalog } = sources()("services/tbank-catalog.ts");
  const legacy = catalog({ shares: [{ uid: "stock", ticker: "SBER", name: "Sber" }] });
  assert.equal(
    await loadBankCatalog(
      {
        loadCatalog: async () => legacy,
        saveCatalog: () => assert.fail("failed upgrade must not save")
      },
      async () => {
        throw new Error("currency offline");
      }
    ),
    legacy
  );
  let saved;
  const result = await loadBankCatalog(
    {
      loadCatalog: async () => catalog({ at: 0, currencies }),
      saveCatalog: async (value) => {
        saved = value;
      }
    },
    async (_service, method) => {
      if (method === "Currencies") throw new Error("currency offline");
      return { instruments: [{ uid: method, ticker: method, name: method }] };
    }
  );
  assert.equal(result.currencies[0].uid, "moex");
  assert.equal(saved.shares[0].uid, "Shares");
  const initial = await loadBankCatalog(
    { loadCatalog: async () => undefined, saveCatalog: async () => {} },
    async (_service, method) => {
      if (method === "Currencies") throw new Error("currency offline");
      return { instruments: [] };
    }
  );
  assert.equal(Object.hasOwn(initial, "currencies"), false);
  await assert.rejects(
    loadBankCatalog(
      { loadCatalog: async () => undefined, saveCatalog: async () => {} },
      async (_service, method) => {
        if (method === "Shares") throw new Error("shares required");
        return { instruments: [] };
      }
    ),
    /shares required/
  );
});

test("actual bank client remains authenticated when legacy catalog currency upgrade fails", async () => {
  const calls = [];
  class Transport {
    closed = false;
    constructor(_testToken, callbacks) {
      this.callbacks = callbacks;
    }
    async request(_service, method) {
      calls.push(method);
      if (method === "Currencies") throw new Error("currency offline");
      if (method === "GetLastPrices") return { lastPrices: [] };
      if (method === "GetClosePrices") return { closePrices: [] };
      assert.fail(method);
    }
    send() {}
    connect() {
      this.callbacks.open();
    }
    close() {
      this.closed = true;
    }
    serverNow() {
      return Date.now();
    }
  }
  const { TBankClient } = sources({
    "services/tbank-transport.ts": { BankTransport: Transport, BankError: Error }
  })("services/tbank-client.ts");
  const client = new TBankClient("unit-test-token", "Test", {
    loadMarket: async () => undefined,
    loadCatalog: async () => catalog(),
    saveCatalog: () => assert.fail("failed upgrade"),
    loadWatchlist: async () => [],
    saveWatchlist: async () => {},
    saveWatchlistSnapshot: async () => {},
    saveMarket: async () => {}
  });
  const result = await client.start();
  assert.equal(result.authenticated, true);
  assert.equal(result.error, null);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(calls, ["GetLastPrices", "Currencies"]);
  const moex = await client.addInstrument({ ...currencies[0], kind: "currency" });
  const dealer = await client.addInstrument({ ...currencies[1], kind: "currency" });
  assert.equal(client.rows.length, 2);
  for (const row of [moex, dealer]) {
    assert.equal(row.type, "currency");
    assert.equal(row.symbol, "USD000UTSTOM");
    assert.equal(row.ticker, "USD000UTSTOM");
  }
  assert.equal(moex.uid, "moex");
  assert.equal(dealer.uid, "dealer");
  assert.equal(moex.exchange, "moex_close");
  assert.equal(dealer.exchange, "dealer_fx_otc");
  await client.close();
  let restoredWatchlist;
  const restoredClient = new TBankClient("unit-test-token", "Test", {
    loadMarket: async () => undefined,
    loadCatalog: async () => catalog({ currencies }),
    loadWatchlist: async () => [{ ...moex, type: "index" }],
    saveWatchlist: async (_owner, rows) => {
      restoredWatchlist = json(rows);
    },
    saveMarket: async () => {}
  });
  await restoredClient.start();
  assert.equal(restoredWatchlist[0].type, "currency");
  assert.equal(restoredWatchlist[0].uid, "moex");
  assert.equal(restoredWatchlist[0].exchange, "moex_close");
  await restoredClient.close();
});

test("currency type and source survive actual storage, JSON and Drive with owner isolation", async () => {
  const records = new Map();
  const load = sources({
    "services/storage-db.ts": {
      get: async (store, id) => structuredClone(records.get(`${store}/${id}`)),
      put: async (store, item) => {
        records.set(`${store}/${item.id}`, structuredClone(item));
      },
      all: async (store) =>
        [...records.entries()]
          .filter(([key]) => key.startsWith(store + "/"))
          .map(([, item]) => structuredClone(item)),
      flush: async () => {},
      transaction: async (_stores, action) =>
        action({
          objectStore: (store) => ({
            put: (item) => {
              records.set(`${store}/${item.id}`, structuredClone(item));
            }
          })
        })
    }
  });
  const storage = load("services/storage.ts");
  const { sanitizeDriveBackup } = load("services/drive/backup.ts");
  const row = {
    ...currency("dealer", "USD000UTSTOM", {
      classCode: "CNGDOTC",
      realExchange: "REAL_EXCHANGE_DEALER",
      exchange: "dealer_fx_otc"
    }),
    symbol: "USD000UTSTOM",
    type: "currency",
    color: "#5476bc",
    mark: "U",
    figi: null,
    step: 0.01,
    price: null,
    previousClose: null,
    availability: "pending"
  };
  await storage.saveWatchlist("one", [row]);
  const backup = await storage.createBackup("one");
  const clean = sanitizeDriveBackup(backup);
  assert.equal(clean.watchlist[0].type, "currency");
  assert.equal(clean.watchlist[0].exchange, "dealer_fx_otc");
  await storage.importBackup("two", json(clean));
  const restored = (await storage.loadWatchlist("two"))[0];
  for (const key of ["symbol", "ticker", "uid", "type", "classCode", "exchange", "realExchange"])
    assert.equal(restored[key], row[key], key);
  assert.equal(await storage.loadWatchlist("three"), undefined);
  assert.equal((await storage.loadWatchlist("one"))[0].uid, "dealer");
});

test("actual search component exposes currency category and distinguishes MOEX and dealer", () => {
  const jsx = (type, props) => ({ type, props });
  const rows = currencies
    .slice(0, 2)
    .map((item) => ({ ...item, symbol: item.ticker, type: "currency" }));
  const load = sources({
    react: { useState: (value) => [value, () => {}], useEffect: () => {} },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.tsx": {
      useTerminal: () => ({ state: { owner: "one", rows }, controller: {} })
    },
    "screens/terminal/Modal.tsx": { Modal: "modal" },
    "i18n/messages.ts": { t: (value) => value, systemText: (value) => value },
    "i18n/preferences.ts": { intlLocale: () => "ru-RU" }
  });
  const tree = load("screens/terminal/InstrumentSearch.tsx").InstrumentSearch();
  const kinds = tree.props.children[1].props.children;
  assert.ok(kinds.some((item) => item.props.children === "Валюты"));
  const results = tree.props.children[2].props.children;
  assert.equal(
    results[0].props.children[1].props.children[0].props.children[1].props.children,
    "Валюта"
  );
  assert.match(results[0].props.children[1].props.children[2].props.children, /CETS · MOEX/);
  assert.match(results[1].props.children[1].props.children[2].props.children, /CNGDOTC · Дилер/);
  const english = sources()("i18n/messages-ui.ts").uiMessages;
  assert.equal(english["Валюты"], "Currencies");
  assert.equal(english["Валюта"], "Currency");
  assert.equal(english["Дилер"], "Dealer");
});
