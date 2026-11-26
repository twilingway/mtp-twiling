import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const load = sourceLoader();
const {
  knoxvilleStudies: [study]
} = load("model/technical-indicators/catalog-expansion/knoxville.ts");
const { rsi } = load("model/technical-indicators/calculations.ts");
const { compileTechnicalPriceRegions } = load("charts/technical-calendar-paint.ts");
const CLOSED = { historicalVolatilityPeriodsPerYear: 365, lastBarClosed: true };
const params = {
  momentumLength: 2,
  rsiLength: 2,
  radius: 1,
  maximumDistance: 6,
  oversold: 30,
  overbought: 70
};

function candles() {
  const closes = [9, 8, 10, 13, 11, 12, 12, 12, 13, 12, 11];
  return closes.map((close, index) => ({
    timestamp: Date.UTC(2026, 0, 3 + index),
    open: close,
    high: index === 3 ? 14 : index === 8 ? 15 : close,
    low: close,
    close,
    volume: 1
  }));
}

const bearish = {
  kind: "sloped-line",
  styleId: "bearish",
  startIndex: 3,
  endIndex: 8,
  line: { from: { index: 3, value: 14 }, through: { index: 8, value: 15 } }
};

test("draws documented bullish and bearish price impulses only after right confirmation", () => {
  const bars = candles();
  const forming = bars.slice(0, 10);
  assert.deepEqual(study.priceRegions(forming, params), []);
  assert.deepEqual(study.priceRegions(forming, params, CLOSED), [bearish]);
  assert.deepEqual(study.priceRegions(bars, params), [bearish]);
  const mirrored = bars.map(({ open, high, low, close, ...bar }) => ({
    ...bar,
    open: 100 - open,
    high: 100 - low,
    low: 100 - high,
    close: 100 - close
  }));
  assert.deepEqual(study.priceRegions(mirrored, params), [
    {
      ...bearish,
      styleId: "bullish",
      line: { from: { index: 3, value: 86 }, through: { index: 8, value: 85 } }
    }
  ]);
});

test("requires a strict RSI threshold and the nearest confirmed extremum of the same side", () => {
  const bars = candles();
  const overbought = rsi(
    bars.map(({ close }) => close),
    params.rsiLength
  )[8];
  assert.ok(overbought > params.overbought);
  assert.deepEqual(study.priceRegions(bars, { ...params, overbought }), []);
  assert.deepEqual(study.priceRegions(bars, { ...params, maximumDistance: 4 }), []);
  bars[5].high = 14.5;
  assert.ok(study.priceRegions(bars, params).every(({ endIndex }) => endIndex !== 8));
  assert.equal(study.validParams({ ...params, radius: params.maximumDistance }), false);
  assert.equal(study.validParams({ ...params, oversold: params.overbought }), false);
});

test("a missing candle field resets both the priming window and the prior pivot", () => {
  const bars = candles();
  bars[6].open = null;
  assert.deepEqual(study.priceRegions(bars, params), []);
  assert.deepEqual(study.priceRegions([], params), []);
  assert.equal(study.history(params).warmupBars, 6);
});

test("the MTP label is explicit in both the library and the price overlay", () => {
  const { technicalCatalogEntries, technicalDefinitionForCatalog } = load(
    "model/technical-indicators/catalog.ts"
  );
  assert.equal(technicalDefinitionForCatalog(study.catalogId), study.definition.id);
  for (const locale of ["ru", "en"]) {
    const entry = technicalCatalogEntries(locale).find(({ id }) => id === study.catalogId);
    assert.equal(entry.available, true);
    assert.match(entry.label, /\(MTP\)$/);
  }
  assert.match(study.definition.title, /\(MTP\)$/);
  assert.match(study.definition.shortTitle, /\(MTP\)$/);
});

function instrumentCanvas() {
  const paths = [];
  return {
    paths,
    ctx: new Proxy(
      {
        moveTo: (x, y) => paths.push([x, y]),
        lineTo: (x, y) => paths.push([x, y])
      },
      { get: (target, key) => target[key] ?? (() => {}) }
    )
  };
}

for (const engine of ["lightweight", "kline"]) {
  test(`${engine}: shared sloped overlay draws between the exact prices of the two pivots`, () => {
    const bars = candles();
    const outputs = compileTechnicalPriceRegions(
      study.priceRegions(bars, params),
      study.definition.priceRegionStyles
    );
    const fixture = nativeFixture(engine);
    try {
      const { paths, ctx } = instrumentCanvas();
      if (engine === "lightweight") {
        const { lightweightCalendarRegions } = fixture.load(
          "charts/lightweight-calendar-regions.ts"
        );
        let primitive;
        const series = {
          attachPrimitive: (value) => {
            primitive = value;
          },
          detachPrimitive() {},
          priceFormatter: () => ({ format: String }),
          priceToCoordinate: (value) => value
        };
        const chart = {
          timeScale: () => ({
            getVisibleLogicalRange: () => ({ from: 0, to: 10 }),
            logicalToCoordinate: (index) => index * 10,
            timeToCoordinate: () => null
          })
        };
        const layer = lightweightCalendarRegions(
          chart,
          { timeframe: "1d" },
          () => true,
          () => series
        );
        layer.update(outputs);
        primitive
          .paneViews()[0]
          .renderer()
          .drawBackground({
            useMediaCoordinateSpace: (draw) =>
              draw({ context: ctx, mediaSize: { width: 100, height: 90 } })
          });
        layer.dispose();
      } else {
        const { klineCalendarRegions } = fixture.load("charts/kline-calendar-regions.ts");
        const layer = klineCalendarRegions(fixture.native, { timeframe: "1d" }, () => true);
        layer.update(outputs);
        const indicator = fixture
          .activeIndicators()
          .find(({ name }) => name === "PERSONAL_TA_PRICE_REGIONS");
        indicator.draw({
          ctx,
          indicator,
          bounding: { width: 100, height: 90 },
          barSpace: { bar: 10 },
          kLineDataList: bars,
          visibleRange: { from: 0, to: 10, realTo: 10 },
          xAxis: { convertToPixel: (index) => index * 10 },
          yAxis: { convertToPixel: (value) => value }
        });
        layer.dispose();
      }
      assert.deepEqual(paths[0], [30, 14]);
      assert.deepEqual(paths.at(-1), [80, 15]);
      assert.equal(ctx.strokeStyle, "rgba(209,67,67,0.95)");
    } finally {
      fixture.adapter.destroy();
    }
  });
}
