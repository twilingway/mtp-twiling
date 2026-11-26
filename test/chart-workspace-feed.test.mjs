import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { startWorkspaceCandleFeed, workspaceHistoryRange } = load(
  "screens/terminal/workspace-candle-feed.js"
);
const { TIMEFRAMES } = load("model/history-codec.js");
const bar = (timestamp, close) => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1
});
const points = (candles) => candles.map(({ timestamp, close }) => [timestamp, close]);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const watches = [];
  const requests = [];
  const source = {
    watchCandles(uid, timeframe, listener, signal) {
      const watch = { uid, timeframe, listener, signal, released: false };
      watches.push(watch);
      return () => {
        watch.released = true;
      };
    },
    loadCandles(symbol, timeframe, range, options) {
      return new Promise((resolve, reject) => {
        requests.push({ symbol, timeframe, range, options, resolve, reject });
      });
    }
  };
  const start = (uid, { timeframe = "1d", initial = [], active = () => true } = {}) => {
    const events = [];
    const stop = startWorkspaceCandleFeed(source, {
      uid,
      symbol: "SHARED",
      timeframe,
      range: { from: 1, to: 6 },
      initial,
      active,
      replace: (candles, final) => events.push(["replace", points(candles), final]),
      update: (item, candles) => events.push(["update", item.close, points(candles)]),
      settle: (outcome, hasData) => events.push(["settle", outcome, hasData])
    });
    const index = watches.length - 1;
    const emit = (item, sourceUid = uid, eventInterval = TIMEFRAMES[timeframe].stream) =>
      watches[index].listener({ uid: sourceUid, interval: eventInterval, bar: item });
    return { events, stop, emit };
  };
  return { start, watches, requests };
}

test("compare feed keeps live candles newer than both HTTP progress and finished history", async () => {
  const { start, watches, requests } = fixture();
  const pane = start("okx:spot:SHARED");
  assert.equal(watches[0].uid, "okx:spot:SHARED");
  assert.equal(requests[0].options.uid, "okx:spot:SHARED");
  assert.equal(watches[0].signal, requests[0].options.signal);

  pane.emit(bar(3, 33), "bybit:spot:SHARED");
  pane.emit(bar(3, 30), watches[0].uid, TIMEFRAMES["1h"].stream);
  assert.deepEqual(pane.events, []);
  pane.emit(bar(3, 303));
  const request = requests[0];
  request.options.onProgress({ cached: true, candles: [bar(1, 101), bar(3, 301)] });
  request.options.onProgress({ cached: false, candles: [bar(2, 202), bar(3, 302)] });
  pane.emit(bar(4, 404));
  request.resolve({ candles: [bar(3, 300), bar(4, 400), bar(5, 505)], cached: false });
  await tick();
  assert.deepEqual(pane.events.at(-2), [
    "replace",
    [
      [1, 101],
      [2, 202],
      [3, 303],
      [4, 404],
      [5, 505]
    ],
    true
  ]);
  assert.deepEqual(pane.events.at(-1), ["settle", "ready", true]);

  request.options.onProgress({ cached: true, candles: [bar(3, 3)] });
  assert.deepEqual(pane.events.at(-1), ["settle", "ready", true]);
  pane.emit(bar(5, 515));
  assert.deepEqual(pane.events.at(-1), [
    "update",
    515,
    [
      [1, 101],
      [2, 202],
      [3, 303],
      [4, 404],
      [5, 515]
    ]
  ]);
  pane.stop();
});

test("closing a comparison pane aborts only its request and ignores late callbacks", async () => {
  const { start, watches, requests } = fixture();
  const first = start("bank:1");
  const second = start("bybit:spot:SHARED");
  first.stop();
  assert.equal(watches[0].released, true);
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(watches[1].released, false);
  assert.equal(requests[1].options.signal.aborted, false);
  first.emit(bar(5, 500));
  requests[0].options.onProgress({ cached: true, candles: [bar(3, 300)] });
  requests[0].resolve({ cached: false, candles: [bar(2, 200)] });
  second.emit(bar(4, 404));
  requests[1].resolve({ cached: false, candles: [bar(3, 300)] });
  await tick();
  assert.deepEqual(first.events, []);
  assert.deepEqual(second.events.at(-2), [
    "replace",
    [
      [3, 300],
      [4, 404]
    ],
    true
  ]);
  assert.deepEqual(second.events.at(-1), ["settle", "ready", true]);
  second.stop();
});

test("cache-only reload retains the visible close and a source failure leaves the live feed usable", async () => {
  const { start, requests } = fixture();
  const failed = start("bank:1");
  requests[0].reject(new Error("history source offline"));
  await tick();
  assert.deepEqual(failed.events.at(-1), ["settle", "error", false]);
  failed.emit(bar(2, 222));
  assert.deepEqual(failed.events.at(-1), ["update", 222, [[2, 222]]]);
  failed.stop();

  const retry = start("bank:1", { initial: [bar(2, 222)] });
  requests[1].resolve({ cached: true, requests: 0, candles: [bar(1, 111), bar(2, 200)] });
  await tick();
  assert.deepEqual(retry.events[0], [
    "replace",
    [
      [1, 111],
      [2, 222]
    ],
    true
  ]);
  retry.stop();
});

test("online backfill corrects older pane bars even with a warm cache", async () => {
  const { start, requests } = fixture();
  const pane = start("bybit:spot:SHARED", { initial: [bar(2, 222), bar(3, 333)] });
  const request = requests[0];
  request.options.onProgress({ cached: true, completed: 0, candles: [bar(2, 200)] });
  assert.deepEqual(pane.events[0], ["replace", [[2, 222], [3, 333]], false]);
  pane.emit(bar(3, 335));
  request.options.onProgress({ cached: true, completed: 1, candles: [bar(2, 225), bar(3, 334)] });
  assert.deepEqual(pane.events.at(-1), ["replace", [[2, 225], [3, 335]], false]);
  request.resolve({ cached: true, requests: 1, candles: [bar(2, 227), bar(3, 334)] });
  await tick();
  assert.deepEqual(pane.events.at(-2), ["replace", [[2, 227], [3, 335]], true]);
  pane.stop();
});

test("profile mismatch stops data publication before effect cleanup", async () => {
  const { start, requests } = fixture();
  let active = true;
  const pane = start("bank:1", { active: () => active });
  active = false;
  pane.emit(bar(3, 333));
  requests[0].resolve({ cached: false, candles: [bar(2, 222)] });
  await tick();
  assert.deepEqual(pane.events, []);
  pane.stop();
});

test("comparison bounds minute loads and keeps monthly history aligned", () => {
  const now = Date.UTC(2026, 10, 26, 12);
  const day = 86_400_000;
  assert.deepEqual(workspaceHistoryRange(now, "1m", 365), { from: now - 4 * day, to: now });
  assert.deepEqual(workspaceHistoryRange(now, "1d", 365), { from: now - 365 * day, to: now });
  assert.deepEqual(workspaceHistoryRange(now, "1M", 1), { from: Date.UTC(2026, 9, 1), to: now });
});

test("workspace renders one primary and distinct comparison instruments from mixed sources", () => {
  const bank = { uid: "bank-id", symbol: "SBER", ticker: "SBER", name: "Sberbank" };
  const bybit = {
    uid: "bybit:spot:BTCUSDT",
    symbol: "BTCUSDT",
    ticker: "BTCUSDT",
    name: "Bitcoin",
    providerRef: { provider: "bybit", category: "spot", symbol: "BTCUSDT" }
  };
  const okx = {
    ...bybit,
    uid: "okx:spot:BTC-USDT",
    providerRef: { provider: "okx", category: "spot", symbol: "BTC-USDT" }
  };
  const chartLoad = createSourceLoader({
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "screens/terminal/ChartPanel.js": {
      ChartPanel: () => React.createElement("div", { id: "primary-chart" })
    },
    "screens/terminal/AuxiliaryChart.js": {
      AuxiliaryChart: ({ row, preferences }) =>
        React.createElement("div", { "data-uid": row.uid, "data-timeframe": preferences.timeframe })
    },
    "screens/terminal/context.js": {
      useTerminal: () => ({
        controller: { sessionKey: () => ({}) },
        state: {
          owner: "workspace-profile",
          authenticated: true,
          preferences: { symbol: bank.symbol, instrumentUid: bank.uid, timeframe: "2m" },
          rows: [bank, bybit, { ...bybit }, okx, { ...bank, uid: null }]
        }
      })
    }
  });
  const { setDisplayPreferences } = chartLoad("i18n/preferences.js");
  setDisplayPreferences({ locale: "en" });
  const { ChartWorkspace } = chartLoad("screens/terminal/ChartWorkspace.js");
  const { ChartLayoutControl } = chartLoad("screens/terminal/ChartLayoutControl.js");
  const render = (count) => renderToStaticMarkup(React.createElement(ChartWorkspace, { count }));
  const one = render(1);
  const two = render(2);
  const three = render(3);
  for (const markup of [one, two, three])
    assert.equal(markup.match(/id="primary-chart"/g)?.length, 1);
  assert.doesNotMatch(one, /class="auxiliary-chart"/);
  assert.equal(two.match(/class="auxiliary-chart"/g)?.length, 1);
  assert.equal(three.match(/class="auxiliary-chart"/g)?.length, 2);
  assert.match(three, /data-uid="bybit:spot:BTCUSDT" data-timeframe="1m"/);
  assert.match(three, /data-uid="okx:spot:BTC-USDT" data-timeframe="1m"/);
  assert.match(three, /aria-label="Chart instrument 2"/);
  assert.match(three, /aria-label="Chart instrument 3"/);
  assert.equal(three.match(/<option value="bybit:spot:BTCUSDT"/g)?.length, 2);
  const control = renderToStaticMarkup(
    React.createElement(ChartLayoutControl, { value: 3, onChange: () => {} })
  );
  assert.match(control, /aria-label="Chart layout"/);
  assert.match(control, /value="3" aria-label="Three charts" selected=""/);
});
