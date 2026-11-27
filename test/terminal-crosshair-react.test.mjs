import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceModules, row } from "./helpers/watchlist-sections.mjs";

const load = sourceModules({ react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM });
const { TerminalContext, useTerminal, useTerminalState } = load("screens/terminal/context.js");
const { selectPreferences } = load("screens/terminal/terminal-state-selection.js");
const { shallowEqual } = load("screens/terminal/snapshot-selector.js");
const { selectChartOhlcMeta, ChartOhlcMeta } = load("screens/terminal/ChartOhlcMeta.js");
const { Watchlist } = load("screens/terminal/Watchlist.js");
const bar = (timestamp, close) => ({ timestamp, open: close - 1, high: close + 2,
  low: close - 2, close, volume: close });
function fixture(mode = "candle") {
  let state = { owner: "owner", candles: [bar(1000, 10), bar(2000, 20), bar(3000, 30)],
    rows: [row("A")], crosshairBar: null, preferences: {
      symbol: "A", instrumentUid: "uid-A", timeframe: "1d", chartSettings: { ohlcDisplay: mode }
    } };
  const listeners = new Set();
  let notifications = 0;
  const controller = {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }
  };
  return { controller, notifications: () => notifications, update(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) { notifications++; listener(); }
  } };
}

// Components return null: only the event/owner-document boundary of ReactDOM is needed.
function nullContainer() {
  class Element {}
  const view = { HTMLElement: Element, HTMLIFrameElement: class extends Element {} };
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {},
    activeElement: null, defaultView: view };
  return { nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: doc, addEventListener() {}, removeEventListener() {} };
}

test("ReactDOM subscribers avoid crosshair-only commits while explicit OHLC hover stays live", async (t) => {
  const savedWindow = globalThis.window;
  globalThis.window = { event: undefined, HTMLIFrameElement: class {} };
  const f = fixture("corner"), counts = {}, latest = {};
  function DefaultReader() { latest.default = useTerminal().state; return null; }
  function ExplicitReader() { latest.explicit = useTerminal((state) => state).state; return null; }
  function EditorReader() { latest.editor = useTerminalState(f.controller, selectPreferences); return null; }
  function OhlcReader() { latest.ohlc = useTerminal(selectChartOhlcMeta, shallowEqual).state; return null; }
  // Execute the real Watchlist hooks; discard markup so no fabricated layout is measured.
  function WatchlistReader() { Watchlist({ chartEditor: f.controller }); return null; }
  const root = createRoot(nullContainer());
  const tracked = (id, Component) => React.createElement(React.Profiler, {
    id, key: id, onRender: () => { counts[id] = (counts[id] ?? 0) + 1; }
  }, React.createElement(Component));
  try {
    flushSync(() => root.render(React.createElement(TerminalContext, { value: f.controller }, [
      tracked("default", DefaultReader), tracked("explicit", ExplicitReader),
      tracked("editor", EditorReader), tracked("ohlc", OhlcReader), tracked("watchlist", WatchlistReader)
    ])));
    const initial = { ...counts };
    for (let index = 0; index < 100; index++) flushSync(() => f.update({
      crosshairBar: f.controller.getSnapshot().candles[index % 2]
    }));
    assert.equal(counts.default - initial.default, 0);
    assert.equal(counts.editor - initial.editor, 0);
    assert.equal(counts.watchlist - initial.watchlist, 0);
    assert.equal(counts.explicit - initial.explicit, 100);
    assert.equal(counts.ohlc - initial.ohlc, 100);
    assert.equal(f.notifications(), 600);
    t.diagnostic(JSON.stringify({ crosshairUpdates: 100, notifications: f.notifications(),
      commits: Object.fromEntries(Object.keys(counts).map((key) => [key, counts[key] - initial[key]])) }));
    flushSync(() => f.update({ crosshairBar: null }));
    assert.equal(latest.ohlc.bar.close, 30);
    const nextCandles = [...f.controller.getSnapshot().candles.slice(0, -1), bar(3000, 35)];
    flushSync(() => f.update({ candles: nextCandles }));
    assert.equal(counts.default - initial.default, 1);
    assert.equal(latest.default.candles, nextCandles);
    assert.equal(latest.ohlc.bar.close, 35);
    const prefs = { ...f.controller.getSnapshot().preferences, symbol: "B" };
    flushSync(() => f.update({ preferences: prefs }));
    assert.equal(counts.editor - initial.editor, 1);
    assert.equal(counts.watchlist - initial.watchlist, 1);
    assert.equal(latest.editor, prefs);
    const rows = [{ ...f.controller.getSnapshot().rows[0], price: 45 }];
    flushSync(() => f.update({ rows }));
    assert.equal(latest.default.rows[0].price, 45);
    assert.equal(counts.watchlist - initial.watchlist, 2);
    flushSync(() => f.update({ toast: "Saved", importingBackup: true, historyViewReady: false }));
    assert.equal(latest.default.toast, "Saved");
    assert.equal(latest.default.importingBackup, true);
    assert.equal(latest.default.historyViewReady, false);
  } finally {
    flushSync(() => root.unmount());
    await new Promise(setImmediate);
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
});

test("corner OHLC reads mouse hover, clear and live candles; other modes ignore hover", () => {
  for (const mode of ["corner", "icon", "candle", "hidden"]) {
    const f = fixture(mode);
    const read = load("screens/terminal/snapshot-selector.js").selectedSnapshot(
      f.controller.getSnapshot, selectChartOhlcMeta, shallowEqual
    );
    const initial = read();
    f.update({ crosshairBar: f.controller.getSnapshot().candles[1] });
    assert.equal(read().bar.close, mode === "corner" ? 20 : 30);
    if (mode !== "corner") assert.equal(read(), initial);
    f.update({ crosshairBar: { timestamp: 9999 } });
    assert.equal(read().bar.close, 30);
    f.update({ crosshairBar: null });
    assert.equal(read().bar.close, 30);
    const html = renderToStaticMarkup(React.createElement(TerminalContext, { value: f.controller },
      React.createElement(ChartOhlcMeta)));
    if (mode === "corner") assert.match(html, /class="ohlc ohlc-legend"/);
    else if (mode === "icon") assert.match(html, /class="ohlc-icon-button"/);
    else assert.equal(html, "");
  }
});
