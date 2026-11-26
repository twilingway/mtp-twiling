import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { autoFibExtensionAnchors, autoFibRetracementAnchors } = load(
  "model/technical-indicators/catalog-expansion/auto-fib-anchors.js"
);
const { autoFibStudies } = load("model/technical-indicators/catalog-expansion/auto-fib.js");
const { createTechnicalIndicatorInstance } = load("model/technical-indicators/instances.js");
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const [retracement, extension] = autoFibStudies;
const minute = 60_000;
const timestamp = (index) => minute * (index + 1);
const withClosedTail = { historicalVolatilityPeriodsPerYear: 365, lastBarClosed: true };
const bar = (price, index) => ({
  timestamp: timestamp(index),
  open: price,
  high: price === null ? null : price + 1,
  low: price === null ? null : price - 1,
  close: price,
  volume: 10
});
const candles = (prices) => prices.map(bar);
const defaults = (study) =>
  Object.fromEntries(
    study.definition.parameters.map(({ key, defaultValue }) => [key, defaultValue])
  );
const values = (points) => points?.map(({ value }) => value);

test("Auto Fibonacci reflects the official templates' current input and coefficient defaults", () => {
  const expected = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
  for (const study of autoFibStudies) {
    const params = defaults(study);
    assert.equal(params.depth, 10);
    assert.equal(params.extend, "Right");
    assert.equal(params.labelSide, "Left");
    assert.equal(params.showLevels, true);
    assert.equal(params.showPrices, true);
    assert.equal(params.levelFormat, "Values");
    assert.deepEqual(
      study.definition.priceRegionStyles.map(({ id }) => params[id]),
      expected
    );
  }
  assert.equal(defaults(retracement).deviation, 3);
});

test("Retracement waits for confirmed pivots and uses the normalized ATR threshold", () => {
  const prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 130, 125, 110, 115];
  const bars = candles(prices);
  assert.equal(autoFibRetracementAnchors(bars, 2, 0), null);
  assert.equal(autoFibRetracementAnchors(bars, 2, 100, true), null);
  assert.deepEqual(values(autoFibRetracementAnchors(bars, 2, 1, true)), [131, 109]);
  assert.equal(autoFibRetracementAnchors(candles([...prices, null, 120]), 2, 0), null);
});

test("Extension uses the latest confirmed 23.6-to-100 percent pullback and never bridges a gap", () => {
  const bars = candles([90, 81, 95, 119, 117, 111, 121, 145, 141, 136, 143]);
  assert.equal(autoFibExtensionAnchors(bars.slice(0, 7), 2), null);
  assert.deepEqual(values(autoFibExtensionAnchors(bars.slice(0, 9), 2, true)), [80, 120, 110]);
  assert.deepEqual(values(autoFibExtensionAnchors(bars, 2)), [80, 120, 110]);
  assert.deepEqual(values(autoFibExtensionAnchors(bars, 2, true)), [110, 146, 135]);
  assert.equal(autoFibExtensionAnchors([...bars, bar(null, bars.length)], 2, true), null);
});

test("Extension handles a bearish impulse and does not reuse a shallow pullback", () => {
  const shallow = candles([100, 119, 111, 91, 95, 96, 93]);
  assert.equal(autoFibExtensionAnchors(shallow, 2, true), null);
  const usable = candles([100, 119, 111, 91, 101, 105, 99]);
  assert.deepEqual(values(autoFibExtensionAnchors(usable, 2, true)), [120, 90, 106]);
});

test("Extension supports per-level ratios, both ray directions, position, and manual reversal", () => {
  const bars = candles([90, 81, 95, 119, 117, 111, 121]);
  const params = {
    ...defaults(extension),
    depth: 2,
    reverse: true,
    extend: "Both",
    labelSide: "Right",
    levelFormat: "Percent",
    level7: 1.25
  };
  const regions = extension.priceRegions(bars, params, withClosedTail);
  assert.equal(regions.length, 11);
  assert.equal(regions[0].low, 110);
  assert.deepEqual(
    regions.find(({ styleId }) => styleId === "level7"),
    {
      styleId: "level7",
      startTimestamp: timestamp(3),
      endTimestamp: null,
      startEdge: "center",
      endEdge: "center",
      extendLeft: true,
      low: 60,
      high: 60,
      labelEdge: "right",
      label: { name: "125%", price: 60 }
    }
  );
});

test("Catalog instances reach the shared price-region renderer and honor per-level hide", () => {
  const bars = candles([100, 101, 102, 103, 104, 105, 106, 107, 108, 130, 125, 110, 115]);
  const instance = createTechnicalIndicatorInstance("auto-fib-retracement", "fib", {
    params: { depth: 2, deviation: 1, reverse: true, extend: "None", showPrices: false },
    styles: { level1: { visible: false, color: "#ba3d49", width: 1 } }
  });
  const renderer = new TechnicalRenderData(withClosedTail);
  renderer.setData(bars);
  const { priceRegions } = renderer.compile([instance]);
  assert.equal(priceRegions.length, 10);
  assert.equal(
    priceRegions.some(({ styleId }) => styleId === "level1"),
    false
  );
  const origin = priceRegions.find(({ styleId }) => styleId === "level0");
  assert.equal(origin.startTimestamp, timestamp(9));
  assert.equal(origin.endTimestamp, timestamp(11));
  assert.equal(origin.low, 131);
  assert.deepEqual(origin.label, { name: "0" });
});
