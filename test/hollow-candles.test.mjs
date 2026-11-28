import assert from "node:assert/strict";
import test from "node:test";
import { nativeFixture } from "./native-technical-fixture.mjs";
import { routingFixture } from "./controller-preference-routing-fixture.mjs";
import { backup } from "./drive-reader-guard-helpers.mjs";

const settings = {
  chartType: "hollowCandles",
  background: "#000000",
  upColor: "#40ff60",
  downColor: "#ff4050",
  borderUpColor: "#50ff70",
  borderDownColor: "#ff5060",
  wickUpColor: "#60ff80",
  wickDownColor: "#ff6070"
};
const candle = (index, open, close) =>
  Object.freeze({
    timestamp: 1_700_000_000_000 + index * 86_400_000,
    open,
    close,
    high: Math.max(open, close) + 3,
    low: Math.min(open, close) - 3,
    volume: 100
  });
const raw = Object.freeze([
  candle(0, 10, 10),
  candle(1, 10, 12), // hollow up
  candle(2, 15, 13), // filled up
  candle(3, 10, 12), // hollow down
  candle(4, 13, 11), // filled down
  candle(5, 10, 11), // hollow neutral
  candle(6, 11, 11) // neutral doji
]);
const prices = ({ timestamp, open, high, low, close }) => ({ timestamp, open, high, low, close });
const lightweightPrices = ({ time, open, high, low, close }) => ({
  timestamp: time * 1000,
  open,
  high,
  low,
  close
});

test("hollow fill and previous-close direction are independent, with neutral first/tied closes", () => {
  const f = nativeFixture("lightweight");
  const { hollowCandleStyler } = f.load("model/hollow-candles.ts");
  const style = hollowCandleStyler(settings);
  const actual = raw.map((bar, index) => style(bar, raw[index - 1]?.close));
  assert.deepEqual(actual.slice(1, 5), [
    {
      hollow: true,
      color: "transparent",
      borderColor: settings.borderUpColor,
      wickColor: settings.wickUpColor
    },
    {
      hollow: false,
      color: settings.upColor,
      borderColor: settings.borderUpColor,
      wickColor: settings.wickUpColor
    },
    {
      hollow: true,
      color: "transparent",
      borderColor: settings.borderDownColor,
      wickColor: settings.wickDownColor
    },
    {
      hollow: false,
      color: settings.downColor,
      borderColor: settings.borderDownColor,
      wickColor: settings.wickDownColor
    }
  ]);
  assert.equal(actual[0].borderColor, actual[5].borderColor);
  assert.equal(actual[5].color, "transparent");
  assert.equal(actual[6].hollow, false);
  assert.equal(actual[6].color, actual[0].color);
  f.adapter.destroy();
});

test("hollow colors remain readable on both themes and respect hidden parts", () => {
  const f = nativeFixture("lightweight");
  const { hollowCandleStyler } = f.load("model/hollow-candles.ts");
  const { chartContrast } = f.load("model/theme.ts");
  for (const theme of ["dark", "light"]) {
    const background = theme === "dark" ? "#000000" : "#ffffff";
    const style = hollowCandleStyler({ theme });
    for (const bar of raw) {
      for (const color of Object.values(style(bar, 12)).filter(
        (value) => typeof value === "string" && value !== "transparent"
      )) {
        assert.ok(chartContrast(color, background) >= 3);
      }
    }
  }
  const hidden = hollowCandleStyler({
    bodyVisible: false,
    borderVisible: false,
    wickVisible: false
  });
  assert.deepEqual(hidden(raw[2], 12), {
    hollow: false,
    color: "transparent",
    borderColor: "transparent",
    wickColor: "transparent"
  });
  f.adapter.destroy();
});

test("Lightweight keeps raw OHLC, transparent interiors and incremental last/append/history updates", () => {
  const f = nativeFixture("lightweight", [], { settings });
  const [series] = f.activeSeries();
  f.adapter.setData(raw, false);
  const camera = f.camera();
  assert.deepEqual(series.data.map(lightweightPrices), raw.map(prices));
  assert.equal(series.data[1].color, "transparent");
  assert.equal(series.data[2].color, settings.upColor);
  const fullWrites = f.primaryWrites();
  const updatedLast = candle(6, 11, 14);
  f.adapter.updateBar(updatedLast);
  assert.equal(series.data[6].color, "transparent");
  assert.equal(series.data[6].borderColor, settings.borderUpColor);
  const appended = candle(7, 15, 14.5);
  f.adapter.updateBar(appended);
  assert.equal(series.data[7].color, settings.upColor);
  const corrected = candle(2, 15, 9);
  f.adapter.updateBar(corrected);
  assert.equal(series.data[2].color, settings.downColor);
  assert.equal(series.data[3].borderColor, settings.borderUpColor);
  assert.equal(series.data[3].color, "transparent");
  assert.deepEqual(
    series.data.map(lightweightPrices),
    [raw[0], raw[1], corrected, raw[3], raw[4], raw[5], updatedLast, appended].map(prices)
  );
  assert.equal(f.primaryWrites(), fullWrites, "updates do not reset all native data");
  assert.equal(f.creations(), 1);
  assert.deepEqual(f.camera(), camera);
  f.adapter.setData([], false);
  assert.deepEqual(series.data, []);
  f.adapter.updateBar(raw[0]);
  assert.equal(series.data[0].color, series.data[0].borderColor, "new first doji is neutral");
  f.adapter.destroy();
});

function drawRecording(
  f,
  bars,
  settingsOverride = settings,
  range = { from: 0, to: bars.length },
  projectY = (value) => 200 - value * 5
) {
  const { drawKlineHollowCandles } = f.load("charts/kline-hollow-candles.ts");
  const { hollowCandleStyler } = f.load("model/hollow-candles.ts");
  const rects = [];
  const ctx = {
    fillStyle: "",
    fillRect(x, y, width, height) {
      rects.push({ color: this.fillStyle, x, y, width, height });
    }
  };
  drawKlineHollowCandles(
    {
      ctx,
      kLineDataList: bars,
      visibleRange: range,
      barSpace: { gapBar: 7 },
      xAxis: { convertToPixel: (index) => 20 + index * 10 },
      yAxis: { convertToPixel: projectY }
    },
    hollowCandleStyler(settingsOverride)
  );
  return rects;
}

test("KLine draws hollow outlines with split wicks and filled bodies with correct separate colors", () => {
  const f = nativeFixture("kline", [], { settings });
  const hollow = drawRecording(f, raw, settings, { from: 1, to: 2 });
  assert.deepEqual(hollow, [
    { color: settings.wickUpColor, x: 30, y: 125, width: 1, height: 15 },
    { color: settings.wickUpColor, x: 30, y: 151, width: 1, height: 15 },
    { color: settings.borderUpColor, x: 27, y: 140, width: 7, height: 1 },
    { color: settings.borderUpColor, x: 27, y: 150, width: 7, height: 1 },
    { color: settings.borderUpColor, x: 27, y: 141, width: 1, height: 9 },
    { color: settings.borderUpColor, x: 33, y: 141, width: 1, height: 9 }
  ]);
  const filled = drawRecording(f, raw, settings, { from: 2, to: 3 });
  assert.ok(
    filled.some((rect) => rect.color === settings.upColor && rect.width === 7 && rect.height === 11)
  );
  assert.ok(
    filled.filter((rect) => rect.width === 1).some((rect) => rect.color === settings.wickUpColor)
  );
  assert.ok(filled.some((rect) => rect.color === settings.borderUpColor));
  assert.equal(drawRecording(f, [], settings).length, 0);
  assert.equal(
    drawRecording(f, raw, {
      ...settings,
      bodyVisible: false,
      borderVisible: false,
      wickVisible: false
    }).length,
    0
  );
  f.adapter.destroy();
});

test("KLine normalizes wick bounds for reversed Y projection without filling hollow interiors", () => {
  const f = nativeFixture("kline", [], { settings });
  const reversed = drawRecording(f, raw, settings, { from: 1, to: 2 }, (value) => value * 5);
  assert.deepEqual(
    reversed.filter(({ color }) => color === settings.wickUpColor),
    [
      { color: settings.wickUpColor, x: 30, y: 35, width: 1, height: 15 },
      { color: settings.wickUpColor, x: 30, y: 61, width: 1, height: 15 }
    ]
  );
  assert.ok(reversed.every(({ width, height }) => width > 0 && height > 0));
  assert.ok(reversed.every(({ color }) => color !== settings.upColor));
  assert.ok(
    reversed.some(
      ({ color, y, width }) => color === settings.borderUpColor && y === 50 && width === 7
    )
  );
  assert.ok(
    reversed.some(
      ({ color, y, width }) => color === settings.borderUpColor && y === 60 && width === 7
    )
  );
  f.adapter.destroy();
});

test("KLine registered renderer follows current raw data and corrections without replacing the chart", () => {
  const f = nativeFixture("kline", [], { settings });
  assert.ok(
    Object.values(f.native.initialStyles.candle.bar).every((color) => color === "transparent")
  );
  const indicator = f.allIndicators.find((item) => item.name === "MTP_HOLLOW_CANDLES");
  assert.ok(indicator);
  assert.equal(indicator.paneId, "candle_pane");
  f.adapter.setData(raw, false);
  const camera = f.camera();
  const last = candle(6, 11, 14);
  const appended = candle(7, 15, 14.5);
  const corrected = candle(2, 15, 9);
  f.adapter.updateBar(last);
  f.adapter.updateBar(appended);
  f.adapter.updateBar(corrected);
  const current = f.native.getDataList();
  assert.deepEqual(current, [raw[0], raw[1], corrected, raw[3], raw[4], raw[5], last, appended]);
  const recorded = [];
  const ctx = {
    fillStyle: "",
    fillRect(...rect) {
      recorded.push([this.fillStyle, ...rect]);
    }
  };
  indicator.draw({
    ctx,
    indicator,
    kLineDataList: current,
    visibleRange: { from: 3, to: 4 },
    barSpace: { gapBar: 7 },
    xAxis: { convertToPixel: (index) => index * 10 },
    yAxis: { convertToPixel: (value) => 200 - value * 5 }
  });
  assert.ok(recorded.some(([color]) => color === settings.borderUpColor));
  assert.ok(recorded.every(([color]) => color !== settings.borderDownColor));
  assert.equal(f.creations(), 1);
  assert.deepEqual(f.camera(), camera);
  f.adapter.destroy();
});

test("hollow chart settings pass JSON backup validation and retain the old default", () => {
  const f = nativeFixture("lightweight");
  const { isChartSettings } = f.load("model/backup-format.ts");
  const { resolveNativeChartType, retainNativeChartType } = f.load("model/native-chart-type.ts");
  const restored = JSON.parse(JSON.stringify(settings));
  assert.equal(isChartSettings(restored), true);
  assert.equal(resolveNativeChartType(restored), "hollowCandles");
  assert.equal(resolveNativeChartType({}), "candles");
  assert.equal(retainNativeChartType(restored, { grid: false }).chartType, "hollowCandles");
  assert.equal(isChartSettings({ chartType: "unrecognized" }), false);
  const { assertReadableDrivePayload } = f.load("services/drive/reader-guard.ts");
  const cloud = backup();
  cloud.layout.chartSettings = restored;
  const decoded = assertReadableDrivePayload(JSON.parse(JSON.stringify(cloud)));
  assert.equal(decoded.layout.chartSettings.chartType, "hollowCandles");
  assert.deepEqual(decoded.layout.chartSettings, restored);
  cloud.layout.chartSettings.chartType = "future-chart";
  assert.throws(
    () => assertReadableDrivePayload(cloud),
    (error) => error.code === "unsupported-format"
  );
  f.adapter.destroy();
});

test("controller persists hollow selection while keeping candles, drawings and unrelated settings", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const original = f.controller.getSnapshot();
  await f.controller.setChartType("hollowCandles");
  const current = f.controller.getSnapshot();
  assert.equal(current.preferences.chartSettings.chartType, "hollowCandles");
  assert.equal(f.preferenceWrites.at(-1).chartSettings.chartType, "hollowCandles");
  assert.equal(current.candles, original.candles);
  assert.equal(current.drawings, original.drawings);
  assert.equal(
    current.preferences.chartSettings.upColor,
    original.preferences.chartSettings.upColor
  );
  assert.equal(f.requests.length, 0);
});
