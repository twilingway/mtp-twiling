import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url)),
  DAY = 86400000,
  NOW = Date.parse("2026-11-25T14:00:00Z");
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise(setImmediate);
const bar = (timestamp) => ({ timestamp, open: 10, high: 12, low: 9, close: 11, volume: 1 });
function fixture({
  view,
  period = 0,
  first = "2000-01-04",
  bars = [],
  provider,
  offline = false,
  viewPromise,
  coverage = [],
  chartMissing = false,
  fastTimeout = false,
  timeframe = "1d",
  rangeDays = 365
} = {}) {
  const calls = [],
    patches = [],
    notices = [],
    cells = new Map(),
    navigator = { onLine: !offline };
  let clock = NOW;
  class Clock extends Date {
    static now() {
      return clock;
    }
  }
  const context = vm.createContext({
    console,
    Date: Clock,
    Map,
    Math,
    Promise,
    AbortController,
    AbortSignal,
    DOMException,
    navigator,
    setTimeout: fastTimeout
      ? (callback) => {
          clock += 5001;
          return setImmediate(callback);
        }
      : setTimeout,
    clearTimeout: fastTimeout ? clearImmediate : clearTimeout
  });
  let state = {
    owner: "owner",
    chartRevision: 0,
    loading: false,
    candles: [],
    preferences: {
      symbol: "SBER",
      instrumentUid: "uid",
      timeframe,
      engine: "tradingview",
      rangeDays,
      indicators: {}
    },
    rows: [{ symbol: "SBER", uid: "uid", first1dayCandleDate: first }],
    drawings: [],
    images: []
  };
  let chart = chartMissing
    ? null
    : {
        source: {
          owner: "owner",
          viewKey: `SBER:${timeframe}:tradingview:${rangeDays}`,
          uid: "uid"
        },
        plotSize: () => ({ width: 800, height: 500 }),
        getView: () => null
      };
  const client = {
    candles: async (symbol, timeframe, range, options) => {
      calls.push({ symbol, timeframe, range, options });
      if (provider) return provider({ range, options, call: calls.length });
      return {
        candles: bars.filter((item) => item.timestamp >= range.from && item.timestamp <= range.to),
        requests: 0,
        cached: true
      };
    }
  };
  const overrides = {
    "services/storage.ts": {
      loadDrawings: async () => [],
      loadImages: async () => [],
      loadCoverage: async () => coverage
    },
    "services/chart-camera.ts": { loadChartView: () => viewPromise ?? Promise.resolve(view) },
    "model/mtp.ts": { activeMtpPeriods: () => (period ? [period] : []) },
    "screens/terminal/controller-bridge.ts": {
      errorText: (error) => error.message,
      isAbort: (error) => error.name === "AbortError",
      viewKey: (p) => `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`
    }
  };
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cells.has(file)) return cells.get(file).exports;
    const module = { exports: {} };
    cells.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`).runInContext(context)(
      (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  const { TerminalHistory } = load("screens/terminal/controller-history.ts"),
    history = new TerminalHistory({
      getState: () => state,
      getClient: () => client,
      getChart: () => chart,
      isAlive: () => true,
      notify: (message) => notices.push(message),
      update: (patch) => {
        patches.push(patch);
        state = { ...state, ...patch };
      }
    });
  return {
    history,
    calls,
    patches,
    notices,
    state: () => state,
    change: (patch) => {
      state = { ...state, ...patch };
    },
    chart: (value) => {
      chart = value;
    }
  };
}

test("saved A requests left2022 plus MTP440 warmup; complete cache uses one provider call and no REST", async () => {
  const left = Date.parse("2022-05-31"),
    bars = Array.from({ length: 2200 }, (_, index) => bar(left - 800 * DAY + index * DAY)),
    f = fixture({
      period: 440,
      bars,
      view: { from: left / 1000, to: Date.parse("2025-10-12") / 1000 }
    });
  await f.history.load();
  assert.equal(f.calls[0].range.from, left - 740 * DAY);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state().historyViewReady, true);
  assert.ok(f.state().candles[0].timestamp < left);
  assert.match(f.state().historyHelp, /0 новых запросов/);
});

test("partial progress cannot consume a saved target before the final covered data", async () => {
  const pending = deferred(),
    left = Date.parse("2022-05-31"),
    final = [bar(left), bar(left + DAY)],
    f = fixture({
      view: { from: left / 1000 },
      provider: ({ options }) => {
        options.onProgress({ cached: true, candles: [bar(NOW - DAY)], completed: 0, total: 1 });
        return pending.promise;
      }
    });
  const loading = f.history.load();
  await tick();
  assert.equal(f.state().historyViewReady, false);
  assert.equal(
    f.patches.some((patch) => "candles" in patch),
    false
  );
  pending.resolve({ candles: final, cached: true, requests: 0 });
  await loading;
  assert.equal(f.state().historyViewReady, true);
  assert.equal(f.patches.filter((patch) => "candles" in patch).length, 1);
});

test("legacy anchor and explicit-left warmup extend until real sparse trade bars are sufficient", async () => {
  const anchor = Date.parse("2024-06-01"),
    bars = Array.from({ length: 700 }, (_, index) =>
      bar(Date.parse("2018-01-01") + index * 7 * DAY)
    );
  for (const view of [
    { barSpace: 8, anchor: { timestamp: anchor, xFraction: 0.5 } },
    { from: anchor / 1000 }
  ]) {
    const f = fixture({ period: 40, bars, first: "2018-01-01", view });
    await f.history.load();
    const before = f.state().candles.filter((item) => item.timestamp < anchor).length;
    assert.ok(before >= (view.anchor ? 90 : 40));
    assert.ok(f.calls.length > 1);
    assert.equal(f.state().historyViewReady, true);
    assert.equal(f.patches.filter((patch) => "candles" in patch).length, 1);
  }
});

test("known listing boundary allows unavailable pre-listing warmup; no view keeps ordinary range", async () => {
  const first = Date.parse("2022-05-31"),
    f = fixture({
      first: "2022-05-31",
      period: 440,
      view: { from: first / 1000 },
      bars: [bar(first), bar(NOW - DAY)]
    });
  await f.history.load();
  assert.equal(f.calls[0].range.from, first);
  assert.equal(f.state().historyViewReady, true);
  const plain = fixture({ period: 440, bars: [bar(NOW - DAY)] });
  await plain.history.load();
  assert.equal(plain.calls[0].range.from, Date.parse("2023-11-16"));
  assert.equal(plain.calls.length, 1);
  assert.equal(plain.state().historyViewReady, true);
});

test("offline needs both enough candles and continuous cached coverage", async () => {
  const left = Date.parse("2022-05-31"),
    right = left + DAY,
    bars = [bar(left), bar(right)];
  for (const covered of [false, true]) {
    const f = fixture({
      offline: true,
      view: { from: left / 1000, to: right / 1000 },
      bars,
      coverage: covered ? [{ from: left, to: right }] : []
    });
    await f.history.load();
    assert.equal(f.calls.length, 1);
    assert.equal(f.state().historyViewReady, covered);
    if (!covered) assert.match(f.state().historyHelp, /Офлайн/);
  }
  const missing = fixture({ offline: true, view: { from: left / 1000 }, bars: [bar(NOW - DAY)] });
  await missing.history.load();
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.state().historyViewReady, false);
});

test("offline restored view remains pending when coverage misses its right side; proven closed-market gaps are allowed", async () => {
  const left = Date.parse("2022-05-31"),
    right = Date.parse("2025-10-12"),
    bars = [bar(left), bar(left + DAY)],
    view = { from: left / 1000, to: right / 1000 };
  for (const coveredTo of [left + DAY, right]) {
    const f = fixture({ offline: true, view, bars, coverage: [{ from: left, to: coveredTo }] });
    await f.history.load();
    assert.equal(f.calls.length, 1);
    assert.equal(f.state().historyViewReady, coveredTo === right);
    if (coveredTo !== right) assert.match(f.state().historyHelp, /покрытие.*не подтверждено/);
  }
  const anchor = Date.parse("2024-06-01"),
    legacyBars = Array.from({ length: 100 }, (_, index) => bar(anchor + (index - 60) * DAY)),
    legacy = fixture({
      offline: true,
      view: { barSpace: 8, anchor: { timestamp: anchor, xFraction: 0.5 } },
      bars: legacyBars,
      coverage: [{ from: legacyBars[0].timestamp, to: legacyBars.at(-1).timestamp }]
    });
  await legacy.history.load();
  assert.equal(
    legacy.state().historyViewReady,
    false,
    "legacy without a saved right edge needs conservative complete coverage"
  );
  assert.match(legacy.state().historyHelp, /покрытие.*не подтверждено/);
});

test("owner, UID and cancellation guards discard stale saved-view awaits and network results", async () => {
  for (const kind of ["owner", "uid", "engine", "cancel"]) {
    const saved = deferred(),
      f = fixture({ viewPromise: saved.promise });
    const loading = f.history.load();
    await tick();
    if (kind === "owner") f.change({ owner: "other" });
    if (kind === "uid") f.change({ rows: [{ symbol: "SBER", uid: "replacement" }] });
    if (kind === "engine") f.change({ preferences: { ...f.state().preferences, engine: "kline" } });
    if (kind === "cancel") f.history.reset();
    saved.resolve({ from: Date.parse("2022-05-31") / 1000 });
    await loading;
    assert.equal(f.calls.length, 0);
    assert.equal(
      f.patches.some((patch) => "candles" in patch),
      false
    );
  }
  for (const kind of ["owner", "uid", "engine", "cancel"]) {
    const pending = deferred(),
      f = fixture({ provider: () => pending.promise });
    const loading = f.history.load();
    await tick();
    if (kind === "owner") f.change({ owner: "other" });
    if (kind === "uid") f.change({ rows: [{ symbol: "SBER", uid: "replacement" }] });
    if (kind === "engine") f.change({ preferences: { ...f.state().preferences, engine: "kline" } });
    if (kind === "cancel") {
      f.history.reset();
      assert.equal(f.calls[0].options.signal.aborted, true);
    }
    pending.resolve({ candles: [bar(NOW - DAY)], cached: true, requests: 0 });
    await loading;
    assert.equal(
      f.patches.some((patch) => "candles" in patch),
      false
    );
  }
});

test("unknown first date stops explicitly after a whole empty year, not a short market gap", async () => {
  const f = fixture({
    first: undefined,
    view: { from: Date.parse("2022-05-31") / 1000 },
    bars: [bar(NOW - DAY)]
  });
  f.change({ rows: [{ symbol: "SBER", uid: "uid" }] });
  await f.history.load();
  assert.equal(f.state().historyViewReady, false);
  assert.match(f.state().historyHelp, /год|граница/);
  assert.ok(f.calls.length > 2 && f.calls.length < 15);
});

test("legacy wait for actual width times out explicitly without querying or applying a partial view", async () => {
  const f = fixture({
    chartMissing: true,
    fastTimeout: true,
    view: { barSpace: 8, anchor: { timestamp: Date.parse("2024-06-01"), xFraction: 0.5 } }
  });
  await f.history.load();
  assert.equal(f.calls.length, 0);
  assert.equal(f.state().historyViewReady, false);
  assert.match(f.state().historyHelp, /область графика/);
});

test("legacy viewport ignores an outgoing chart source and cancellation interrupts the width wait", async () => {
  const anchor = Date.parse("2024-06-01"),
    view = { barSpace: 8, anchor: { timestamp: anchor, xFraction: 0.5 } },
    f = fixture({
      view,
      bars: Array.from({ length: 400 }, (_, index) => bar(anchor - 300 * DAY + index * DAY))
    });
  f.chart({
    source: { owner: "owner", viewKey: "SBER:1d:tradingview:365", uid: "wrong" },
    plotSize: () => ({ width: 8000 })
  });
  const loading = f.history.load();
  await tick();
  assert.equal(f.calls.length, 0);
  f.chart({
    source: { owner: "owner", viewKey: "SBER:1d:tradingview:365", uid: "uid" },
    plotSize: () => ({ width: 80 })
  });
  await loading;
  assert.equal(f.calls[0].range.from, anchor - 23 * DAY);
  assert.equal(f.state().historyViewReady, true);
  const cancel = fixture({ view, chartMissing: true });
  const waiting = cancel.history.load();
  await tick();
  cancel.history.reset();
  await waiting;
  assert.equal(cancel.calls.length, 0);
  assert.equal(cancel.notices.length, 0);
});

test("EMA without MTP requires fifty actual warmup bars before the saved left", async () => {
  const left = Date.parse("2022-05-31"),
    bars = Array.from({ length: 100 }, (_, index) => bar(left + (index - 60) * DAY)),
    f = fixture({ period: 0, view: { from: left / 1000, to: (left + 10 * DAY) / 1000 }, bars });
  f.change({ preferences: { ...f.state().preferences, indicators: { ma: false, ema: true } } });
  await f.history.load();
  assert.equal(f.calls[0].range.from, left - 97 * DAY);
  assert.ok(f.state().candles.filter((item) => item.timestamp < left).length >= 50);
  assert.equal(f.state().historyViewReady, true);
});

test("refresh supersedes a pending smaller-period load and uses the stored target instead of a retired camera", async () => {
  const left = Date.parse("2022-05-31"),
    pending = deferred(),
    bars = Array.from({ length: 100 }, (_, index) => bar(left + (index - 60) * DAY)),
    f = fixture({
      view: { from: left / 1000, to: (left + 10 * DAY) / 1000 },
      provider: ({ range, call }) =>
        call === 1
          ? pending.promise
          : {
              candles: bars.filter(
                (item) => item.timestamp >= range.from && item.timestamp <= range.to
              ),
              cached: true,
              requests: 0
            }
    });
  const old = f.history.load();
  await tick();
  assert.equal(f.state().loading, true);
  f.change({ preferences: { ...f.state().preferences, indicators: { ma: false, ema: true } } });
  f.chart({
    persistView: false,
    source: { owner: "owner", viewKey: "SBER:1d:tradingview:365", uid: "uid" },
    getView: () => assert.fail("retired adapter must not replace the pending saved target")
  });
  await f.history.load(true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.calls[1].range.from, left - 97 * DAY);
  assert.equal(f.state().historyViewReady, true);
  assert.equal(f.state().loading, false);
  const accepted = f.state().candles;
  pending.resolve({ candles: [{ ...bar(left), close: 999 }], cached: true, requests: 0 });
  await old;
  assert.equal(f.state().candles, accepted);
  assert.equal(f.state().historyViewReady, true);
});
test("native monthly restore preserves saved left, calendar warmup and readiness until the final source result", async () => {
  const left = Date.parse("2024-03-01"),
    pending = deferred();
  const bars = Array.from({ length: 38 }, (_, index) => bar(Date.UTC(2023, 9 + index, 1)));
  const f = fixture({
    timeframe: "1M",
    period: 3,
    view: { from: left / 1000, to: Date.parse("2025-06-20") / 1000 },
    provider: ({ options }) => {
      options.onProgress({ cached: true, candles: [bars.at(-1)], completed: 0, total: 1 });
      return pending.promise;
    }
  });
  const loading = f.history.load();
  await tick();
  assert.equal(f.calls[0].timeframe, "1M");
  assert.equal(f.calls[0].range.from, Date.parse("2023-09-01"));
  assert.equal(f.calls[0].options.uid, "uid");
  assert.equal(f.state().historyViewReady, false);
  assert.equal(
    f.patches.some((patch) => "candles" in patch),
    false
  );
  pending.resolve({ candles: bars, cached: true, requests: 0 });
  await loading;
  assert.equal(f.state().historyViewReady, true);
  assert.equal(f.state().loading, false);
  assert.ok(f.state().candles.filter((item) => item.timestamp < left).length >= 3);
});
test("monthly restore backfills sparse history with calendar cursors and keeps offline coverage guards", async () => {
  const left = Date.parse("2024-03-01"),
    old = [4, 5, 6].map((month) => bar(Date.UTC(2023, month, 1)));
  const f = fixture({
    timeframe: "1M",
    period: 3,
    view: { from: left / 1000 },
    provider: ({ call, range }) => ({
      cached: true,
      requests: 0,
      candles:
        call === 1
          ? [bar(Date.parse("2026-11-01"))]
          : old.filter((item) => item.timestamp >= range.from && item.timestamp <= range.to)
    })
  });
  await f.history.load();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].range.from, Date.parse("2023-09-01"));
  assert.equal(f.calls[1].range.from, Date.parse("2023-04-01"));
  assert.equal(f.state().historyViewReady, true);
  const right = Date.parse("2025-06-20"),
    bars = Array.from({ length: 22 }, (_, index) => bar(Date.UTC(2023, 9 + index, 1)));
  for (const coveredTo of [Date.parse("2025-06-01"), right]) {
    const offline = fixture({
      timeframe: "1M",
      period: 3,
      offline: true,
      bars,
      view: { from: left / 1000, to: right / 1000 },
      coverage: [{ from: Date.parse("2023-09-01"), to: coveredTo }]
    });
    await offline.history.load();
    assert.equal(offline.state().historyViewReady, coveredTo === right);
    assert.equal(offline.calls.length, 1);
  }
});
