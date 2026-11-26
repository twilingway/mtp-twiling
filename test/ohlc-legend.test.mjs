import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const requirePackage = createRequire(import.meta.url);
const modules = new Map();
function load(relative) {
  let filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
  if (!existsSync(filename)) filename += "x";
  assert.ok(filename.startsWith(sourceRoot));
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(
    (specifier) =>
      specifier.startsWith(".")
        ? load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)))
        : requirePackage(specifier),
    module,
    module.exports
  );
  return module.exports;
}

const { createOhlcLegend, formatOhlcValue, ohlcDisplayMode, ohlcCandleIndex, placeOhlcCard } =
  load("model/ohlc-legend.ts");
const { createOhlcInspection, OHLC_HOLD_MS } = load("model/ohlc-inspection.ts");
const { ohlcHitTimestamp } = load("model/ohlc-hit-test.ts");
const { isChartSettings } = load("model/backup-format.ts");
const { chartContrast } = load("model/theme.ts");
const { DEFAULT_LAST_PRICE_COLOR, lastPriceStyle } = load("model/last-price-style.ts");
const { drawingPriceLabelPosition, drawingPriceTargets } = load("model/drawing-price-labels.ts");
const { OhlcLegend } = load("screens/terminal/OhlcLegend.tsx");
const { OhlcCandleCard } = load("screens/terminal/OhlcCandleCard.tsx");
const { TerminalContext } = load("screens/terminal/context.tsx");
const bar = (open, close) => ({
  timestamp: 1000,
  open,
  high: Math.max(open, close) + 2,
  low: Math.min(open, close) - 2,
  close,
  volume: 5
});

function simulateInspection(onHold) {
  const shown = [];
  let pending;
  const inspection = createOhlcInspection(
    onHold,
    (timestamp) => shown.push(timestamp),
    (run, delay) => {
      assert.equal(delay, OHLC_HOLD_MS);
      assert.equal(pending, undefined);
      pending = run;
      return () => {
        pending = undefined;
      };
    }
  );
  return {
    inspection,
    current: () => shown.at(-1) ?? null,
    pending: () => pending,
    elapsed: () => {
      const run = pending;
      pending = undefined;
      run?.();
    }
  };
}

test("OHLC settings accept every mode and old backups default to near the candle", () => {
  assert.equal(ohlcDisplayMode(), "candle");
  assert.equal(ohlcDisplayMode({ showLegend: false }), "candle");
  for (const mode of ["candle", "corner", "icon", "hidden"]) {
    const settings = { ohlcDisplay: mode, ohlcOnHold: true };
    assert.equal(isChartSettings(settings), true);
    assert.equal(ohlcDisplayMode(settings), mode);
  }
  assert.equal(isChartSettings({ ohlcDisplay: "invalid" }), false);
  assert.equal(isChartSettings({ ohlcOnHold: "true" }), false);
});

test("OHLC looks up exact market bars and places the card within the visible price pane", () => {
  const candles = [1000, 3000, 7000].map((timestamp) => ({ ...bar(10, 11), timestamp }));
  assert.equal(ohlcCandleIndex(candles, 3000), 1);
  for (const timestamp of [0, 2000, 8000, NaN])
    assert.equal(ohlcCandleIndex(candles, timestamp), -1);
  const plot = { width: 260, height: 125, top: 35 };
  const card = { width: 100, height: 36 };
  assert.deepEqual(placeOhlcCard({ x: 25, y: 90 }, plot, card), { x: 33, y: 46 });
  assert.deepEqual(placeOhlcCard({ x: 255, y: 36 }, plot, card), { x: 147, y: 44 });
  assert.deepEqual(placeOhlcCard({ x: 55, y: 40 }, { width: 60, height: 45, top: 30 }, card), {
    x: 0,
    y: 30
  });
});

test("hold mode restarts on a different mouse candle, keeps the timer on the same one, and clears on leave", () => {
  const { inspection, current, pending, elapsed } = simulateInspection(true);
  inspection.hover(3000);
  const initialTimer = pending();
  assert.ok(initialTimer);
  assert.equal(current(), null);
  inspection.hover(3000);
  assert.equal(pending(), initialTimer);
  inspection.hover(7000);
  assert.notEqual(pending(), initialTimer);
  elapsed();
  assert.equal(current(), 7000);
  inspection.leave();
  assert.equal(current(), null);
  inspection.hover(9000);
  inspection.leave();
  elapsed();
  assert.equal(current(), null);
});

test("fast mode shows mouse values immediately and a second touch dismisses the pinned card", () => {
  const { inspection, current } = simulateInspection(false);
  const point = { x: 20, y: 40 };
  const tap = { id: 1, point, touch: true, startedAt: 10 };
  inspection.hover(1000);
  assert.equal(current(), 1000);
  inspection.down(tap, 3000);
  inspection.up(1, point, 3000, 30);
  inspection.leave();
  assert.equal(current(), 3000);
  inspection.down(tap, 7000);
  inspection.up(1, point, 7000, 30);
  assert.equal(current(), null);
});

test("holding a mouse button also shows values after the delay and clears on release", () => {
  const { inspection, current, elapsed } = simulateInspection(true);
  const point = { x: 20, y: 40 };
  inspection.down({ id: 1, point, touch: false, startedAt: 0 }, 3000);
  assert.equal(current(), null);
  elapsed();
  assert.equal(current(), 3000);
  inspection.up(1, point, 3000, 500);
  assert.equal(current(), null);
});

test("touch hold waits for the delay and stays pinned only after a completed hold", () => {
  const { inspection, current, elapsed } = simulateInspection(true);
  const point = { x: 20, y: 40 };
  const tap = { id: 1, point, touch: true, startedAt: 10 };
  inspection.down(tap, 3000);
  inspection.up(1, point, 3000, 200);
  elapsed();
  assert.equal(current(), null);
  inspection.down(tap, 3000);
  inspection.move(1, { x: 22, y: 42 }, () => 3000);
  elapsed();
  assert.equal(current(), 3000);
  inspection.up(1, point, 3000, 500);
  inspection.leave();
  assert.equal(current(), 3000);
  inspection.down(tap, 7000);
  inspection.up(1, point, 7000, 30);
  assert.equal(current(), null);
});

test("drag, a second pointer and pointer cancellation each prevent a touch card", () => {
  const point = { x: 20, y: 40 };
  const tap = { id: 1, point, touch: true, startedAt: 0 };
  for (const onHold of [true, false]) {
    const { inspection, current, elapsed } = simulateInspection(onHold);
    for (const cancel of [
      () => inspection.move(1, { x: 35, y: 40 }, () => 3000),
      () => inspection.down({ ...tap, id: 2 }, 7000),
      () => inspection.cancel(1)
    ]) {
      inspection.down(tap, 3000);
      cancel();
      elapsed();
      inspection.up(1, point, 3000, 10);
      assert.equal(current(), null);
    }
  }
});

test("OHLC direction follows the preceding close, including gaps opposite to candle body", () => {
  const rise = createOhlcLegend(bar(110, 105), 100, { upColor: "#6795c7" });
  assert.equal(rise.direction, "up");
  assert.equal(rise.color, "#6795c7");
  assert.equal(rise.change, 5);
  assert.equal(rise.percent, 5);
  assert.deepEqual(rise.values, { open: 110, high: 112, low: 103, close: 105 });
  const fall = createOhlcLegend(bar(90, 95), 100, { downColor: "#b98452" });
  assert.equal(fall.direction, "down");
  assert.equal(fall.color, "#b98452");
  assert.equal(fall.change, -5);
  assert.equal(fall.percent, -5);
});

function hitMark(x, y, { settings = {}, touch = false, engine = "tradingview" } = {}) {
  const candles = [
    { ...bar(100, 105), timestamp: 500 },
    { ...bar(100, 110), high: 120, low: 90 },
    { ...bar(110, 90), timestamp: 1500 }
  ];
  return ohlcHitTimestamp(
    candles,
    { x, y },
    { timestamp: 1000, value: 200 - y },
    ({ timestamp, value }) => ({ x: (timestamp / 500) * 20, y: 200 - value }),
    settings,
    engine,
    touch
  );
}

test("OHLC only hits the painted candle body or wick, in both engines and with touch tolerance", () => {
  for (const engine of ["tradingview", "kline"]) {
    assert.equal(hitMark(45, 95, { engine }), 1000);
    assert.equal(hitMark(40, 84, { engine }), 1000);
    assert.equal(hitMark(40, 117, { engine }), null);
    assert.equal(hitMark(40, 77, { engine }), null);
    assert.equal(hitMark(45, 84, { engine }), null);
    assert.equal(hitMark(30.25, 95, { engine }), null);
    assert.equal(hitMark(42.5, 84, { engine, touch: true }), 1000);
    assert.equal(hitMark(42.5, 84, { engine }), null);
  }
  assert.equal(hitMark(40, 85, { settings: { wickVisible: false } }), null);
  const noBody = { bodyVisible: false, borderVisible: false };
  assert.equal(hitMark(40, 95, { settings: noBody }), null);
  assert.equal(hitMark(40, 85, { settings: noBody }), 1000);
});

test("native OHLC bars and line or area only hit visible marks", () => {
  const bars = { chartType: "bars" };
  assert.equal(hitMark(34, 100, { settings: bars }), 1000);
  assert.equal(hitMark(46, 90, { settings: bars }), 1000);
  assert.equal(hitMark(46, 95, { settings: bars }), null);
  for (const chartType of ["line", "area"]) {
    assert.equal(hitMark(45, 95, { settings: { chartType } }), 1000);
    assert.equal(hitMark(45, 105, { settings: { chartType } }), null);
  }
});

test("leaving a mark during a hold or tap cancels even inside the same time column", () => {
  const point = { x: 20, y: 40 };
  const tap = { id: 1, point, touch: true, startedAt: 0 };
  const hold = simulateInspection(true);
  hold.inspection.down(tap, 1000);
  hold.inspection.move(1, { x: 20, y: 42 }, () => null);
  assert.equal(hold.pending(), undefined);
  hold.elapsed();
  assert.equal(hold.current(), null);
  const fast = simulateInspection(false);
  fast.inspection.down(tap, 1000);
  fast.inspection.up(1, { x: 20, y: 42 }, null, 150);
  assert.equal(fast.current(), null);
  fast.inspection.down(tap, null);
  assert.equal(fast.inspection.hasPress(1), false);
  fast.inspection.up(1, { x: 20, y: 42 }, 1000, 150);
  assert.equal(fast.current(), null);
});

test("repeated empty, blocked and same-candle events do not publish React selection updates", () => {
  const transitions = [];
  const inspection = createOhlcInspection(
    false,
    (timestamp) => transitions.push(timestamp),
    () => assert.fail("fast hover should not schedule a card")
  );
  for (let i = 0; i < 20; i++) {
    inspection.hover(null);
    inspection.clear();
  }
  assert.deepEqual(transitions, []);
  inspection.hover(1000);
  inspection.hover(1000);
  inspection.hover(null);
  inspection.clear();
  assert.deepEqual(transitions, [1000, null]);
});

test("unchanged close remains neutral even when the candle body is directional", () => {
  const legend = createOhlcLegend(bar(99, 100), 100);
  assert.equal(legend.direction, "neutral");
  assert.equal(legend.color, legend.labelColor);
  assert.equal(legend.change, 0);
  assert.equal(legend.percent, 0);
});

test("first bar uses its body color without inventing change or percentage", () => {
  for (const [open, close, expected] of [
    [90, 100, "up"],
    [110, 100, "down"],
    [100, 100, "neutral"]
  ]) {
    const legend = createOhlcLegend(bar(open, close));
    assert.equal(legend.direction, expected);
    assert.equal(legend.change, null);
    assert.equal(legend.percent, null);
  }
});

test("missing or non-finite prices remain unavailable and percentages never divide by zero", () => {
  const missing = createOhlcLegend(undefined, 100);
  assert.equal(missing.direction, "neutral");
  assert.equal(missing.color, missing.labelColor);
  assert.deepEqual(missing.values, { open: null, high: null, low: null, close: null });
  assert.equal(missing.change, null);
  assert.equal(missing.percent, null);
  const zeroPrevious = createOhlcLegend(bar(1, 2), 0);
  assert.equal(zeroPrevious.change, 2);
  assert.equal(zeroPrevious.percent, null);
  const invalid = createOhlcLegend({ ...bar(1, 2), high: Infinity, close: NaN }, 1);
  assert.equal(invalid.values.high, null);
  assert.equal(invalid.direction, "neutral");
  assert.equal(invalid.change, null);
  assert.equal(invalid.percent, null);
  const overflow = createOhlcLegend(bar(1, Number.MAX_VALUE), Number.MIN_VALUE);
  assert.ok(Number.isFinite(overflow.change));
  assert.equal(overflow.percent, null);
});

test("neutral labels follow chart theme and background while configured direction colors survive", () => {
  const dark = createOhlcLegend(undefined, undefined, { theme: "dark" });
  const light = createOhlcLegend(undefined, undefined, { theme: "light" });
  assert.notEqual(dark.labelColor, light.labelColor);
  assert.equal(
    createOhlcLegend(bar(1, 2), 1, { theme: "light", upColor: "#123456" }).color,
    "#123456"
  );
  assert.equal(
    createOhlcLegend(undefined, undefined, { theme: "dark", background: "#ffffff" }).labelColor,
    light.labelColor
  );
});

test("monochrome candles keep OHLC, last price and its label readable on both backgrounds", () => {
  for (const background of ["#ffffff", "#000000", "#886688"]) {
    for (const rising of [true, false]) {
      const settings = { background, upColor: background, downColor: background };
      const close = rising ? 2 : 0.5;
      assert.ok(
        chartContrast(createOhlcLegend(bar(1, close), 1, settings).color, background) >= 4.5
      );
      const last = lastPriceStyle(settings, rising);
      assert.ok(chartContrast(last.color, background) >= 3);
      assert.ok(chartContrast(last.text, last.color) >= 4.5);
    }
  }
  for (const background of ["#ffffff", "#000000"]) {
    assert.equal(
      lastPriceStyle({ background, lastPriceColor: DEFAULT_LAST_PRICE_COLOR }, false).color,
      DEFAULT_LAST_PRICE_COLOR
    );
  }
});

test("drawing level targets preserve horizontal labels and avoid covering the live price", () => {
  const points = [
    { timestamp: 1000, value: 100 },
    { timestamp: 2000, value: 90 }
  ];
  const horizontal = { name: "horizontalStraightLine", points: points.slice(0, 1) };
  const sloped = { name: "rayLine", points };
  assert.deepEqual(
    drawingPriceTargets([horizontal, sloped]).map(({ point, anchor }) => [point.value, anchor]),
    [[100, "always"]]
  );
  assert.deepEqual(
    drawingPriceTargets([horizontal, sloped], sloped).map(({ point }) => point.value),
    [100, 100, 90]
  );
  assert.equal(drawingPriceLabelPosition(110, 220, [110]), 94);
  assert.equal(drawingPriceLabelPosition(10, 100, [10]), 26);
  assert.equal(drawingPriceLabelPosition(-1, 100, []), null);
});

test("localized precision and signs are stable, including rounded zero and unavailable values", () => {
  assert.equal(formatOhlcValue(12.3456, 3), "12,346");
  assert.equal(formatOhlcValue(2.5, 2, true), "+2,50");
  assert.equal(formatOhlcValue(-2.5, 2, true), "-2,50");
  assert.equal(formatOhlcValue(-0.0001, 2, true), "0,00");
  assert.equal(formatOhlcValue(null, 2), "—");
  assert.equal(formatOhlcValue(NaN, 2), "—");
  assert.equal(formatOhlcValue(12.5, NaN), "12,50");
});

test("legend exposes four separate neutral labels and selected-bar change without live announcements", () => {
  const markup = renderToStaticMarkup(
    createElement(OhlcLegend, {
      bar: bar(110, 105),
      previousClose: 100,
      digits: 2,
      settings: { upColor: "#6795c7" }
    })
  );
  assert.equal((markup.match(/class="ohlc-label"/g) ?? []).length, 4);
  assert.match(markup, /--ohlc-value-color:#6795c7/);
  assert.match(markup, /data-direction="up"/);
  assert.match(markup, /Изменение: \+5,00 \(\+5,00%\)/);
  assert.doesNotMatch(markup, /aria-live/);
  const first = renderToStaticMarkup(createElement(OhlcLegend, { bar: bar(1, 2), digits: 2 }));
  assert.doesNotMatch(first, /class="ohlc-change"|%/);
  const missing = renderToStaticMarkup(createElement(OhlcLegend, { digits: 2 }));
  assert.equal((missing.match(/data-missing="true"/g) ?? []).length, 4);
});

function candleCard(candles, timestamp, chartSettings = {}) {
  const state = { candles, rows: [], preferences: { chartSettings } };
  const controller = { getSnapshot: () => state, subscribe: () => () => {} };
  return renderToStaticMarkup(
    createElement(
      TerminalContext,
      { value: controller },
      createElement(OhlcCandleCard, { timestamp })
    )
  );
}

test("the adjacent card uses full translated price labels and volume of the selected candle", () => {
  const markup = candleCard(
    [
      { ...bar(103, 100), timestamp: 500, volume: 40000 },
      { ...bar(110, 105), volume: 123457.125 },
      { ...bar(109, 108), timestamp: 2000, volume: 90000 }
    ],
    1000,
    { theme: "light", upColor: "#123456" }
  );
  assert.match(markup, /<dl class="ohlc-card-fields">/);
  assert.match(markup, /<dt>Открытие<\/dt><dd>110,00<\/dd>/);
  assert.match(markup, /<dt>Максимум<\/dt><dd>112,00<\/dd>/);
  assert.match(markup, /<dt>Минимум<\/dt><dd>103,00<\/dd>/);
  assert.match(markup, /<dt>Закрытие<\/dt><dd>105,00<\/dd>/);
  assert.match(markup, /<dt>Изменение<\/dt><dd><span>\+5,00<\/span><span>\(\+5,00%\)<\/span>/);
  assert.match(markup, /<dt>Объём<\/dt><dd>123\s457,125<\/dd>/);
  assert.match(markup, /--ohlc-card-change:#123456/);
  assert.doesNotMatch(markup, /aria-live|class="ohlc ohlc-legend"/);
});

test("the adjacent card shows real zero volume and marks missing values without fabricated prices", () => {
  const first = candleCard([{ ...bar(100, 105), volume: 0 }], 1000);
  assert.match(first, /<dt>Объём<\/dt><dd>0<\/dd>/);
  assert.match(first, /<dt>Изменение<\/dt><dd><span>—<\/span><\/dd>/);
  const missing = candleCard([{ ...bar(100, 105), high: NaN, volume: undefined }], 1000);
  assert.match(missing, /<dt>Максимум<\/dt><dd>—<\/dd>/);
  assert.match(missing, /<dt>Объём<\/dt><dd>—<\/dd>/);
  const falling = candleCard([{ ...bar(95, 100), timestamp: 500 }, bar(105, 90)], 1000, {
    theme: "dark",
    downColor: "#f23645"
  });
  assert.match(falling, /<dt>Изменение<\/dt><dd><span>-10,00<\/span><span>\(-10,00%\)<\/span>/);
  assert.match(falling, /--ohlc-card-change:#f23645/);
});
