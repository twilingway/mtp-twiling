import assert from "node:assert/strict";
import test from "node:test";
import { CandleType } from "../node_modules/klinecharts/dist/index.esm.js";
import { nativeFixture } from "./native-technical-fixture.mjs";

const types = [
  [undefined, "Candlestick", CandleType.CandleSolid],
  ["candles", "Candlestick", CandleType.CandleSolid],
  ["bars", "Bar", CandleType.Ohlc],
  ["line", "Line", CandleType.Area],
  ["area", "Area", CandleType.Area]
];
const raw = Object.freeze([
  Object.freeze({
    timestamp: 1_700_000_000_535,
    open: 100,
    high: 103,
    low: 97,
    close: 101,
    volume: 120
  }),
  Object.freeze({
    timestamp: 1_700_086_400_535,
    open: 101,
    high: 105,
    low: 99,
    close: 102,
    volume: 70
  })
]);
const corrected = { ...raw[0], open: 102, close: 103, volume: 42 };
const latest = {
  timestamp: raw[1].timestamp + 86_400_000,
  open: 102,
  high: 106,
  low: 98,
  close: 103,
  volume: 60
};
const time = (bar) => Math.floor(bar.timestamp / 1000);

for (const [chartType, lightweightType, klineType] of types) {
  const settings = chartType === undefined ? {} : { chartType };
  test(`Lightweight ${chartType ?? "legacy candles"} uses native data, raw OHLC and linked crosshair`, () => {
    const hovered = [];
    const f = nativeFixture("lightweight", [], {
      settings,
      onCrosshair: (bar) => hovered.push(bar)
    });
    const [series] = f.activeSeries();
    const row = ({ timestamp, open, high, low, close }) =>
      chartType === "line" || chartType === "area"
        ? { time: Math.floor(timestamp / 1000), value: close }
        : { time: Math.floor(timestamp / 1000), open, high, low, close };
    assert.equal(series.type, lightweightType);
    f.adapter.setData(raw, false);
    assert.deepEqual(series.data, raw.map(row));
    assert.equal(series.labels[0].options.price, raw[1].close);
    f.adapter.setView({ camera: { barSpace: 13, rightOffsetBars: 8 } });
    f.ready();
    const camera = f.camera();
    f.adapter.setLinkedCrosshair(raw[0].timestamp);
    assert.deepEqual(f.calls.at(-1), ["setCrosshair", raw[0].close, time(raw[0]), lightweightType]);
    f.emit("crosshair", { time: time(raw[0]), point: { x: 1, y: 1 }, seriesData: new Map() });
    assert.deepEqual(hovered, []);
    f.emit("crosshair", { sourceEvent: {}, seriesData: new Map([[series, series.data[1]]]) });
    assert.equal(hovered.at(-1), raw[1]);
    assert.deepEqual(f.camera(), camera);
    f.adapter.updateBar(corrected);
    f.adapter.updateBar(latest);
    assert.deepEqual(series.data, [corrected, raw[1], latest].map(row));
    assert.equal(series.labels[0].options.price, latest.close);
    f.emit("crosshair", { time: time(corrected), sourceEvent: {}, seriesData: new Map() });
    assert.equal(hovered.at(-1), corrected);
    f.adapter.setData([latest], false);
    f.emit("crosshair", { time: time(corrected), sourceEvent: {}, seriesData: new Map() });
    assert.equal(hovered.at(-1), null);
    f.adapter.destroy();
  });

  test(`KLine ${chartType ?? "legacy candles"} uses native geometry and leaves raw candles and camera intact`, () => {
    const hovered = [];
    const f = nativeFixture("kline", [], { settings, onCrosshair: (bar) => hovered.push(bar) });
    assert.equal(f.native.initialStyles.candle.type, klineType);
    assert.ok(f.native.initialStyles.candle.priceMark.last.show);
    f.adapter.setData(raw, false);
    assert.deepEqual(f.native.getDataList(), raw);
    f.adapter.setView({ camera: { barSpace: 13, rightOffsetBars: 8 } });
    const camera = f.camera();
    f.adapter.setLinkedCrosshair(raw[0].timestamp);
    assert.equal(f.calls.at(-1)[0], "crosshair");
    assert.equal(f.calls.at(-1)[1].paneId, "candle_pane");
    assert.deepEqual(hovered, []);
    f.emit("crosshair", { realDataIndex: 0 });
    assert.equal(hovered.at(-1), raw[0]);
    assert.deepEqual(f.camera(), camera);
    f.adapter.updateBar(corrected);
    f.adapter.updateBar(latest);
    assert.deepEqual(f.native.getDataList(), [corrected, raw[1], latest]);
    f.emit("crosshair", { realDataIndex: 0 });
    assert.equal(hovered.at(-1), corrected);
    f.emit("crosshair", { realDataIndex: 10 });
    assert.equal(hovered.at(-1), null);
    f.adapter.destroy();
  });
}

test("native area and line use closing prices and keep separate fill settings", () => {
  const f = nativeFixture("kline");
  const { klineMainStyle } = f.load("charts/kline-main-style.ts");
  const line = klineMainStyle({ chartType: "line" });
  const area = klineMainStyle({ chartType: "area" });
  assert.equal(line.area.value, "close");
  assert.equal(line.area.backgroundColor, "transparent");
  assert.equal(area.area.value, "close");
  assert.deepEqual(
    Array.from(area.area.backgroundColor, ({ offset }) => offset),
    [0, 1]
  );
  assert.notEqual(area.area.backgroundColor[0].color, area.area.backgroundColor[1].color);
  f.adapter.destroy();
});

for (const engine of ["lightweight", "kline"]) {
  test(`${engine} restores manual price limits when a replacement adapter receives its first data`, () => {
    const f = nativeFixture(engine, [], { settings: { chartType: "line" } });
    if (engine === "kline") {
      let range;
      const axis = {
        getType: () => "normal",
        getAutoCalcTickFlag: () => range === undefined,
        getRange: () => range,
        setRange: (value) => {
          range = value;
        }
      };
      f.native.getDrawPaneById = () => ({ getAxisComponent: () => axis });
      f.native.adjustPaneViewport = () => {};
    }
    const prices = { from: 95, to: 109 };
    f.adapter.setManualPriceRange(prices);
    assert.equal(f.adapter.getManualPriceRange(), null);
    f.adapter.setData(raw, false);
    assert.deepEqual({ ...f.adapter.getManualPriceRange() }, prices);
    f.adapter.setManualPriceRange({ from: 0, to: NaN });
    assert.deepEqual({ ...f.adapter.getManualPriceRange() }, prices);
    f.adapter.destroy();
    assert.equal(f.adapter.getManualPriceRange(), null);
  });
}
