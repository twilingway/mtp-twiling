import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const now = Date.parse("2024-03-25T12:00:00Z");
function sources(globals = {}, overrides = {}) {
  const context = vm.createContext({
    Date,
    RangeError,
    ArrayBuffer,
    Float64Array,
    Uint8Array,
    Blob,
    TextEncoder,
    TextDecoder,
    URL,
    btoa,
    atob,
    Event,
    CustomEvent,
    EventTarget,
    AbortController,
    AbortSignal,
    DOMException,
    console,
    setTimeout,
    clearTimeout,
    ...globals
  });
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative).replace(/\.js$/, ".ts");
    const key = path.relative(root, filename).replaceAll(path.sep, "/");
    assert.ok(!key.startsWith("../"));
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(key)) return modules.get(key).exports;
    const module = { exports: {} };
    modules.set(key, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
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
  return { load };
}
const model = sources();
const registry = model.load("model/intervals/native-timeframes.ts");
const calendar = model.load("model/intervals/calendar.ts");
const codec = model.load("model/history-codec.ts");
const at = Date.parse;
const plain = (value) => JSON.parse(JSON.stringify(value));
const bar = (timestamp) => ({ timestamp, open: 10, high: 12, low: 9, close: 11, volume: 3 });
function bankFixture() {
  const subscriptions = [],
    requests = [],
    writes = [],
    reads = [],
    transports = [];
  const cached = new Map();
  const navigator = { onLine: true };
  class BankTransport {
    closed = false;
    constructor(token, callbacks) {
      this.callbacks = callbacks;
      transports.push(this);
    }
    send(data) {
      subscriptions.push(data);
    }
    close() {
      this.closed = true;
    }
  }
  const cache = {
    loadHistory: async (owner, uid, timeframe, from, to) => {
      reads.push({ owner, uid, timeframe, from, to });
      return (cached.get(`${owner}:${uid}:${timeframe}`) ?? []).filter(
        (c) => c.timestamp >= from && c.timestamp <= to
      );
    },
    loadCoverage: async () => [],
    saveHistory: async (owner, uid, timeframe, candles, range) => {
      writes.push({ owner, uid, timeframe, candles, range });
      const key = `${owner}:${uid}:${timeframe}`;
      cached.set(key, codec.mergeCandles(cached.get(key) ?? [], candles));
    },
    saveMarket: async () => {}
  };
  const modules = sources(
    { navigator, setTimeout: () => 1, clearTimeout: () => {} },
    {
      "services/tbank-transport.ts": { BankTransport, BankError: class BankError extends Error {} }
    }
  );
  const { TBankClient } = modules.load("services/tbank-client.ts");
  const client = new TBankClient("test-boundary-token", "Test", cache);
  client.owner = "owner-a";
  client.rows = [
    { symbol: "SAME", ticker: "SAME", uid: "uid-a", name: "Fixture", availability: "available" }
  ];
  client.request = async (service, method, body) => {
    requests.push({ service, method, body });
    return {
      candles: [
        {
          time: "2024-03-01T00:00:00Z",
          open: { units: "10" },
          high: { units: "12" },
          low: { units: "9" },
          close: { units: "11" },
          volume: "3"
        }
      ]
    };
  };
  return {
    client,
    cache,
    navigator,
    requests,
    subscriptions,
    writes,
    reads,
    cached,
    deliver: (message) => transports[0].callbacks.data(message)
  };
}

test("all 13 native IDs request, subscribe and cache under the exact owner/UID/interval", async () => {
  const fixture = bankFixture();
  for (const timeframe of registry.NATIVE_TIMEFRAMES) {
    const expected = codec.TIMEFRAMES[timeframe];
    const result = await fixture.client.candles(
      "SAME",
      timeframe,
      { from: at("2024-03-01T00:00:00Z"), to: at("2024-03-25T12:00:00Z") },
      { uid: "uid-a" }
    );
    assert.equal(result.candles.length, 1);
    const request = fixture.requests.at(-1);
    assert.equal(request.body.instrumentId, "uid-a");
    assert.equal(request.body.interval, expected.interval);
    assert.equal(request.body.limit, expected.limit);
    const sub = fixture.subscriptions.at(-1).subscribeCandlesRequest;
    assert.equal(sub.subscriptionAction, "SUBSCRIPTION_ACTION_SUBSCRIBE");
    assert.equal(sub.instruments[0].instrumentId, "uid-a");
    assert.equal(sub.instruments[0].interval, expected.stream);
    const write = fixture.writes.at(-1);
    assert.equal(write.owner, "owner-a");
    assert.equal(write.uid, "uid-a");
    assert.equal(write.timeframe, timeframe);
  }
  assert.equal(fixture.cached.size, 13);
});
test("all 13 cached series remain readable offline without fake network data", async () => {
  const f = bankFixture();
  f.navigator.onLine = false;
  for (const timeframe of registry.NATIVE_TIMEFRAMES) {
    f.cached.set(`owner-a:uid-a:${timeframe}`, [bar(at("2024-03-01T00:00:00Z"))]);
    const result = await f.client.candles(
      "SAME",
      timeframe,
      { from: at("2024-03-01T00:00:00Z"), to: now },
      { uid: "uid-a" }
    );
    assert.equal(result.requests, 0);
    assert.equal(result.cached, true);
    assert.equal(result.candles[0].close, 11);
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.subscriptions.length, 0);
});
test("same UID subscription change cannot save a late old-interval bar into the new cache", async () => {
  const f = bankFixture();
  f.client.subscribeCandles("uid-a", "2m");
  f.client.subscribeCandles("uid-a", "1M");
  const raw = {
    instrumentUid: "uid-a",
    time: "2024-03-01T00:00:00Z",
    open: { units: "10" },
    high: { units: "12" },
    low: { units: "9" },
    close: { units: "11" },
    volume: "3"
  };
  f.deliver({ candle: { ...raw, interval: "SUBSCRIPTION_INTERVAL_2_MIN" } });
  await f.client.flush();
  assert.equal(f.writes.length, 0);
  f.deliver({ candle: { ...raw, interval: "SUBSCRIPTION_INTERVAL_MONTH" } });
  await f.client.flush();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].timeframe, "1M");
  assert.equal(f.writes[0].uid, "uid-a");
  f.deliver({
    candle: { ...raw, instrumentUid: "uid-other", interval: "SUBSCRIPTION_INTERVAL_MONTH" }
  });
  await f.client.flush();
  assert.equal(f.writes.length, 1);
});
test("every native stream persists its own actual interval", async () => {
  const f = bankFixture();
  for (const timeframe of registry.NATIVE_TIMEFRAMES) {
    f.client.subscribeCandles("uid-a", timeframe);
    f.deliver({
      candle: {
        instrumentUid: "uid-a",
        interval: codec.TIMEFRAMES[timeframe].stream,
        time: "2024-03-01T00:00:00Z",
        open: { units: "10" },
        high: { units: "12" },
        low: { units: "9" },
        close: { units: "11" },
        volume: "3"
      }
    });
    await f.client.flush();
    assert.equal(f.writes.at(-1).timeframe, timeframe);
  }
  assert.equal(f.cached.size, 13);
});
test("derived and unknown IDs are rejected before request/subscription/cache access", async () => {
  const f = bankFixture();
  for (const timeframe of ["45m", "3h", "3M", "6M", "12M", "5s", "1y"]) {
    assert.throws(() => f.client.subscribeCandles("uid-a", timeframe), RangeError);
    await assert.rejects(
      f.client.candles("SAME", timeframe, { from: now - 1000, to: now }),
      RangeError
    );
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.subscriptions.length, 0);
  assert.equal(f.reads.length, 0);
});
test("monthly requests and projection use actual leap/year/month boundaries", () => {
  assert.equal(codec.TIMEFRAMES["1M"].ms, null);
  assert.equal(calendar.shiftUtcMonths(at("2024-01-31T12:00:00Z"), 1), at("2024-02-29T12:00:00Z"));
  assert.equal(
    calendar.shiftTimeframe(at("2024-02-01T00:00:00Z"), "1M", 1),
    at("2024-03-01T00:00:00Z")
  );
  const window = calendar.historyRequestWindow({ from: at("2024-03-20T00:00:00Z"), to: now }, "1M");
  assert.equal(window.from, at("2024-02-01T00:00:00Z"));
  const split = codec.splitRanges(
    [{ from: at("2024-01-01T00:00:00Z"), to: at("2035-01-01T00:00:00Z") }],
    "1M"
  );
  assert.equal(split.length, 2);
  assert.equal(split[0].to, at("2033-12-01T00:00:00Z"));
  const adapter = model.load("charts/adapter.ts");
  const data = [bar(at("2024-01-01T00:00:00Z")), bar(at("2024-02-01T00:00:00Z"))];
  assert.equal(adapter.timeForLogical(data, 2, null), at("2024-03-01T00:00:00Z"));
  assert.equal(adapter.timeForLogical(data, -1, null), at("2023-12-01T00:00:00Z"));
  assert.equal(adapter.logicalForTime(data, at("2024-03-01T00:00:00Z"), null), 2);
  assert.equal(adapter.logicalForTime(data, at("2024-02-15T12:00:00Z"), null), 1.5);
});
test("backup and stored history validators allow exactly native IDs and retain favorites", () => {
  const backup = model.load("model/backup-format.ts"),
    storageTypes = model.load("services/types.ts");
  for (const timeframe of registry.NATIVE_TIMEFRAMES) {
    assert.equal(backup.isTimeframe(timeframe), true);
    assert.equal(storageTypes.isTimeframe(timeframe), true);
    assert.equal(
      backup.isProfilePreferences({ timeframe, favoriteIntervals: ["1m", "1M", "3M"] }),
      true
    );
    const buffer = codec.encodeCandles([bar(at("2024-03-01T00:00:00Z"))]);
    const stored = storageTypes.historyRecord({
      id: `owner:uid:${timeframe}:2024-03-01`,
      owner: "owner",
      uid: "uid",
      timeframe,
      day: "2024-03-01",
      data: buffer
    });
    assert.equal(stored.timeframe, timeframe);
    const document = backup.validateBackup({
      application: "personal-terminal",
      schemaVersion: 1,
      drawings: [],
      images: [],
      layout: { timeframe, favoriteIntervals: ["1m", "1M"] },
      history: [{ uid: "uid", timeframe, day: "2024-03-01", data: backup.toBase64(buffer) }]
    });
    assert.equal(document.layout.timeframe, timeframe);
    assert.equal(codec.decodeCandles(backup.fromBase64(document.history[0].data))[0].close, 11);
  }
  for (const value of ["3h", "3M", "1y", "5s", null]) {
    assert.equal(backup.isTimeframe(value), false);
    assert.equal(storageTypes.isTimeframe(value), false);
  }
  assert.equal(backup.isProfilePreferences({ timeframe: "1d" }), true);
  assert.equal(backup.isProfilePreferences({ favoriteIntervals: ["1m", "1m"] }), false);
  assert.equal(backup.isProfilePreferences({ favoriteIntervals: ["malformed"] }), false);
  const favorite = model.load("model/intervals/favorites.ts");
  const before = ["1m", "1d"];
  assert.deepEqual(plain(favorite.toggleIntervalFavorite(before, "1M")), ["1m", "1d", "1M"]);
  assert.deepEqual(before, ["1m", "1d"]);
});
test("native monthly countdown uses the real final trading day, never 30 days", () => {
  const clock = model.load("model/candle-clock.ts");
  const timestamp = at("2024-02-01T00:00:00Z"),
    current = at("2024-02-28T10:00:00Z");
  const days = [28, 29].map((day) => ({
    date: at(`2024-02-${day}T00:00:00Z`),
    isTradingDay: true,
    start: at(`2024-02-${day}T09:00:00Z`),
    end: at(`2024-02-${day}T18:00:00Z`),
    intervals: [{ start: at(`2024-02-${day}T09:00:00Z`), end: at(`2024-02-${day}T18:00:00Z`) }]
  }));
  assert.equal(clock.candleCloseAt(timestamp, "1M", current, days), at("2024-02-29T18:00:00Z"));
  assert.equal(clock.candleCloseAt(timestamp, "1M", current, days.slice(0, 1)), null);
  for (const [timeframe, minutes] of [
    ["2m", 2],
    ["3m", 3],
    ["10m", 10],
    ["2h", 120],
    ["4h", 240]
  ])
    assert.equal(clock.candleDuration(timeframe), minutes * 60_000);
});
test("actual day/month boundary ticks replace repetitive labels in both engines", () => {
  const axis = model.load("model/intervals/axis-ticks.ts");
  const data = Array.from({ length: 91 }, (_, index) =>
    bar(at("2024-01-01T00:00:00Z") + index * 86_400_000)
  );
  const ticks = axis.calendarAxisTicks(data, "1d", {
    from: 0,
    to: 90,
    width: 600,
    coordinate: (index) => index * 6
  });
  assert.deepEqual(plain(ticks.map((t) => t.text)), ["2024", "фев", "мар"]);
  assert.equal(ticks[1].value, at("2024-02-01T00:00:00Z"));
  const hours = Array.from({ length: 72 }, (_, index) =>
    bar(at("2024-02-28T00:00:00Z") + index * 3_600_000)
  );
  const daily = axis.calendarAxisTicks(hours, "1h", {
    from: 0,
    to: 71,
    width: 500,
    coordinate: (index) => index * 6
  });
  assert.equal(daily.length, 3);
  assert.ok(daily.every((t) => new Date(t.value).getUTCHours() === 0));
  assert.equal(axis.lightweightCalendarLabel(at("2024-02-10T00:00:00Z"), "1d", 2, false), "");
  assert.equal(axis.lightweightCalendarLabel(at("2024-02-01T00:00:00Z"), "1d", 1, false), "фев");
  assert.equal(axis.lightweightCalendarLabel(at("2024-02-10T10:00:00Z"), "1h", 3, false), "");
  assert.equal(axis.lightweightCalendarLabel(at("2024-02-10T10:00:00Z"), "1h", 3, true), "10:00");
  const detail = axis.calendarAxisTicks(hours, "1h", {
    from: 24,
    to: 30,
    width: 500,
    coordinate: (index) => (index - 24) * 40
  });
  assert.ok(detail.some((t) => t.text.includes(":")));
});
test("KLine 9 custom axis installs calendar tick selection and releases its data source", () => {
  let template;
  const modules = sources(
    {},
    {
      klinecharts: {
        registerXAxis: (value) => {
          template = value;
        }
      }
    }
  );
  const attach = modules.load("charts/kline-calendar-axis.ts").attachCalendarXAxis;
  let installed;
  const chart = {
    setPaneOptions: (options) => {
      installed = options;
    },
    convertToPixel: (point) => ({ x: point.dataIndex * 6 }),
    getVisibleRange: () => ({ from: 0, to: 91, realFrom: 0, realTo: 90 })
  };
  let data = [];
  const dispose = attach(chart, () => data, "1d");
  assert.equal(installed.id, "x_axis_pane");
  assert.equal(installed.axisOptions.name, template.name);
  data = Array.from({ length: 91 }, (_, index) =>
    bar(at("2024-01-01T00:00:00Z") + index * 86_400_000)
  );
  const params = {
    range: { from: 0, to: 90 },
    bounding: { width: 600 },
    defaultTicks: [{ coord: 0, value: 1, text: "old" }]
  };
  assert.deepEqual(plain(template.createTicks(params).map((t) => t.text)), ["2024", "фев", "мар"]);
  dispose();
  assert.deepEqual(plain(template.createTicks(params)), params.defaultTicks);
});
test("monthly drawing visibility never inherits a disabled weekly rule", () => {
  const visible = model.load("model/intervals/drawing-visibility.ts").drawingVisibleOnInterval;
  const rules = {
    weeks: { enabled: false, from: 1, to: 52 },
    hours: { enabled: true, from: 1, to: 2 }
  };
  assert.equal(visible(rules, "1w"), false);
  assert.equal(visible(rules, "1M"), true);
  assert.equal(visible(rules, "2h"), true);
  assert.equal(visible(rules, "4h"), false);
});
test("Lightweight calendar grid draws only actual monthly/day boundaries, independently of empty tick labels", () => {
  const draw = model.load("charts/lightweight-calendar-grid.ts").paintCalendarGrid;
  const starts = [],
    ends = [];
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    setLineDash() {},
    stroke() {},
    moveTo: (x, y) => starts.push({ x, y }),
    lineTo: (x, y) => ends.push({ x, y })
  };
  const data = Array.from({ length: 91 }, (_, index) =>
    bar(at("2024-01-01T00:00:00Z") + index * 86_400_000)
  );
  const count = draw(context, data, "1d", {
    from: 0,
    to: 90,
    width: 600,
    height: 400,
    color: "#ddd",
    pixelRatio: 2,
    coordinate: (index) => index * 6
  });
  assert.equal(count, 3);
  assert.deepEqual(
    starts.map((p) => p.x),
    [0.25, 186.25, 360.25]
  );
  assert.ok(ends.every((p) => p.y === 400));
  assert.equal(context.lineWidth, 0.5);
  starts.length = 0;
  ends.length = 0;
  const hours = Array.from({ length: 72 }, (_, index) =>
    bar(at("2024-02-28T00:00:00Z") + index * 3_600_000)
  );
  assert.equal(
    draw(context, hours, "1h", {
      from: 0,
      to: 71,
      width: 500,
      height: 300,
      color: "#ddd",
      coordinate: (index) => index * 6
    }),
    3
  );
  assert.deepEqual(
    starts.map((p) => p.x),
    [0.5, 144.5, 288.5]
  );
  starts.length = 0;
  const minuteBars = Array.from({ length: 91 }, (_, index) =>
    bar(at("2024-01-01T00:00:00Z") + index * 60_000)
  );
  assert.equal(
    draw(context, minuteBars, "1m", {
      from: 0,
      to: 90,
      width: 600,
      height: 400,
      color: "#ddd",
      coordinate: (index) => index * 6
    }),
    7
  );
  assert.deepEqual(
    starts.map((point) => point.x),
    [0.5, 90.5, 180.5, 270.5, 360.5, 450.5, 540.5]
  );
});
