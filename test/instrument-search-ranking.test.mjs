import assert from "node:assert/strict";
import test from "node:test";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const load = sourceModules();
const {
  instrumentSearchHighlight,
  instrumentSearchSource,
  instrumentSearchVenue,
  sortInstrumentSearch
} = load("model/instrument-search-sort.js");
const { searchCatalog } = load("services/tbank-instruments.js");
const { bankSearchQuoteUid, loadInstrumentSearchPrices, INSTRUMENT_SEARCH_PRICE_LIMIT } = load(
  "services/instrument-search-prices.js"
);
const bank = (uid, ticker, classCode, extras = {}) => ({
  uid,
  ticker,
  classCode,
  kind: "share",
  name: "Газпром",
  ...extras
});
const main = bank("main-tqbr", "GAZP", "TQBR");
const otc = bank("other-otc", "GAZP", "OTC", { exchange: "dealer_fx_otc" });
const prefix = bank("prefix", "GAZPA", "TQBR");
const nameMatch = bank("name", "A", "TQBR", { name: "GAZP · связанный инструмент" });
const crypto = (provider, ticker) => ({
  name: "Bitcoin",
  kind: "crypto",
  ticker,
  providerRef: { provider, category: "spot", symbol: ticker }
});
const uidList = (items) => items.map((item) => item.uid);

test("relevance prioritizes exact ticker and TQBR without editing or merging distinct records", () => {
  const differentBoard = bank("other-board", "GAZP", "TQPI", { exchange: "moex" });
  const input = [prefix, other(), otc, nameMatch, differentBoard, main];
  function other() {
    return bank("other", "OGAZP", "TQBR");
  }
  const snapshot = structuredClone(input);
  const expected = ["main-tqbr", "other-otc", "other-board", "prefix", "other", "name"];
  assert.deepEqual(uidList(sortInstrumentSearch(input, "  gAzP  ")), expected);
  assert.deepEqual(uidList(sortInstrumentSearch([...input].reverse(), "gazp")), expected);
  assert.deepEqual(input, snapshot);
  assert.equal(sortInstrumentSearch(input, "gazp")[0], main);
});

test("the bank search ranks TQBR before truncating a large set of same-ticker matches", async () => {
  const alternatives = Array.from({ length: 96 }, (_, index) =>
    bank(`candidate-${index}`, "GAZP", "TQPI")
  );
  const selected = await searchCatalog(
    { at: 0, shares: [...alternatives, main], futures: [], indicatives: [] },
    "GAZP",
    "all",
    () => assert.fail("exact local search should not need fallback")
  );
  assert.equal(selected.length, 80);
  assert.equal(selected[0].uid, main.uid);
  assert.equal(selected[0].classCode, "TQBR");
  assert.equal(selected.filter((item) => item.ticker === "GAZP").length, 80);
});

test("ticker and data source orders keep identities and available venues distinct", () => {
  const bybit = crypto("bybit", "ETHUSDT");
  const okx = crypto("okx", "BTC-USDT");
  const entries = [main, bybit, okx, prefix];
  assert.deepEqual(
    sortInstrumentSearch(entries, "gazp", "ticker", "en").map((item) => item.ticker),
    ["BTC-USDT", "ETHUSDT", "GAZP", "GAZPA"]
  );
  assert.deepEqual(
    sortInstrumentSearch(entries, "gazp", "source", "en").map(instrumentSearchSource),
    ["Bybit", "OKX", "Т‑Банк", "Т‑Банк"]
  );
  assert.equal(instrumentSearchVenue(main), "MOEX");
  assert.equal(instrumentSearchVenue(otc), "Дилер · внебиржевой");
  assert.equal(
    instrumentSearchVenue({ ...main, exchange: "moex_close" }),
    "MOEX · данные закрытия"
  );
  assert.equal(instrumentSearchVenue({ ...main, exchange: "given-venue" }), "given-venue");
  assert.equal(instrumentSearchVenue({ ...main, classCode: "missing" }), undefined);
  assert.equal(instrumentSearchVenue(bybit), undefined);
});

test("highlighting keeps literal punctuation and original character case", () => {
  assert.deepEqual(instrumentSearchHighlight("GAZP · gazp", "gAzP"), [
    "",
    "GAZP",
    " · ",
    "gazp",
    ""
  ]);
  assert.deepEqual(instrumentSearchHighlight("Газпром", "ГАЗ"), ["", "Газ", "пром"]);
  assert.deepEqual(instrumentSearchHighlight("A.B]", ".B]"), ["A", ".B]", ""]);
  assert.deepEqual(instrumentSearchHighlight("GAZP", "[*"), ["GAZP"]);
});

test("the search quote batch deduplicates and limits IDs, accepting only exact returned UID and price", async () => {
  assert.equal(bankSearchQuoteUid(main), main.uid);
  assert.equal(bankSearchQuoteUid({ ...main, kind: "future" }), undefined);
  assert.equal(
    bankSearchQuoteUid({ ...main, providerRef: crypto("okx", "BTC-USDT").providerRef }),
    undefined
  );
  const abort = new AbortController();
  const bodyPrice = (instrumentUid, units, nano) => ({ instrumentUid, price: { units, nano } });
  const calls = [];
  const requester = {
    request: async (...args) => {
      calls.push(args);
      return {
        lastPrices: [
          bodyPrice(main.uid, "12", 299000000),
          bodyPrice(otc.uid, "0", 0),
          bodyPrice("candidate-0", "11", 535000000),
          bodyPrice("unrequested", "10", 0),
          { figi: "same-ticker", price: { units: "1", nano: 0 } }
        ]
      };
    }
  };
  const ids = [
    main.uid,
    otc.uid,
    main.uid,
    "bybit:spot:BTCUSDT",
    ...Array.from({ length: 30 }, (_, index) => `candidate-${index}`)
  ];
  const prices = await loadInstrumentSearchPrices(requester, ids, abort.signal);
  assert.deepEqual(
    [...prices],
    [
      [main.uid, 12.299],
      ["candidate-0", 11.535]
    ]
  );
  assert.equal(calls.length, 1);
  const [[service, method, body, signal]] = calls;
  assert.equal(service, "MarketDataService");
  assert.equal(method, "GetLastPrices");
  assert.equal(body.lastPriceType, "LAST_PRICE_EXCHANGE");
  assert.equal(body.instrumentId.length, INSTRUMENT_SEARCH_PRICE_LIMIT);
  assert.ok(!body.instrumentId.includes("bybit:spot:BTCUSDT"));
  assert.equal(new Set(body.instrumentId).size, body.instrumentId.length);
  assert.equal(signal, abort.signal);
});

test("a cancelled search price request cannot return data to another query", async () => {
  const abort = new AbortController();
  let requested = 0;
  const requester = {
    request: async () => {
      requested++;
      abort.abort();
      return { lastPrices: [] };
    }
  };
  await assert.rejects(loadInstrumentSearchPrices(requester, [main.uid], abort.signal), {
    name: "AbortError"
  });
  await assert.rejects(loadInstrumentSearchPrices(requester, [main.uid], abort.signal), {
    name: "AbortError"
  });
  assert.equal(requested, 1);
});
