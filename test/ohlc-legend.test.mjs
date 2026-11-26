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

const { createOhlcLegend, formatOhlcValue } = load("model/ohlc-legend.ts");
const { chartContrast } = load("model/theme.ts");
const { DEFAULT_LAST_PRICE_COLOR, lastPriceStyle } = load("model/last-price-style.ts");
const { drawingPriceLabelPosition, drawingPriceTargets } = load("model/drawing-price-labels.ts");
const { OhlcLegend } = load("screens/terminal/OhlcLegend.tsx");
const bar = (open, close) => ({
  timestamp: 1000,
  open,
  high: Math.max(open, close) + 2,
  low: Math.min(open, close) - 2,
  close,
  volume: 5
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
      assert.ok(chartContrast(createOhlcLegend(bar(1, close), 1, settings).color, background) >= 4.5);
      const last = lastPriceStyle(settings, rising);
      assert.ok(chartContrast(last.color, background) >= 3);
      assert.ok(chartContrast(last.text, last.color) >= 4.5);
    }
  }
  for (const background of ["#ffffff", "#000000"]) {
    assert.equal(lastPriceStyle({ background, lastPriceColor: DEFAULT_LAST_PRICE_COLOR }, false).color, DEFAULT_LAST_PRICE_COLOR);
  }
});

test("drawing level targets preserve horizontal labels and avoid covering the live price", () => {
  const points = [{ timestamp: 1000, value: 100 }, { timestamp: 2000, value: 90 }];
  const horizontal = { name: "horizontalStraightLine", points: points.slice(0, 1) };
  const sloped = { name: "rayLine", points };
  assert.deepEqual(drawingPriceTargets([horizontal, sloped]).map(({ point, anchor }) => [point.value, anchor]), [[100, "always"]]);
  assert.deepEqual(drawingPriceTargets([horizontal, sloped], sloped).map(({ point }) => point.value), [100, 100, 90]);
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
