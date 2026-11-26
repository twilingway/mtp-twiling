import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const action = "crosshair";
const main = "main";
const load = createSourceLoader({
  klinecharts: { ActionType: { OnCrosshairChange: action }, DomPosition: { Main: main } }
});
const { linkedBarIndex, linkedTimeIndices } = load("charts/layout-link.js");
const { klineLink } = load("charts/kline-link.js");
const { lightweightLink } = load("charts/lightweight-link.js");

const minute = 60_000;
const start = Date.UTC(2026, 0, 2, 20);
const monday = Date.UTC(2026, 0, 5, 9);
const candle = (timestamp, close) => ({ timestamp, open: close, high: close, low: close, close });
const data = [
  candle(start, 45),
  candle(start + minute, 48),
  candle(start + 2 * minute, 52),
  candle(monday, 67),
  candle(monday + minute, 65)
];

test("linked crosshairs resolve actual candles in their own intervals", () => {
  assert.equal(linkedBarIndex(data, start - 1, "1m"), null);
  assert.equal(linkedBarIndex(data, start + minute - 1, "1m"), 0);
  assert.equal(linkedBarIndex(data, start + minute, "1m"), 1);
  assert.equal(linkedBarIndex(data, start + 4 * minute, "1m"), null);
  assert.equal(linkedBarIndex(data, monday + minute + 10, "1m"), 4);
  assert.equal(linkedBarIndex(data, monday + 2 * minute, "1m"), null);
  assert.equal(linkedBarIndex(data, NaN, "1m"), null);
  assert.equal(linkedBarIndex([], start, "1m"), null);
  const quarterHour = [candle(start, 140), candle(start + 15 * minute, 150)];
  assert.equal(linkedBarIndex(quarterHour, start + 9 * minute, "15m"), 0);
  const monthly = [candle(Date.UTC(2026, 1, 1), 30), candle(Date.UTC(2026, 2, 1), 40)];
  assert.equal(linkedBarIndex(monthly, Date.UTC(2026, 1, 28, 23), "1M"), 0);
  assert.equal(linkedBarIndex(monthly, Date.UTC(2026, 2, 1), "1M"), 1);
  assert.equal(linkedBarIndex(monthly, Date.UTC(2026, 3, 1), "1M"), null);
});

test("linked windows clamp partial overlap to loaded data without inventing a future range", () => {
  assert.deepEqual(linkedTimeIndices(data, { kind: "time", to: start + minute / 2 }, "1m"), {
    to: 0.5
  });
  assert.deepEqual(linkedTimeIndices(data, { kind: "time", to: monday + 10 * minute }, "1m"), {
    to: 4
  });
  assert.deepEqual(
    linkedTimeIndices(data, { kind: "dateRange", from: start - minute, to: monday }, "1m"),
    { from: 0, to: 3 }
  );
  assert.equal(linkedTimeIndices(data, { kind: "time", to: start - minute }, "1m"), null);
  assert.equal(
    linkedTimeIndices(data, { kind: "dateRange", from: monday + 2 * minute, to: Infinity }, "1m"),
    null
  );
  assert.equal(
    linkedTimeIndices(
      data,
      { kind: "dateRange", from: start - 2 * minute, to: start - minute },
      "1m"
    ),
    null
  );
});

test("Lightweight links native position without replaying it or wiping a new local hover", (t) => {
  const actions = [];
  const published = [];
  const frames = new Map();
  const savedRequest = globalThis.requestAnimationFrame;
  const savedCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(1, callback);
    return 1;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  t.after(() => {
    globalThis.requestAnimationFrame = savedRequest;
    globalThis.cancelAnimationFrame = savedCancel;
  });
  let onNative;
  let x = 20;
  const series = { priceToCoordinate: (price) => price };
  const scale = {
    timeToCoordinate: () => x,
    width: () => 200,
    getVisibleLogicalRange: () => ({ from: 0, to: 12 }),
    scrollPosition: () => 8,
    scrollToPosition: (...args) => actions.push(["scroll", ...args]),
    setVisibleLogicalRange: (range) => actions.push(["range", range])
  };
  const link = lightweightLink(
    {
      timeScale: () => scale,
      subscribeCrosshairMove: (callback) => (onNative = callback),
      setCrosshairPosition: (...args) => actions.push(["set", ...args]),
      clearCrosshairPosition: () => actions.push(["clear"])
    },
    series,
    "1m",
    () => 200,
    () => 3,
    (bar) => published.push(bar?.close ?? null)
  );
  link.setCrosshair(data, start + minute + 20);
  assert.deepEqual(actions, [["set", 48, (start + minute) / 1000, series]]);
  const projected = { ...data[1], time: data[1].timestamp / 1000 };
  const event = { point: { x: 20, y: 48 }, seriesData: new Map([[series, projected]]) };
  onNative(event);
  assert.deepEqual(published, []);
  onNative({ ...event, sourceEvent: {} });
  assert.deepEqual(published, [48]);
  link.setCrosshair(data, null);
  assert.equal(actions.length, 1);
  link.setCrosshair(data, start);
  x = 201;
  link.setCrosshair(data, start);
  assert.deepEqual(actions.slice(1), [["set", 45, start / 1000, series], ["clear"]]);
  onNative({ seriesData: new Map() });
  assert.deepEqual(published, [48, null]);

  link.setTimeWindow(data, { kind: "time", to: start + minute });
  link.setTimeWindow(data, { kind: "dateRange", from: start + minute / 2, to: monday });
  assert.deepEqual(actions.slice(-2), [
    ["scroll", -6, false],
    ["range", { from: 0.5, to: 3 }]
  ]);
  x = 40;
  link.setCrosshair(data, start + minute);
  link.setTimeWindow(data, { kind: "time", to: start + 2 * minute });
  assert.equal(frames.size, 1);
  frames.get(1)();
  assert.deepEqual(actions.at(-1), ["set", 48, (start + minute) / 1000, series]);
  link.setTimeWindow(data, { kind: "time", to: monday });
  link.dispose();
  assert.equal(frames.size, 0);
});

test("KLine links its own bar and updates the horizontal camera without changing fit offsets", () => {
  const actions = [];
  const width = 120;
  let spacing = 8;
  let offset = 0;
  const toPixel = ({ dataIndex, value }) => ({
    x: Math.floor(width - (data.length + offset - dataIndex - 0.5) * spacing),
    y: value
  });
  const link = klineLink(
    {
      getSize: (pane, position) => {
        assert.equal(pane, "candle_pane");
        assert.equal(position, main);
        return { width, height: 200 };
      },
      getBarSpace: () => spacing,
      setBarSpace: (next) => {
        spacing = next;
        actions.push(["spacing", next]);
      },
      scrollByDistance: (distance, duration) => {
        assert.equal(duration, 0);
        offset -= distance / spacing;
        actions.push(["scroll", distance]);
      },
      executeAction: (...args) => actions.push(args)
    },
    "1m",
    toPixel
  );
  link.setCrosshair(data, start + minute + 20);
  assert.deepEqual(actions, [[action, { x: 92.5, y: 48, paneId: "candle_pane" }]]);
  link.acceptNativeCrosshair();
  link.setCrosshair(data, null);
  assert.equal(actions.length, 1);
  link.setCrosshair(data, monday);
  link.setCrosshair(data, monday - minute);
  assert.deepEqual(actions.slice(1), [
    [action, { x: 108.5, y: 67, paneId: "candle_pane" }],
    [action, { paneId: false }]
  ]);
  link.setCrosshair(data, start + minute);
  link.setTimeWindow(data, { kind: "time", to: start + 2 * minute });
  assert.deepEqual(actions.slice(-2), [
    ["scroll", 16],
    [action, { x: 108.5, y: 48, paneId: "candle_pane" }]
  ]);
  assert.equal(spacing, 8);
  assert.equal(toPixel({ dataIndex: 2 }).x, width - spacing / 2);
  link.setTimeWindow(data, { kind: "dateRange", from: start, to: monday + minute });
  assert.deepEqual(actions.at(-3), ["spacing", 24]);
  assert.deepEqual(actions.at(-1), [action, { x: 36.5, y: 48, paneId: "candle_pane" }]);
  assert.equal(toPixel({ dataIndex: 0 }).x, spacing / 2);
  assert.equal(toPixel({ dataIndex: 4 }).x, width - spacing / 2);
});
