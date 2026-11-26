import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = sourceLoader();
const { autoPitchfork, slopedPriceAt } = load(
  "model/technical-indicators/catalog-expansion/auto-sloped-geometry.js"
);
const { autoTrendlines } = load("model/technical-indicators/catalog-expansion/auto-trendlines.js");
const { trendlineBreakout } = load("model/technical-indicators/ta-batch-fib-trendlines.js");
const first = Date.UTC(2026, 0, 1);
const day = 86_400_000;
function candle(price, index) {
  return {
    timestamp: first + (index + Math.floor(index / 5) * 2) * day,
    open: price,
    high: price === null ? null : price + 1,
    low: price === null ? null : price - 1,
    close: price,
    volume: 10
  };
}

const forkSettings = {
  depth: 2,
  variant: "original",
  innerRatio: 0.5,
  outerRatio: 1,
  extendLeft: false,
  transparency: 80
};
const trendSettings = { size: "small", barsToBreakout: 3, extendRight: true };
const forkBars = [2, 10, 7, 1, 6, 12, 8].map(candle);

function orbit(count, period) {
  return Array.from({ length: count }, (_, index) => {
    const phase = (index % period) / period;
    return candle(90 + 2 * Math.floor(index / period) + 30 * (1 - Math.abs(2 * phase - 1)), index);
  });
}

test("pitchfork requires the third confirmed pivot and does not join across data gaps", () => {
  assert.deepEqual(autoPitchfork(forkBars, forkSettings), []);
  assert.deepEqual(
    autoPitchfork(
      [...forkBars, ...[null, 1, 8, 2].map((value, i) => candle(value, i + 7))],
      forkSettings,
      true
    ),
    []
  );
  const actual = autoPitchfork(forkBars, forkSettings, true);
  assert.deepEqual(
    actual.map(({ styleId }) => styleId),
    ["median", "inner", "inner", "outer", "outer", "background"]
  );
  assert.deepEqual(actual[0].line, {
    from: { index: 1, value: 11 },
    through: { index: 4, value: 6.5 }
  });
  assert.equal(actual[0].startIndex, 1);
  assert.equal(actual[0].endIndex, null);
  const price = slopedPriceAt(actual[0].line, 20);
  assert.equal(slopedPriceAt(actual[1].line, 20) - price, 4);
  assert.equal(price - slopedPriceAt(actual[4].line, 20), 8);
  assert.ok(Math.abs(actual.at(-1).fillOpacity - 0.2) < 1e-14);
});

test("pitchfork variants change only the median geometry and honor left rays and background settings", () => {
  const expected = {
    schiff: { from: { index: 1, value: 5.5 }, through: { index: 4, value: 6.5 } },
    "modified-schiff": { from: { index: 2, value: 5.5 }, through: { index: 4, value: 6.5 } },
    inside: { from: { index: 2, value: 5.5 }, through: { index: 5, value: 13 } }
  };
  for (const [variant, line] of Object.entries(expected)) {
    const plotted = autoPitchfork(
      forkBars,
      { ...forkSettings, variant, extendLeft: true, transparency: 100 },
      true
    );
    assert.deepEqual(plotted[0].line, line);
    assert.equal(plotted[0].startIndex, null);
    assert.equal(plotted[0].endIndex, null);
    assert.equal(
      plotted.some(({ kind }) => kind === "sloped-band"),
      false
    );
  }
});

test("small and large trendlines use same-side confirmed extrema and optional base-only geometry", () => {
  const bars = orbit(250, 60);
  for (const size of ["small", "large"]) {
    const lines = autoTrendlines(bars, { ...trendSettings, size, extendRight: false }, true);
    assert.ok(
      lines.some(({ side }) => side === "support"),
      size
    );
    assert.ok(
      lines.some(({ side }) => side === "resistance"),
      size
    );
    for (const line of lines) {
      assert.equal(line.size, size);
      const kind = line.side === "support" ? "low" : "high";
      assert.ok(
        line.anchors.every(
          (anchor) =>
            anchor.kind === kind &&
            anchor.value === bars[anchor.index][kind] &&
            anchor.confirmedAt - anchor.index === (size === "small" ? 5 : 25)
        )
      );
      assert.equal(line.endIndex, line.anchors[1].index);
      assert.equal(line.breakout, null);
    }
  }
});

test("an open bar cannot finish a breakout and pre-confirmation closes cannot count", () => {
  const bars = orbit(90, 20);
  const active = autoTrendlines(bars, trendSettings, true).find(
    ({ side, endIndex }) => side === "support" && endIndex === null
  );
  assert.ok(active);
  const locate = (series, closed) =>
    autoTrendlines(series, trendSettings, closed).find(
      ({ startIndex, anchors }) =>
        startIndex === active.startIndex && anchors[1].index === active.anchors[1].index
    );
  const down = [80, 80, 80].map((value, index) => candle(value, 90 + index));
  assert.equal(locate([...bars, ...down], false).endIndex, null);
  const broken = locate([...bars, ...down], true);
  assert.equal(broken.endIndex, 92);
  assert.equal(broken.breakout.firstOutsideIndex, 90);
  assert.equal(broken.breakout.timestamp, down.at(-1).timestamp);
  const earlier = [100, 100, 90, 90, 90, 90, 90, 90].map(candle);
  const anchors = [
    { index: 0, timestamp: earlier[0].timestamp, value: 100 },
    { index: 1, timestamp: earlier[1].timestamp, value: 100 }
  ];
  assert.equal(trendlineBreakout(earlier, ...anchors, "support", 3, 4).confirmedAt, 7);
  assert.equal(trendlineBreakout(earlier, ...anchors, "support", 3).confirmedAt, 4);
});

function canvas() {
  const sink = [];
  const ctx = {
    save() {},
    restore() {},
    rect() {},
    clip() {},
    setLineDash() {},
    beginPath() {
      this.path = [];
    },
    moveTo(...point) {
      this.path.push(point);
    },
    lineTo(...point) {
      this.path.push(point);
    },
    closePath() {},
    stroke() {
      sink.push(this.path);
    },
    fill() {}
  };
  return { ctx, sink };
}

test("both native adapters render rays with different bar spacing and identical projected prices", () => {
  const line = {
    kind: "sloped-line",
    styleId: "median",
    startIndex: 2,
    endIndex: null,
    line: {
      from: { index: 2, value: 20 },
      through: { index: 4.5, value: 30 }
    },
    color: "#7799cc",
    opacity: 1,
    width: 1,
    lineStyle: "solid"
  };
  const width = 120,
    height = 80;
  const y = (price) => 100 - 10 * Math.log(price);
  const render = (spacing, left) => {
    const plot = (index) => left + spacing * index;
    let primitive, descriptor, layer;
    const points = [];
    const { lightweightCalendarRegions } = load("charts/lightweight-calendar-regions.js");
    const lw = lightweightCalendarRegions(
      {
        timeScale: () => ({
          getVisibleLogicalRange: () => ({ from: -left / spacing, to: (width - left) / spacing }),
          logicalToCoordinate: (index) => (Number.isInteger(index) ? plot(index) : 0),
          timeToCoordinate: () => null
        })
      },
      {},
      () => true,
      () => ({
        attachPrimitive: (item) => {
          primitive = item;
        },
        detachPrimitive: () => {
          primitive = undefined;
        },
        priceToCoordinate: y,
        priceFormatter: () => ({ format: String })
      })
    );
    lw.update([line]);
    const a = canvas();
    primitive
      .paneViews()[0]
      .renderer()
      .drawBackground({
        useMediaCoordinateSpace: (callback) =>
          callback({
            context: a.ctx,
            mediaSize: { width, height }
          })
      });
    points.push(a.sink[0]);
    lw.dispose();
    assert.equal(primitive, undefined);
    const kLoad = createSourceLoader({
      klinecharts: {
        IndicatorSeries: { Normal: "normal" },
        registerIndicator: (next) => {
          descriptor = next;
        }
      }
    });
    const { klineCalendarRegions } = kLoad("charts/kline-calendar-regions.js");
    const kline = klineCalendarRegions(
      {
        createIndicator(value) {
          layer = value;
          return "candle_pane";
        },
        removeIndicator() {
          layer = undefined;
        }
      },
      {},
      () => true
    );
    kline.update([line]);
    const b = canvas();
    descriptor.draw({
      ctx: b.ctx,
      bounding: { width, height },
      barSpace: { bar: spacing },
      kLineDataList: forkBars,
      visibleRange: { from: 0, to: forkBars.length },
      indicator: layer,
      xAxis: { convertToPixel: plot },
      yAxis: { convertToPixel: y }
    });
    points.push(b.sink[0]);
    kline.dispose();
    assert.equal(layer, undefined);
    return points;
  };
  const [lw, kline] = render(10, 5);
  assert.equal(lw.length, kline.length);
  lw.forEach(([x, y], index) => {
    assert.ok(Math.abs(x - kline[index][0]) < 1e-12);
    assert.ok(Math.abs(y - kline[index][1]) < 1e-12);
  });
  assert.deepEqual(lw[0], [25, y(20)]);
  assert.deepEqual(lw.at(-1), [120, y(58)]);
  const [panned] = render(20, -50);
  assert.equal(panned[0][0], 0);
  assert.equal(panned.at(-1)[0], 120);
  assert.equal(panned.at(-1)[1], y(46));
});

test("catalog reopens settings and compiles the visible sloped price decorations only", () => {
  const { createTechnicalIndicatorInstance, isTechnicalIndicatorInstance } = load(
    "model/technical-indicators/instances.js"
  );
  const { technicalDefinitionForCatalog } = load("model/technical-indicators/catalog.js");
  const { TechnicalRenderData } = load("charts/technical-render-data.js");
  assert.equal(technicalDefinitionForCatalog("STD;Auto%1Pitchfork"), "auto-pitchfork");
  assert.equal(
    technicalDefinitionForCatalog("AutoTrendlinesCP@tv-chart_patterns"),
    "auto-trendlines"
  );
  const study = createTechnicalIndicatorInstance("auto-pitchfork", "fork", {
    params: { ...forkSettings, variant: "inside" },
    styles: { inner: { color: "#7799cc", width: 1, visible: false } }
  });
  assert.ok(isTechnicalIndicatorInstance(JSON.parse(JSON.stringify(study))));
  assert.throws(() =>
    createTechnicalIndicatorInstance("auto-pitchfork", "fork", {
      params: { innerRatio: 4, outerRatio: 1 }
    })
  );
  const render = new TechnicalRenderData({
    historicalVolatilityPeriodsPerYear: 365,
    lastBarClosed: true
  });
  render.setData(forkBars);
  const { priceRegions } = render.compile([study]);
  assert.equal(priceRegions.length, 4);
  assert.ok(priceRegions.every(({ styleId }) => styleId !== "inner"));
  assert.deepEqual(render.compile([{ ...study, visible: false }]).priceRegions, []);
  render.setData(orbit(90, 20));
  const trend = createTechnicalIndicatorInstance("auto-trendlines", "trend", {
    params: { showPivots: true, size: "small" }
  });
  const [rays, markers] = ["sloped-line", "price-circle"].map((kind) =>
    render.compile([trend]).priceRegions.filter((item) => item.kind === kind)
  );
  assert.ok(rays.length > 0);
  assert.ok(markers.length >= 2);
  assert.equal(
    new Set(markers.map(({ timestamp, price }) => `${timestamp}/${price}`)).size,
    markers.length
  );
});
