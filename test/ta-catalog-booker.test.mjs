import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const load = sourceLoader();
const { bookerStudies } = load("model/technical-indicators/catalog-expansion/booker.ts");
const { compilePresentation, presentationColor } = load(
  "model/technical-indicators/presentation.ts"
);
const { presentationRuns } = load("model/technical-indicators/presentation-geometry.ts");
const { technicalDefinitionForCatalog } = load("model/technical-indicators/catalog.ts");
const { createTechnicalIndicatorInstance, isTechnicalIndicatorInstance } = load(
  "model/technical-indicators/instances.ts"
);
const { TechnicalRenderData } = load("charts/technical-render-data.ts");
const [woodies, divergence, reversal] = bookerStudies;
const closedTail = { historicalVolatilityPeriodsPerYear: 365, lastBarClosed: true };

function bars(prices) {
  return prices.map((value, index) => ({
    timestamp: (index + 1) * 60_000,
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 10
  }));
}

function defaults(study) {
  return Object.fromEntries(
    study.definition.parameters.map(({ key, defaultValue }) => [key, defaultValue])
  );
}

function compile(study, candles, series) {
  return compilePresentation(study.definition.presentation, {
    timestamps: candles.map(({ timestamp }) => timestamp),
    series,
    visible: true,
    collapsed: false
  });
}

test("all three studies resolve from the catalog, persist, and compile for chart adapters", () => {
  const renderData = new TechnicalRenderData();
  renderData.setData(bars(Array.from({ length: 60 }, (_, index) => index + 2)));
  for (const { catalogId, definition } of bookerStudies) {
    assert.equal(technicalDefinitionForCatalog(catalogId), definition.id);
    const instance = createTechnicalIndicatorInstance(definition.id, definition.id);
    assert.ok(isTechnicalIndicatorInstance(JSON.parse(JSON.stringify(instance))));
    const { outputs } = renderData.compile([instance]);
    assert.equal(outputs.length, definition.outputs.length);
    assert.deepEqual(
      outputs.map(({ presentation }) => presentation.geometry.kind),
      definition.presentation.plots.map(({ geometry }) => geometry.kind)
    );
  }
  assert.throws(
    () =>
      createTechnicalIndicatorInstance("booker-reversal", "invalid", {
        params: { oversold: 90, overbought: 80 }
      }),
    RangeError
  );
});

test("Woodies CCI renders one colored column per observed CCI", () => {
  const candles = bars(Array.from({ length: 19 }, (_, index) => index + 2));
  const params = defaults(woodies);
  assert.deepEqual(params, { slowLength: 14, fastLength: 6 });
  assert.equal(woodies.history(params).warmupBars, 6);
  const series = woodies.calculate(candles, params);
  assert.ok(series.fast[5] > 0);
  assert.equal(series.slow[12], null);
  const { plots } = compile(woodies, candles, series);
  const histograms = plots.filter(({ geometry }) => geometry.kind === "columns");
  const colors = candles.map((_, index) =>
    histograms.map((plot) => presentationColor(plot, index)).filter(Boolean)
  );
  assert.ok(colors.slice(0, 13).every((entry) => !entry.length));
  assert.deepEqual(colors.slice(13), [
    ["#787b86"],
    ["#787b86"],
    ["#787b86"],
    ["#787b86"],
    ["#e7a917"],
    ["#089981"]
  ]);
  for (const index of [13, 14, 15, 16, 17, 18])
    assert.deepEqual(histograms.map(({ values }) => values[index]).filter(Number.isFinite), [
      series.slow[index]
    ]);
  const falling = woodies.calculate(bars([9, 8, 7, 6, 5, 4, 3, null, 2, 1]), {
    slowLength: 2,
    fastLength: 2
  });
  assert.ok(falling.falling[6] < 0);
  assert.equal(falling.falling[8], null);
  assert.ok(falling.neutral[8] < 0);
});

const divergenceParams = {
  ...defaults(divergence),
  length: 2,
  left: 1,
  right: 1,
  minimumDistance: 3,
  maximumDistance: 3
};

test("RSI divergence line is withheld while the confirmation bar is forming", () => {
  const candles = bars([10, 12, 11, 10, 16, 15, 14, 17, 16]);
  candles[6].low = 9;
  for (const prefix of [candles.slice(0, 7), candles.slice(0, 8)]) {
    const result = divergence.calculate(prefix, divergenceParams);
    assert.ok(result.oscillator.some(Number.isFinite));
    assert.ok(result.regularBullish.every((value) => value === null));
  }
  const result = divergence.calculate(candles, divergenceParams);
  assert.deepEqual(presentationRuns(result.regularBullish), [{ first: 3, last: 6 }]);
  assert.equal(result.regularBullish[3], result.oscillator[3]);
  assert.equal(result.regularBullish[6], result.oscillator[6]);
  assert.ok(result.regularBullish[4] > result.regularBullish[3]);
  assert.equal(compile(divergence, candles, result).plots[1].geometry.gaps, "break");
  const trusted = divergence.calculate(candles.slice(0, 8), divergenceParams, closedTail);
  assert.deepEqual(trusted.regularBullish, result.regularBullish.slice(0, 8));
});

test("RSI settings hide hidden signals until selected and reject an inverted distance", () => {
  const candles = bars([10, 12, 11, 10, 13, 12, 11, 14]);
  const hidden = divergence.calculate(candles, divergenceParams, closedTail);
  assert.ok(hidden.hiddenBullish.every((value) => value === null));
  const visible = divergence.calculate(
    candles,
    { ...divergenceParams, showHiddenBullish: true },
    closedTail
  );
  assert.deepEqual(presentationRuns(visible.hiddenBullish), [{ first: 3, last: 6 }]);
  assert.equal(divergence.validParams({ ...divergenceParams, maximumDistance: 2 }), false);
  assert.equal(
    divergence.unavailableReason(1_000_000, {
      ...divergenceParams,
      left: 10_000
    }),
    "calculation-limit"
  );
});

test("separate RSI divergence segments leave a gap on their shared series", () => {
  const candles = bars([10, 12, 11, 10, 16, 15, 14, 17, 16, 25, 24, 23, 33, 32, 31, 35, 34]);
  candles[6].low = 9;
  candles[14].low = 22;
  const { regularBullish } = divergence.calculate(candles, divergenceParams);
  assert.deepEqual(presentationRuns(regularBullish), [
    { first: 3, last: 6 },
    { first: 11, last: 14 }
  ]);
});

test("Booker triangles use the Low and High of the confirmed signal candles", () => {
  const candles = bars([10, 9, 11, 9, 10]);
  Object.assign(candles[2], { low: 10, high: 20 });
  Object.assign(candles[3], { low: 0, high: 10 });
  const params = {
    fastLength: 1,
    slowLength: 3,
    kLength: 1,
    slowing: 1,
    overbought: 80,
    oversold: 20
  };
  const live = reversal.calculate(candles.slice(0, 3), params);
  assert.deepEqual(live.bullish, [null, null, null]);
  const closed = reversal.calculate(candles, params);
  assert.deepEqual(closed, {
    bullish: [null, null, 10, null, null],
    bearish: [null, null, null, 10, null]
  });
  assert.deepEqual(
    compile(reversal, candles, closed).plots.map(({ geometry }) => geometry),
    [
      {
        kind: "marker",
        shape: "triangle-up",
        placement: "below",
        size: { unit: "pine-relative", value: 2 }
      },
      {
        kind: "marker",
        shape: "triangle-down",
        placement: "above",
        size: { unit: "pine-relative", value: 2 }
      }
    ]
  );
  assert.equal(reversal.calculate(candles, { ...params, oversold: 10 }).bullish[2], null);
  assert.equal(reversal.validParams({ ...params, oversold: 80 }), false);
});

for (const engine of ["lightweight", "kline"]) {
  test(`${engine}: Booker studies attach to the price chart and separate indicator panes`, () => {
    const fixture = nativeFixture(engine);
    try {
      const { createTechnicalIndicatorInstance: create } = fixture.load(
        "model/technical-indicators/instances.ts"
      );
      const candles = bars([10, 9, 11, 9, 10, ...Array.from({ length: 55 }, (_, i) => i + 11)]);
      Object.assign(candles[2], { low: 10, high: 20 });
      Object.assign(candles[3], { low: 0, high: 10 });
      const instances = [
        create("woodies-cci", "woodies"),
        create("rsi-divergence", "divergence"),
        create("booker-reversal", "reversal", {
          params: {
            fastLength: 1,
            slowLength: 3,
            kLength: 1,
            slowing: 1,
            overbought: 80,
            oversold: 20
          }
        })
      ];
      fixture.adapter.setData(candles);
      fixture.adapter.updateTechnicalIndicators(instances, []);
      fixture.ready();
      assert.deepEqual(
        fixture.adapter
          .technicalPaneMetrics()
          .map(({ key }) => key)
          .sort(),
        ["pane:divergence", "pane:woodies", "price"]
      );
      if (engine === "lightweight") {
        const series = fixture.activeSeries().slice(4);
        assert.equal(series.filter(({ type }) => type === "Histogram").length, 4);
        assert.ok(
          series.some(
            ({ data }) =>
              data[2]?.time === candles[2].timestamp / 1000 && data[2]?.value === candles[2].low
          )
        );
        assert.ok(
          series.some(
            ({ data }) =>
              data[3]?.time === candles[3].timestamp / 1000 && data[3]?.value === candles[3].high
          )
        );
      } else {
        const markers = fixture
          .activeIndicators()
          .find(({ name }) => name.startsWith("PERSONAL_TA_PRICE_"));
        assert.equal(markers.result[2].bullish, candles[2].low);
        assert.equal(markers.result[3].bearish, candles[3].high);
      }
    } finally {
      fixture.adapter.destroy();
    }
  });
}
