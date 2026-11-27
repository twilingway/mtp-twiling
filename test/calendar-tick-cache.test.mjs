import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const source = sourceLoader();
const axis = source("model/intervals/axis-ticks.ts");
const { calendarAxisDisplay } = source("i18n/calendar-axis.ts");
const bars = (start, count, step = 1800000) =>
  Array.from({ length: count }, (_, index) => ({ timestamp: Date.parse(start) + index * step }));
function instrument() {
  let calculations = 0;
  const load = sourceLoader({
    "model/intervals/axis-ticks.ts": {
      ...axis,
      calendarAxisTicks: (...args) => {
        calculations++;
        return axis.calendarAxisTicks(...args);
      }
    }
  });
  return {
    load,
    Cache: load("model/intervals/axis-ticks-cache.ts").CalendarAxisTicksCache,
    count: () => calculations
  };
}
const optionsFor = (data, timeframe = "30m", timeZone = "Europe/Moscow") => ({
  revision: 0,
  from: 0,
  to: data.length - 1,
  width: 800,
  coordinate: (index) => (index * 800) / Math.max(1, data.length),
  display: calendarAxisDisplay(timeframe, { timeZone, locale: "ru" })
});

test("one-entry cache matches native DST, Kathmandu, D/W/M and future ticks exactly", () => {
  const monthly = Array.from({ length: 20 }, (_, index) => ({
    timestamp: Date.UTC(2025, index, 1)
  }));
  const cases = [
    ["30m", "America/New_York", bars("2026-03-07T00:00:00Z", 180)],
    ["30m", "America/New_York", bars("2026-10-31T00:00:00Z", 180)],
    ["2m", "Asia/Kathmandu", bars("2026-03-03T00:00:00Z", 800, 120000)],
    ["1d", "America/New_York", bars("2025-12-01T00:00:00Z", 100, 86400000)],
    ["1w", "Europe/Moscow", bars("2025-01-01T00:00:00Z", 80, 604800000)],
    ["1M", "Europe/Moscow", monthly]
  ];
  for (const [timeframe, zone, data] of cases) {
    const { Cache } = instrument();
    const cache = new Cache();
    for (const locale of ["ru", "en"]) {
      const options = {
        ...optionsFor(data, timeframe, zone),
        to: data.length + 160,
        coordinate: (index) => (index * 800) / (data.length + 160),
        display: calendarAxisDisplay(timeframe, { timeZone: zone, locale })
      };
      const expected = axis.calendarAxisTicks(data, timeframe, options);
      const actual = cache.get(data, timeframe, options);
      assert.deepEqual(actual, expected);
      assert.equal(
        cache.get(data, timeframe, { ...options, coordinate: options.coordinate.bind(null) }),
        actual
      );
      const whitespace = {
        ...options,
        from: data.length + 1,
        to: data.length + 8,
        coordinate: (index) => ((index - data.length - 1) * 800) / 7
      };
      assert.deepEqual(
        cache.get(data, timeframe, whitespace),
        axis.calendarAxisTicks(data, timeframe, whitespace),
        "a viewport entirely in future whitespace keeps exact calendar ticks"
      );
    }
  }
});

test("cache keys are exact, signed and revision-based; hits do not walk date data", () => {
  const data = bars("2026-01-01T00:00:00Z", 240);
  const { Cache, count } = instrument();
  const cache = new Cache();
  let options = optionsFor(data);
  const first = cache.get(data, "30m", options);
  const noWalk = new Proxy(data, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) assert.fail("cache hit walked a timestamp");
      return Reflect.get(target, key);
    }
  });
  assert.equal(
    cache.get(noWalk, "30m", { ...options, coordinate: (index) => (index * 800) / 240 }),
    first
  );
  assert.equal(count(), 1);
  for (const change of [
    { from: -0.000000001 },
    { to: 239.000000001 },
    { width: 800.000000001 },
    { coordinate: (index) => (index * 800) / 240 + 0.000000001 },
    { coordinate: (index) => index * (800 / 240 + 0.000000001) },
    { coordinate: (index) => -index * (800 / 240 + 0.000000001) },
    { display: calendarAxisDisplay("30m", { timeZone: "Asia/Kathmandu", locale: "en" }) },
    { revision: 1 }
  ]) {
    options = { ...options, ...change };
    const before = count();
    assert.deepEqual(cache.get(data, "30m", options), axis.calendarAxisTicks(data, "30m", options));
    assert.equal(count(), before + 1);
  }
  const before = count();
  cache.get(data, "1d", options);
  assert.equal(count(), before + 1, "timeframe is part of the key");
  cache.get(data, "30m", options);
  assert.equal(count(), before + 2, "only the most recent result is retained");
  cache.clear();
  cache.get(data, "30m", options);
  assert.equal(count(), before + 3);
});

test("explicit revision covers interior timestamp changes, append, prepend and empty data", () => {
  let data = bars("2026-01-01T00:00:00Z", 240);
  const { Cache, count } = instrument();
  const cache = new Cache();
  let options = optionsFor(data);
  const first = cache.get(data, "30m", options);
  data[120] = { ...data[120], open: 4, high: 5, low: 3, close: 4, volume: 999 };
  assert.equal(cache.get(data, "30m", options), first);
  assert.equal(count(), 1);
  for (const next of [
    data.map((bar, index) => (index === 120 ? { ...bar, timestamp: bar.timestamp + 60000 } : bar)),
    [...data, { timestamp: data.at(-1).timestamp + 1800000 }],
    [{ timestamp: data[0].timestamp - 1800000 }, ...data],
    []
  ]) {
    data = next;
    options = { ...options, revision: options.revision + 1 };
    assert.deepEqual(cache.get(data, "30m", options), axis.calendarAxisTicks(data, "30m", options));
  }
  assert.equal(count(), 5);
  const valid = bars("2026-01-01T00:00:00Z", 240);
  cache.get(valid, "30m", options);
  const before = count();
  for (const coordinate of [() => NaN, () => Infinity, () => 0])
    assert.deepEqual(cache.get(valid, "30m", { ...options, coordinate }), []);
  cache.get(valid, "30m", options);
  assert.equal(count(), before + 4, "invalid projection releases the previous result");
});

function canvas() {
  const calls = [];
  return {
    calls,
    save() {},
    restore() {},
    scale() {},
    setLineDash() {},
    beginPath() {},
    stroke() {
      calls.push(["stroke"]);
    },
    moveTo(x, y) {
      calls.push(["move", x, y]);
    },
    lineTo(x, y) {
      calls.push(["line", x, y]);
    },
    measureText: (text) => ({ width: text.length * 6 }),
    fillText(text, x, y) {
      calls.push(["text", text, x, y]);
    },
    clearRect() {
      calls.length = 0;
    }
  };
}

test("shared binding derives grid+axis once, but paints every cleared Y/DPR/height frame", () => {
  const data = bars("2025-01-01T00:00:00Z", 15094);
  const { load, count } = instrument();
  const { lightweightCalendar } = load("charts/lightweight-calendar.ts");
  let shift = 0;
  const chart = {
    timeScale: () => ({
      getVisibleLogicalRange: () => ({ from: 0, to: data.length - 1 }),
      logicalToCoordinate: (index) => (index * 800) / data.length + shift
    })
  };
  const binding = lightweightCalendar(
    chart,
    {
      timeframe: "30m",
      settings: { grid: true },
      locale: "ru",
      timeZone: "Europe/Moscow"
    },
    () => data
  );
  const grid = canvas(),
    axisCanvas = canvas();
  const paint = (height, ratio) => {
    grid.clearRect();
    axisCanvas.clearRect();
    binding.paintGrid(grid, 800, height, ratio);
    binding
      .timeAxisPaneViews()[0]
      .renderer()
      .draw({
        useBitmapCoordinateSpace: (draw) =>
          draw({
            context: axisCanvas,
            horizontalPixelRatio: ratio,
            verticalPixelRatio: ratio,
            bitmapSize: { width: 800 * ratio, height: 28 * ratio }
          })
      });
    assert.ok(grid.calls.some(([kind]) => kind === "stroke"));
    assert.ok(axisCanvas.calls.some(([kind]) => kind === "text"));
    assert.ok(grid.calls.filter(([kind]) => kind === "line").every(([, , y]) => y === height));
  };
  paint(708, 2.75);
  assert.equal(count(), 1);
  for (let index = 0; index < 10; index++) paint(600 + index, index % 2 ? 1 : 2.75);
  assert.equal(count(), 1, "Y/height/DPR repaint must not derive ticks or dates again");
  data[0] = { ...data[0], close: 123, volume: 456 };
  paint(700, 1);
  assert.equal(count(), 1);
  shift = 0.000000001;
  paint(700, 1);
  assert.equal(count(), 2);
  binding.invalidate();
  paint(700, 1);
  assert.equal(count(), 3);
  binding.dispose();
  grid.clearRect();
  axisCanvas.clearRect();
  binding.paintGrid(grid, 800, 700, 1);
  binding
    .timeAxisPaneViews()[0]
    .renderer()
    .draw({
      useBitmapCoordinateSpace: (draw) =>
        draw({
          context: axisCanvas,
          horizontalPixelRatio: 1,
          verticalPixelRatio: 1,
          bitmapSize: { width: 800, height: 28 }
        })
    });
  assert.equal(count(), 3, "stale views cannot repopulate the cache after dispose");
  assert.deepEqual(grid.calls, []);
  assert.deepEqual(axisCanvas.calls, []);
});

test("real adapter invalidates setData and temporal insertions but retains same-time OHLC updates", () => {
  const fixture = nativeFixture("lightweight");
  const { CalendarAxisTicksCache } = fixture.load("model/intervals/axis-ticks-cache.ts");
  const original = CalendarAxisTicksCache.prototype.clear;
  let clears = 0;
  CalendarAxisTicksCache.prototype.clear = function () {
    clears++;
    return original.call(this);
  };
  const data = bars("2026-01-01T00:00:00Z", 240, 86400000).map((bar) => ({
    ...bar,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000
  }));
  try {
    fixture.adapter.setData(data, false);
    assert.equal(clears, 1);
    fixture.adapter.updateBar({ ...data.at(-1), close: 106, volume: 2000 });
    fixture.adapter.updateBar({ ...data[120], high: 111 });
    assert.equal(clears, 1, "existing last and historical timestamps retain the cache");
    fixture.adapter.updateBar({ ...data.at(-1), timestamp: data.at(-1).timestamp + 86400000 });
    fixture.adapter.updateBar({ ...data[0], timestamp: data[0].timestamp - 86400000 });
    assert.equal(clears, 3);
    fixture.adapter.setData(
      data.map((bar, index) =>
        index === 120 ? { ...bar, timestamp: bar.timestamp + 60000 } : bar
      ),
      false
    );
    assert.equal(
      clears,
      4,
      "interior timestamp replacement invalidates despite unchanged endpoints"
    );
    fixture.adapter.setData(data, false);
    assert.equal(clears, 5, "every setData invalidates, including restored timestamps");
    fixture.adapter.destroy();
    assert.equal(clears, 6);
  } finally {
    CalendarAxisTicksCache.prototype.clear = original;
  }
});
