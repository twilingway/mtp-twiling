import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { sourceModules, row } from "./helpers/watchlist-sections.mjs";

const noop = () => {};
const bar = (timestamp, close) => ({ timestamp, open: close - 1, high: close + 1,
  low: close - 2, close, volume: 10 });
const find = (node, predicate) => {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
};
const text = (node) => typeof node === "string" ? node : node && typeof node === "object" ?
  [node.props?.children].flat(Infinity).map(text).join(" ") : "";

function environment() {
  const keys = ["window", "document", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"];
  const saved = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  const frames = [];
  class Element {}
  const doc = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null,
    documentElement: { classList: { add: noop, remove: noop } },
    defaultView: { HTMLElement: Element, HTMLIFrameElement: class extends Element {} } };
  globalThis.window = { event: undefined, HTMLIFrameElement: class {},
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }) };
  globalThis.document = doc;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = (run) => { frames.push(run); return frames.length; };
  globalThis.cancelAnimationFrame = noop;
  return {
    container: { nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
      ownerDocument: doc, addEventListener: noop, removeEventListener: noop },
    flushFrames: () => { while (frames.length) frames.shift()(); },
    restore: () => { for (const key of keys) {
      if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key];
    } }
  };
}

test("real controller quote/candle events leave static component hooks idle and quotes live", async (t) => {
  const env = environment();
  const load = sourceModules({ react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
    "services/storage.ts": {}, "services/storage-db.ts": {} });
  const { TerminalController } = load("screens/terminal/controller.js");
  const { TerminalContext, useTerminal } = load("screens/terminal/context.js");
  const { TIMEFRAMES } = load("model/history-codec.js");
  const { viewKey } = load("screens/terminal/controller-bridge.js");
  const c = new TerminalController(), rows = [row("A"), row("B")];
  c.update({ owner: "test-owner", ready: true, watchlistStartup: "ready", marketReady: true,
    status: "connected", dialog: "account", objectPanel: true, rows: structuredClone(rows),
    preferences: { ...c.getSnapshot().preferences, symbol: "A", instrumentUid: "uid-A", timeframe: "1d", rightPanelTab: "objects" },
    candles: [bar(1000, 100)] });
  const client = new EventTarget();
  c.session.client = client;
  c.session.attach(client, 0);
  const components = Object.fromEntries(["Toolbar", "DrawingToolbar", "Watchlist", "AccountDialog",
    "RightPanel", "ApplicationInfo", "BackupTransferSettings", "WatchlistSectionsTable",
    "WatchlistFlagFilter", "InstrumentDetails", "DetailsDivider"].map((name) =>
    [name, load(`screens/terminal/${name}.js`)[name]]));
  components.ObjectTree = load("screens/terminal/drawings/ObjectTree.js").ObjectTree;
  components.TechnicalObjectTree = load("screens/terminal/TechnicalIndicatorPanels.js").TechnicalObjectTree;
  components.ChartMeasurementButton = load("screens/terminal/ChartMeasurement.js").ChartMeasurementButton;
  const zoom = load("screens/terminal/ChartRangeZoom.js");
  components.ChartRangeZoomButton = zoom.ChartRangeZoomButton;
  components.ChartZoomOutButton = zoom.ChartZoomOutButton;
  function DefaultReader() { useTerminal(); return null; }
  const counts = {}, latest = {};
  const readers = { DefaultReader, ...Object.fromEntries(Object.entries(components).map(([name, Component]) =>
    [name, function Reader() {
      latest[name] = Component({ onChoose: noop, active: false, row: rows[0], query: "", sort: null,
        direction: 1, onSort: noop, onManualOrder: noop });
      return null;
    }])) };
  const root = createRoot(env.container);
  const sync = (run) => ReactDOM.flushSync(run);
  const render = () => root.render(React.createElement(TerminalContext, { value: c },
    Object.entries(readers).map(([id, Component]) => React.createElement(React.Profiler, {
      id, key: id, onRender: () => { counts[id] = (counts[id] ?? 0) + 1; }
    }, React.createElement(Component)))));
  const change = (patch) => sync(() => c.update(patch));
  const snapshot = () => ({ rows, marketReady: true, authenticated: false, status: "connected", error: null });
  const measure = (name, run, quote) => {
    const before = { ...counts };
    for (let index = 0; index < 20; index++) sync(() => run(index));
    const commits = Object.fromEntries(Object.keys(counts).map((key) => [key, counts[key] - before[key]]));
    for (const key of Object.keys(counts)) assert.equal(commits[key],
      key === "DefaultReader" || (quote && ["Watchlist", "WatchlistSectionsTable", "WatchlistFlagFilter"].includes(key)) ? 20 : 0,
      `${name}: ${key}`);
    t.diagnostic(JSON.stringify({ name, events: 20, commits }));
  };
  try {
    sync(render);
    measure("selected quote", (index) => { rows[0].price = 101 + index;
      client.dispatchEvent(new CustomEvent("state", { detail: snapshot() })); }, true);
    assert.match(text(find(latest.Watchlist, (node) => node.props?.id === "detail-price")), /120/);
    measure("unselected quote", (index) => { rows[1].price = 201 + index;
      client.dispatchEvent(new CustomEvent("state", { detail: snapshot() })); }, true);
    measure("live candle", (index) => {
      client.dispatchEvent(new CustomEvent("candle", { detail: { uid: "uid-A", interval: TIMEFRAMES["1d"].stream,
        bar: bar(1000, 101 + index) } }));
      env.flushFrames();
    }, false);
    assert.equal(c.getSnapshot().candles[0].close, 120);

    const beforeAttachment = c.getSnapshot();
    assert.equal(latest.ChartZoomOutButton.props.disabled, true);
    c.chart = { source: { owner: beforeAttachment.owner, uid: "uid-A", viewKey: viewKey(beforeAttachment.preferences) },
      getView: () => ({}), zoom: noop };
    sync(render); // A parent/menu render after asynchronous attachment, with no store update.
    assert.equal(c.getSnapshot(), beforeAttachment);
    assert.equal(latest.ChartZoomOutButton.props.disabled, false);
    delete c.chart.zoom;
    sync(render);
    assert.equal(c.getSnapshot(), beforeAttachment);
    assert.equal(latest.ChartZoomOutButton.props.disabled, true);
    c.chart = null;

    change({ authenticated: true, status: "disconnected", error: "API connection failed", name: "Account name" });
    assert.match(text(latest.AccountDialog), /API connection failed/);
    assert.match(text(latest.ApplicationInfo), /API connection failed/);
    assert.match(text(latest.AccountDialog), /Account name/);
    change({ activeTool: "segment" });
    assert.ok(find(latest.DrawingToolbar, (node) => node.props?.active === true));
    sync(() => find(latest.DrawingToolbar, (node) => node.props?.id === "cursors").props.onMenu({ focus: noop }));
    assert.ok(find(latest.DrawingToolbar, (node) => node.props?.id === "drawing-toolbar-menu"));
    change({ dialog: "drawing-settings" });
    await new Promise(setImmediate);
    sync(noop);
    assert.equal(Boolean(find(latest.DrawingToolbar, (node) => node.props?.id === "drawing-toolbar-menu")), false);
    const drawing = { id: "d1", name: "segment", points: [], title: "Saved line" };
    change({ drawings: [drawing], selectedObject: "d1" });
    assert.match(find(latest.ObjectTree, (node) => node.props?.["data-object"] === "d1").props.className, /selected/);
    change({ objectPanel: false });
    assert.equal(latest.ObjectTree, null);

    const prefs = { ...c.getSnapshot().preferences, locale: "en", symbol: "B", instrumentUid: "uid-B" };
    load("i18n/preferences.js").setDisplayPreferences(prefs);
    change({ owner: "next-owner", preferences: prefs, objectPanel: true, activeTool: null });
    assert.equal(latest.ChartMeasurementButton.props["aria-label"], "Ruler");
    assert.equal(latest.ChartRangeZoomButton.props["aria-label"], "Zoom to selection");
    assert.match(text(find(latest.Watchlist, (node) => node.props?.id === "detail-symbol")), /B/);
    c.chart = { source: { owner: "next-owner", uid: "uid-B", viewKey: viewKey(prefs) }, getView: () => ({}), zoom: noop };
    change({ chartRevision: c.getSnapshot().chartRevision + 1, candles: [bar(1000, 200)] });
    assert.equal(latest.ChartZoomOutButton.props.disabled, false);
    sync(() => latest.ChartMeasurementButton.props.onClick());
    assert.equal(latest.ChartMeasurementButton.props["aria-pressed"], true);
    sync(() => latest.ChartRangeZoomButton.props.onClick());
    assert.equal(latest.ChartRangeZoomButton.props["aria-pressed"], true);
    assert.equal(latest.ChartMeasurementButton.props["aria-pressed"], false);
    change({ historyViewReady: false });
    assert.equal(latest.ChartMeasurementButton.props.disabled, true);
    assert.equal(latest.ChartRangeZoomButton.props.disabled, true);
    assert.equal(latest.ChartZoomOutButton.props.disabled, true);
  } finally {
    sync(() => root.unmount());
    await new Promise(setImmediate);
    env.restore();
  }
});
