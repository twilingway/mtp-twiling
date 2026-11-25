import test from "node:test";
import assert from "node:assert/strict";
import { nativeFixture } from "./native-technical-fixture.mjs";

const bars = Array.from({ length: 80 }, (_, index) => ({
  timestamp: Date.UTC(2025, 0, index + 1),
  open: 100 + index,
  high: 105 + index,
  low: 98 + index,
  close: 100 + index + Math.sin(index / 3),
  volume: 100
}));

for (const engine of ["lightweight", "kline"])
  test(`${engine}: HV uses explicit timeframe annualization without persisting it into instances`, () => {
    const f = nativeFixture(engine),
      { technicalCalculationContext: context } = f.load("charts/technical-calculation-context.ts"),
      { createTechnicalIndicatorInstance: create } = f.load("model/technical-indicators/instances.ts"),
      { calculateTechnicalIndicator: calculate } = f.load("model/technical-indicators/runtime.ts");
    for (const timeframe of ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "1h", "2h", "4h", "1d"])
      assert.equal(context(timeframe).historicalVolatilityPeriodsPerYear, 365);
    assert.equal(context("1w").historicalVolatilityPeriodsPerYear, 365 / 7);
    assert.equal(context("1M").historicalVolatilityPeriodsPerYear, 365 / 7);
    const instance = create("historical-volatility", "volatility"),
      original = JSON.stringify(instance),
      daily = calculate(instance, bars, context("1d")).series.value,
      weekly = calculate(instance, bars, context("1w")).series.value;
    assert.throws(() => calculate(instance, bars));
    assert.ok(Math.abs(daily.at(-1) / weekly.at(-1) - Math.sqrt(7)) < 1e-10);
    assert.equal(JSON.stringify(instance), original);
    f.adapter.destroy();
    for (const timeframe of ["1d", "1w", "1M"]) {
      const native = nativeFixture(engine, [], { timeframe });
      native.adapter.setData(bars);
      native.adapter.updateTechnicalIndicators([instance], []);
      native.ready();
      const expected = calculate(instance, bars, context(timeframe)).series.value;
      if (engine === "lightweight") {
        const actual = native.activeSeries().slice(4)[0].data.map((point) => point.value ?? null);
        assert.deepEqual(actual, expected);
      } else {
        const actual = native.activeIndicators().find((indicator) => indicator.name.startsWith("PERSONAL_TA_"));
        assert.deepEqual(actual.result.map((row) => row.value ?? null), expected);
      }
      native.adapter.destroy();
    }
  });
