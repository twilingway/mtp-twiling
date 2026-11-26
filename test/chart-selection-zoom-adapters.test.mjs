import assert from "node:assert/strict";
import test from "node:test";
import { installedMethod } from "./kline-async-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader({ klinecharts: { DomPosition: { Main: "main" } } });
const { selectionTimeWindow, selectionZoomBounds } = load("charts/selection-zoom.js");
const { lightweightNavigation } = load("charts/lightweight-navigation.js");
const { klineNavigation } = load("charts/kline-navigation.js");
const { zoomKlineSelection } = load("charts/kline-selection-zoom.js");
const { UserCameraEvents } = load("charts/camera-events.js");

const start = Date.UTC(2026, 0, 4, 9);
const minute = 60_000;
const point = (index, value) => ({ timestamp: start + index * minute, value });
const source = {
  data: Object.freeze(Array.from({ length: 100 }, (_, i) => Object.freeze(point(i, 30)))),
  timeframe: "1m",
  minMove: 0.05
};

test("selection normalizes drag direction, bounds history and handles a fraction of a native cell", () => {
  const normal = { time: { from: 25, to: 40 }, price: { from: 20, to: 40 } };
  const a = point(25, 40);
  const b = point(40, 20);
  assert.deepEqual(selectionZoomBounds(source, a, b), normal);
  assert.deepEqual(selectionZoomBounds(source, b, a), normal);
  assert.deepEqual(selectionZoomBounds(source, point(-10, 10), b)?.time, { from: 0, to: 40 });
  const singleCell = selectionZoomBounds(source, point(25, 50.01), point(25, 50.02));
  assert.deepEqual(singleCell.time, { from: 25, to: 25 });
  assert.ok(Math.abs(singleCell.price.to - singleCell.price.from - 0.05) < 1e-12);
  assert.equal(selectionZoomBounds(source, point(101, 2), point(105, 3)), null);
  assert.equal(selectionZoomBounds(source, point(NaN, 10), b), null);
  assert.equal(selectionZoomBounds(source, point(20, Infinity), b), null);
  assert.equal(selectionZoomBounds(source, point(20, 20), b), null);
  assert.equal(selectionZoomBounds({ ...source, data: [] }, a, b), null);
  assert.deepEqual(selectionTimeWindow({ from: 2, to: 3 }, 800, 1, 50), {
    from: -5,
    to: 10,
    center: 2.5,
    spacing: 50
  });
});

test("Lightweight applies manual Y and selected X during one user camera gesture, then resets", () => {
  const writes = [];
  let spacing = 6;
  let offset = 8;
  let ready = true;
  let auto = true;
  let timer;
  let frame;
  const scale = {
    width: () => 600,
    options: () => ({ barSpacing: spacing, minBarSpacing: 0.5, maxBarSpacing: 0 }),
    logicalToCoordinate: (index) => 599 - (99 + offset - index + 0.5) * spacing,
    setVisibleLogicalRange: (range) => {
      writes.push(range);
      spacing = 600 / (range.to - range.from + 1);
      offset = range.to - 99;
    },
    applyOptions: ({ barSpacing, rightOffset }) => {
      spacing = barSpacing;
      offset = rightOffset;
    },
    scrollToPosition: (rightOffset) => (offset = rightOffset)
  };
  const price = {
    getVisibleRange: () => ({ from: 10, to: 60 }),
    setVisibleRange: (range) => {
      writes.push(range);
      auto = false; // Public Lightweight 5 setter also disables autoscale.
    },
    applyOptions: ({ autoScale }) => (auto = autoScale)
  };
  const nav = lightweightNavigation(
    { timeScale: () => scale },
    { priceScale: () => price },
    () => source.data.length,
    () => ready,
    () => 0,
    () => source
  );
  const captured = [];
  const camera = new UserCameraEvents(
    { onCameraChange: (view) => captured.push(view) },
    {
      delay: (callback) => ((timer = callback), 1),
      cancelDelay: () => (timer = undefined),
      frame: (callback) => ((frame = callback), 1),
      cancelFrame: () => (frame = undefined)
    }
  );
  const adapter = camera.wrap({
    ...nav,
    getView: () => ({ camera: { barSpace: spacing, rightOffsetBars: offset } })
  });
  adapter.beginViewInteraction(true);
  adapter.zoomToSelection(point(40, 20), point(25, 40));
  adapter.endViewInteraction();
  timer();
  frame();
  frame();
  assert.deepEqual(writes, [
    { from: 20, to: 40 },
    { from: 25, to: 40 }
  ]);
  assert.deepEqual(captured, [{ camera: { barSpace: 37.5, rightOffsetBars: -59 } }]);
  assert.equal(auto, false);
  nav.resetView();
  assert.equal(auto, true);
  assert.deepEqual(adapter.getView(), { camera: { barSpace: 6, rightOffsetBars: 8 } });
  ready = false;
  nav.zoomToSelection(point(25, 10), point(40, 50));
  assert.equal(writes.length, 2);
});

test("KLine pins the real native price range, centers at its zoom limit and restores auto mode", () => {
  const mainAxis = {
    getType: () => "normal",
    setRange: installedMethod("AxisImp", "setRange"),
    setAutoCalcTickFlag: installedMethod("AxisImp", "setAutoCalcTickFlag"),
    _autoCalcTickFlag: true
  };
  const calls = [];
  let spacing = 8;
  let offset = -45;
  const xAt = (index) => Math.floor(400 - (100 + offset - index - 0.5) * spacing);
  const chart = {
    getDom: () => null,
    getSize: (paneId, position) => {
      assert.equal(paneId, "candle_pane");
      assert.equal(position, "main");
      return { width: 400, height: 300 };
    },
    getDrawPaneById: (paneId) => {
      assert.equal(paneId, "candle_pane");
      return { getAxisComponent: () => mainAxis };
    },
    getBarSpace: () => spacing,
    setBarSpace: (next) => (spacing = next),
    scrollByDistance: (distance, duration) => {
      assert.equal(duration, 0);
      offset -= distance / spacing;
    },
    scrollToRealTime: () => (offset = 8),
    adjustPaneViewport: (...args) => calls.push(args),
    convertToPixel: (points) => points.map(({ dataIndex }) => ({ x: xAt(dataIndex) }))
  };
  const selection = selectionZoomBounds(source, point(45, 36), point(40, 12));
  assert.equal(zoomKlineSelection(chart, selection, xAt), true);
  assert.deepEqual(mainAxis._range, {
    from: 12,
    to: 36,
    range: 24,
    realFrom: 12,
    realTo: 36,
    realRange: 24
  });
  assert.equal(mainAxis._autoCalcTickFlag, false);
  assert.equal(spacing, 50);
  assert.equal(xAt(42.5), 200);
  assert.deepEqual(calls, [[false, true, true, true]]);
  klineNavigation(
    chart,
    () => 100,
    () => true
  ).resetView();
  assert.equal(mainAxis._autoCalcTickFlag, true);
  assert.equal(spacing, 6);
  assert.equal(offset, 8);
  assert.equal(
    zoomKlineSelection({ ...chart, getDrawPaneById: () => null }, selection, xAt),
    false
  );
  assert.equal(
    zoomKlineSelection(chart, selection, () => NaN),
    false
  );
  assert.equal(spacing, 6);
});
