import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function frames() {
  let next = 0;
  const callbacks = new Map();
  return {
    frame(callback) {
      callbacks.set(++next, callback);
      return next;
    },
    cancel: (id) => callbacks.delete(id),
    count: () => callbacks.size,
    async advance() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    }
  };
}
const load = createSourceLoader({ react: React, "react/jsx-runtime": jsxRuntime });
const { ChartFitSession } = load("screens/terminal/chart-fit-session.js");

test("busy publishes before fit, with a paint opportunity and two native settle frames", async () => {
  const scheduler = frames(),
    session = new ChartFitSession(scheduler),
    events = [];
  session.subscribe(() => events.push(session.getSnapshot() ? "visible" : "hidden"));
  const operation = {
    current: () => true,
    apply: () => events.push("fit"),
    signature: () => "settled",
    watch: () => () => events.push("unsubscribed")
  };
  const pending = session.request(operation);
  assert.equal(session.request(operation), pending);
  assert.deepEqual(events, ["visible"]);
  await scheduler.advance();
  assert.deepEqual(events, ["visible"]);
  await scheduler.advance();
  assert.deepEqual(events, ["visible", "fit"]);
  await scheduler.advance();
  assert.equal(session.getSnapshot(), true);
  await scheduler.advance();
  assert.equal(await pending, "completed");
  assert.deepEqual(events, ["visible", "fit", "unsubscribed", "hidden"]);
  assert.equal(scheduler.count(), 0);
});

test("native settle follows changing readbacks and unavailable readback cannot hang busy", async () => {
  for (const signatures of [["old", "new", "new"], Array(8).fill(null)]) {
    const scheduler = frames(),
      session = new ChartFitSession(scheduler);
    let reads = 0;
    const pending = session.request({
      current: () => true,
      apply: () => {},
      signature: () => signatures[reads++],
      watch: () => () => {}
    });
    for (let i = 0; i < signatures.length + 2; i++) await scheduler.advance();
    assert.equal(await pending, "completed");
    assert.equal(reads, signatures.length);
    assert.equal(session.getSnapshot(), false);
    assert.equal(scheduler.count(), 0);
  }
});

test("cancel resolves without another frame and an old finalizer cannot hide a new job", async () => {
  const scheduler = frames(),
    session = new ChartFitSession(scheduler);
  let applies = 0,
    stops = 0;
  const operation = {
    current: () => true,
    apply: () => applies++,
    signature: () => "settled",
    watch: () => () => stops++
  };
  const old = session.request(operation);
  session.cancel();
  assert.equal(session.getSnapshot(), false);
  assert.equal(scheduler.count(), 0);
  const current = session.request(operation);
  assert.equal(await old, "cancelled");
  assert.equal(session.getSnapshot(), true);
  for (let i = 0; i < 4; i++) await scheduler.advance();
  assert.equal(await current, "completed");
  assert.equal(applies, 1);
  assert.equal(stops, 2);
});

test("adapter errors reject and release busy so another fit can run", async () => {
  const scheduler = frames(),
    session = new ChartFitSession(scheduler),
    error = new Error("fit");
  const pending = session.request({
    current: () => true,
    apply: () => {
      throw error;
    },
    signature: () => "settled",
    watch: () => () => {}
  });
  const rejected = assert.rejects(pending, error);
  await scheduler.advance();
  await scheduler.advance();
  await rejected;
  assert.equal(session.getSnapshot(), false);
  assert.equal(scheduler.count(), 0);
});

test("cancellation after the frame callback but before its promise resumes prevents apply", async () => {
  const callbacks = [];
  const session = new ChartFitSession({
    frame: (callback) => callbacks.push(callback),
    cancel: () => {}
  });
  let applies = 0;
  const pending = session.request({
    current: () => true,
    apply: () => applies++,
    signature: () => "settled",
    watch: () => () => {}
  });
  callbacks.shift()();
  await Promise.resolve();
  callbacks.shift()();
  session.cancel();
  assert.equal(await pending, "cancelled");
  assert.equal(applies, 0);
  assert.equal(session.getSnapshot(), false);
});

function controllerFixture() {
  let state = {
    owner: "guest",
    chartRevision: 1,
    marketReady: true,
    preferences: {
      symbol: "BTC",
      instrumentUid: "btc",
      timeframe: "1d",
      engine: "tradingview",
      rangeDays: 365,
      chartSettings: {}
    },
    rows: [{ symbol: "BTC", uid: "btc" }]
  };
  let session = {},
    cloud = {};
  const listeners = new Set(),
    calls = [],
    notices = [];
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => session,
    cloudSessionKey: () => cloud,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: (message) => notices.push(message),
    chart: {
      source: { owner: "guest", uid: "btc", viewKey: "BTC:1d:tradingview:365" },
      fit: () => calls.push("fit"),
      beginViewInteraction: () => calls.push("begin"),
      endViewInteraction: () => calls.push("end"),
      getView: () => ({ camera: { barSpace: 1, rightOffsetBars: 0 } })
    }
  };
  const { chartFitProgress } = load("screens/terminal/chart-fit-controller.js");
  const progress = chartFitProgress(controller),
    host = { isConnected: true };
  const detach = progress.attach(host);
  return {
    controller,
    progress,
    calls,
    notices,
    host,
    detach,
    listeners: () => listeners.size,
    update(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    preferences(patch) {
      this.update({ preferences: { ...state.preferences, ...patch } });
    },
    session() {
      session = {};
      this.update({});
    },
    cloud() {
      cloud = {};
      this.update({});
    }
  };
}
function browserFrames(context) {
  const scheduler = frames();
  context.mock.method(globalThis, "requestAnimationFrame", scheduler.frame);
  context.mock.method(globalThis, "cancelAnimationFrame", scheduler.cancel);
  return scheduler;
}
// Node has no browser scheduler; mocks restore these after each test.
globalThis.requestAnimationFrame ??= () => {
  throw new Error("unexpected RAF");
};
globalThis.cancelAnimationFrame ??= () => {};

test("each stale scope cancels before touching either adapter", async (context) => {
  const scheduler = browserFrames(context);
  const transitions = [
    (f) => f.update({ owner: "another" }),
    (f) => f.preferences({ symbol: "ETH" }),
    (f) => f.preferences({ instrumentUid: "another-btc" }),
    (f) => f.preferences({ timeframe: "1h" }),
    (f) => f.preferences({ engine: "kline" }),
    (f) => f.preferences({ chartSettings: { chartType: "hollowCandles" } }),
    (f) => f.update({ chartRevision: 2 }),
    (f) => f.update({ importingBackup: true }),
    (f) => f.update({ profileTransition: true }),
    (f) => f.update({ backupBusy: true }),
    (f) => f.session(),
    (f) => f.cloud(),
    (f) => f.detach(),
    (f) => {
      f.host.isConnected = false;
      f.update({});
    },
    (f) => {
      f.controller.chart.retired = true;
      f.update({});
    },
    (f) => {
      f.controller.chart = { ...f.controller.chart, fit: () => f.calls.push("replacement-fit") };
      load("screens/terminal/chart-adapter-ready.js")
        .chartAdapterReadySignal(f.controller)
        .publish();
    }
  ];
  for (const change of transitions) {
    const f = controllerFixture(),
      pending = f.progress.fit(f.controller);
    await scheduler.advance();
    change(f);
    assert.equal(f.progress.getSnapshot(), false);
    assert.equal(await pending, "cancelled");
    assert.deepEqual(f.calls, []);
    assert.equal(f.listeners(), 0);
    assert.equal(scheduler.count(), 0);
    f.detach();
  }
});

test("busy is scoped to one panel and camera interaction stays around the existing fit", async (context) => {
  const scheduler = browserFrames(context),
    active = controllerFixture(),
    other = controllerFixture();
  const pending = active.progress.fit(active.controller);
  assert.equal(active.progress.fit(active.controller), pending);
  assert.equal(other.progress.getSnapshot(), false);
  for (let i = 0; i < 4; i++) await scheduler.advance();
  assert.equal(await pending, "completed");
  assert.deepEqual(active.calls, ["begin", "fit", "end"]);
  assert.deepEqual(other.calls, []);
  assert.equal(active.listeners(), 0);
  active.detach();
  other.detach();
});

test("entrypoint reports one fit error and releases controls", async (context) => {
  const scheduler = browserFrames(context),
    f = controllerFixture();
  f.controller.chart.fit = () => {
    throw new Error("native fit failed");
  };
  const { requestChartFit } = load("screens/terminal/chart-fit-controller.js");
  requestChartFit(f.controller);
  requestChartFit(f.controller);
  await scheduler.advance();
  await scheduler.advance();
  assert.deepEqual(f.notices, ["native fit failed"]);
  assert.equal(f.progress.getSnapshot(), false);
  assert.equal(scheduler.count(), 0);
  f.detach();
});

test("progress and both button variants render from source without a DOM or portal", async (context) => {
  const scheduler = browserFrames(context),
    f = controllerFixture();
  const { TerminalContext } = load("screens/terminal/context.js");
  const { ChartFitProgress } = load("screens/terminal/ChartFitProgress.js");
  const { ChartFitButton } = load("screens/terminal/ChartFitButton.js");
  const { setDisplayPreferences } = load("i18n/preferences.js");
  const render = (component, props) =>
    renderToStaticMarkup(
      React.createElement(
        TerminalContext.Provider,
        { value: f.controller },
        React.createElement(component, props)
      )
    );
  assert.doesNotMatch(render(ChartFitProgress), /role="status"/);
  const pending = f.progress.fit(f.controller);
  const busy = render(ChartFitProgress, { height: 160 });
  assert.match(busy, /height:160px/);
  assert.match(busy, /role="status" aria-live="polite"/);
  assert.match(busy, /Подбираем масштаб…/);
  assert.equal((busy.match(/<span style=/g) ?? []).length, 10);
  assert.match(render(ChartFitButton), /id="fit-chart".*disabled=""/);
  assert.match(render(ChartFitButton, { menu: true }), /role="menuitem".*disabled=""/);
  setDisplayPreferences({ locale: "en" });
  assert.match(render(ChartFitProgress), /Fitting chart…/);
  f.detach();
  assert.equal(await pending, "cancelled");
  assert.equal(scheduler.count(), 0);
  assert.doesNotMatch(render(ChartFitProgress), /role="status"|watchlist-loading-chart/);
  setDisplayPreferences({ locale: "ru" });
});

test("aria-busy belongs to the chart, outside its announcing status, and cleans up on unmount", () => {
  const attributes = new Map(),
    effects = [];
  let detached = false;
  const chart = {
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key)
  };
  const progress = {
    getSnapshot: () => true,
    subscribe: () => () => {},
    attach: () => () => {
      detached = true;
    }
  };
  const ui = createSourceLoader({
    react: {
      useEffect: (effect) => effects.push(effect),
      useRef: () => ({ current: { parentElement: { querySelector: () => chart } } }),
      useSyncExternalStore: (_subscribe, snapshot) => snapshot()
    },
    "react/jsx-runtime": jsxRuntime,
    "screens/terminal/context.js": { useTerminalController: () => ({}) },
    "screens/terminal/chart-fit-controller.js": { chartFitProgress: () => progress }
  });
  const { ChartFitProgress } = ui("screens/terminal/ChartFitProgress.js");
  const markup = renderToStaticMarkup(ChartFitProgress({ height: 200 }));
  assert.match(markup, /role="status"/);
  assert.doesNotMatch(markup, /aria-busy/);
  const cleanups = effects.map((effect) => effect());
  assert.equal(attributes.get("aria-busy"), "true");
  for (const cleanup of cleanups) cleanup?.();
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(detached, true);
});
