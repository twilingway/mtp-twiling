import test from "node:test";
import assert from "node:assert/strict";
import { nativeFixture } from "./native-technical-fixture.mjs";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const load = sourceModules();
const { chartPriceFormat, lightweightPriceFormat, nativePriceStep } =
  load("charts/price-format.ts");
const cny = {
  symbol: "CNYRUBF",
  ticker: "CNYRUBF",
  uid: "exact-cny",
  type: "future",
  classCode: "SPBFUT",
  currency: "rub",
  step: null,
  price: 12.298
};

test("MOEX contract fallback applies only to missing ticks for the confirmed CNYRUBF derivative", () => {
  assert.equal(nativePriceStep(cny), 0.001);
  assert.equal(chartPriceFormat(cny).precision, 3);
  assert.equal(nativePriceStep({ ...cny, step: 0.05 }), 0.05);
  assert.equal(nativePriceStep({ ...cny, nativePriceStep: 0.005 }), 0.005);
  assert.equal(nativePriceStep({ ...cny, type: "currency" }), null);
  assert.equal(nativePriceStep({ ...cny, symbol: "OTHER", ticker: "OTHER" }), null);
  assert.equal(nativePriceStep({ ...cny, uid: "bybit:spot:CNYRUBF" }), null);
  assert.equal(nativePriceStep({ ...cny, classCode: "OTHER" }), null);
});

test("formatters preserve exact decimal precision and decouple tick spacing for unsupported bases", () => {
  for (const [step, precision] of [
    [1, 0],
    [0.05, 2],
    [0.001, 3],
    [0.0625, 4]
  ]) {
    const format = chartPriceFormat({ symbol: "OTHER", step });
    assert.equal(format.precision, precision);
    assert.deepEqual(lightweightPriceFormat(format), { type: "price", precision, minMove: step });
  }
  for (const [step, sample, expected, base] of [
    [2.5, 12.5, "12.5", 10],
    [3, 12, "12", 1],
    [0.03, 12.09, "12.09", 100]
  ]) {
    const format = lightweightPriceFormat(chartPriceFormat({ symbol: "OTHER", step }));
    assert.equal(format.type, "custom");
    assert.equal(format.base, base);
    assert.equal(format.minMove, step);
    assert.equal(format.formatter(sample), expected);
  }
});

for (const engine of ["lightweight", "kline"]) {
  test(`${engine}: init and live metadata update every native price formatter without changing candles`, () => {
    const f = nativeFixture(engine, [], { row: cny });
    const priceSeries = () =>
      f.activeSeries().filter((item) => item.options().priceScaleId !== "volume");
    function assertPrecision(expected, step) {
      if (engine === "kline") assert.deepEqual(f.precisionWrites.at(-1), [expected, 0]);
      else {
        assert.equal(priceSeries().length, 3);
        for (const series of priceSeries())
          assert.deepEqual(series.options().priceFormat, {
            type: "price",
            precision: expected,
            minMove: step
          });
      }
    }
    assertPrecision(3, 0.001);
    const bar = {
      timestamp: Date.UTC(2025, 0, 20),
      open: 12.29,
      high: 12.3,
      low: 12.29,
      close: 12.298,
      volume: 100
    };
    f.adapter.setData([bar], false);
    f.adapter.source = { owner: "one", uid: cny.uid, viewKey: "test" };
    const writes = f.primaryWrites();
    f.adapter.updatePriceFormat({ owner: "one", uid: cny.uid, step: 1, priceHint: 12 });
    f.ready();
    assertPrecision(0, 1);
    assert.equal(f.primaryWrites(), writes);
    f.adapter.updatePriceFormat({ owner: "two", uid: cny.uid, step: 0.05 });
    assertPrecision(0, 1);
    f.adapter.destroy();
  });
}
