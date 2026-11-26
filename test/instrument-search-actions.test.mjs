import assert from "node:assert/strict";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { row, sourceModules } from "./helpers/watchlist-sections.mjs";

function nodes(element) {
  if (!element || typeof element !== "object") return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}

function searchFixture(t, results, rows, query = "CNY") {
  const calls = [];
  const state = { owner: "owner", rows, preferences: { symbol: "GAZP" } };
  const editor = {
    getSnapshot: () => state,
    setDialog: (dialog) => calls.push(["dialog", dialog]),
    setPreferences: async (patch) => {
      calls.push(["select", patch]);
    },
    addInstrument: async (item) => {
      calls.push(["open-new", item]);
    },
    addToWatchlist: () => assert.fail("watchlist action used the chart editor"),
    removeInstrument: () => assert.fail("watchlist action used the chart editor"),
    panel: { closeMobile: () => calls.push(["close-mobile-panel"]) },
    notify: (text) => calls.push(["error", text])
  };
  const watchlistController = {
    addToWatchlist: async (item) => {
      calls.push(["add", item]);
      state.rows = [...state.rows, { ...row(item.ticker, item.uid), name: item.name }];
    },
    removeInstrument: async (reference) => {
      calls.push(["remove", reference]);
      state.rows = state.rows.filter(
        ({ uid, symbol }) => uid !== reference.uid || symbol !== reference.symbol
      );
    }
  };
  const stores = [
    { query, kind: "all", revision: 0 },
    { revision: 0, owner: state.owner, items: results, error: "" }
  ];
  let hook = 0;
  const load = sourceModules({
    react: {
      useState: (initial) => {
        const index = hook++;
        if (!(index in stores)) stores[index] = initial;
        return [
          stores[index],
          (value) => {
            stores[index] = typeof value === "function" ? value(stores[index]) : value;
          }
        ];
      },
      useEffect: () => {},
      useRef: () => ({ current: { focus: () => calls.push(["focus-search"]) } })
    },
    "react/jsx-runtime": jsx,
    "screens/terminal/context.tsx": { useTerminal: () => ({ controller: editor, state }) },
    "screens/terminal/workspace-sync-controller.ts": {
      publishWorkspaceInstrument: (controller, uid) => {
        assert.equal(controller, editor);
        calls.push(["sync", uid]);
      }
    }
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: false }) }
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  const { InstrumentSearch } = load("screens/terminal/InstrumentSearch.js");
  const render = () => {
    hook = 0;
    return nodes(InstrumentSearch({ watchlistController }));
  };
  return { calls, render, state };
}

const cny = (uid, name) => ({ ticker: "CNYRUB", uid, name, kind: "currency" });
const added = cny("bank-moex", "Юань Мосбиржа");
const missing = cny("bank-otc", "Юань внебиржевой");
const savedRow = { ...row(added.ticker, added.uid), name: added.name };
const settled = () => new Promise(setImmediate);

test("the search plus changes only the watchlist and the same result becomes removable", async (t) => {
  const f = searchFixture(t, [added, missing], [savedRow]);
  const ui = f.render();
  const result = ui.find(
    (item) =>
      item.props.className === "instrument-result" &&
      item.props.children[1].props["data-add-instrument"] === 1
  );
  const [selectButton, addButton] = result.props.children;
  assert.equal(selectButton.type, "button");
  assert.equal(addButton.type, "button");
  assert.match(addButton.props["aria-label"], /Добавить в список котировок.*Юань внебиржевой/);
  addButton.props.onClick();
  await settled();
  assert.deepEqual(f.calls, [["add", missing]]);
  assert.equal(f.state.preferences.symbol, "GAZP");
  const next = f.render();
  assert.equal(next.find((item) => item.props.id === "instrument-query").props.value, "CNY");
  assert.ok(next.some((item) => item.props["data-remove-instrument"] === 1));
});

test("remove targets the exact row among identical tickers and leaves the dialog open", async (t) => {
  const other = { ...row(missing.ticker, missing.uid), name: missing.name };
  const f = searchFixture(t, [added, missing], [savedRow, other]);
  const button = f.render().find((item) => item.props["data-remove-instrument"] === 1);
  assert.match(button.props["aria-label"], /Удалить из списка котировок.*Юань внебиржевой/);
  button.props.onClick();
  await settled();
  assert.deepEqual(f.calls, [["remove", { uid: missing.uid, symbol: "CNYRUB" }]]);
  assert.deepEqual(f.state.rows, [savedRow]);
  assert.ok(f.render().some((item) => item.props["data-add-instrument"] === 1));
});

test("the result buttons still select the active chart and publish the exact selection", async (t) => {
  const f = searchFixture(t, [added, missing], [savedRow]);
  f.render()
    .find((item) => item.props["data-select-instrument"] === 0)
    .props.onClick();
  await settled();
  assert.deepEqual(f.calls, [
    ["select", { symbol: "CNYRUB", instrumentUid: added.uid }],
    ["dialog", null],
    ["sync", added.uid]
  ]);
  f.render()
    .find((item) => item.props["data-select-instrument"] === 1)
    .props.onClick();
  await settled();
  assert.deepEqual(f.calls.slice(-2), [
    ["open-new", missing],
    ["sync", missing.uid]
  ]);
});

test("search clear preserves the open dialog and restores the input focus", (t) => {
  const f = searchFixture(t, [added], [savedRow]);
  const clear = f.render().find((item) => item.props.className === "instrument-search-clear");
  clear.props.onClick();
  assert.deepEqual(f.calls, [["focus-search"]]);
  assert.equal(f.render().find((item) => item.props.id === "instrument-query").props.value, "");
});

test("identity checks use provider, product, UID or an unambiguous FIGI", () => {
  const { searchWatchlistRow } = sourceModules()("model/instrument-search-identity.js");
  const bybit = { provider: "bybit", category: "spot", symbol: "BTCUSDT" };
  const linear = { ...bybit, category: "linear" };
  const okx = { provider: "okx", category: "spot", symbol: "BTC-USDT" };
  const rows = [
    { ...row("BTCUSDT", "bybit:spot:BTCUSDT"), providerRef: bybit },
    { ...row("BTCUSDT", "bybit:linear:BTCUSDT"), providerRef: linear },
    { ...row("BTCUSDT", "okx:spot:BTC-USDT"), providerRef: okx }
  ];
  assert.equal(searchWatchlistRow(rows, { ...rows[0], providerRef: okx }), rows[2]);
  assert.equal(searchWatchlistRow(rows, { ...rows[0], providerRef: linear }), rows[1]);
  assert.equal(searchWatchlistRow(rows, rows[0]), rows[0]);
  assert.equal(searchWatchlistRow(rows, { ticker: "BTCUSDT", name: "Unverified" }), undefined);
  const legacy = { ...savedRow, uid: null, figi: "figi-legacy" };
  assert.equal(searchWatchlistRow([legacy], { ...added, figi: legacy.figi }), legacy);
  assert.equal(
    searchWatchlistRow([{ ...legacy, uid: "different-uid" }], { ...added, figi: legacy.figi }),
    undefined
  );
  assert.equal(
    searchWatchlistRow([legacy, { ...legacy }], { ...added, figi: legacy.figi }),
    undefined
  );
});
