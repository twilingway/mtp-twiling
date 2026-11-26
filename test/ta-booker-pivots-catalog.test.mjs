import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const load = sourceLoader();
const { bookerPivotStudies } = load(
  "model/technical-indicators/catalog-expansion/booker-pivots.ts"
);
const { technicalDefinitionForCatalog } = load("model/technical-indicators/catalog.ts");
const { createTechnicalIndicatorInstance, isTechnicalIndicatorInstance } = load(
  "model/technical-indicators/instances.ts"
);
const { TechnicalRenderData } = load("charts/technical-render-data.ts");
const [intraday, missed, ghost] = bookerPivotStudies;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 0, 5);
const intradayParams = {
  showHour: false,
  showFourHours: true,
  showEightHours: false,
  periodsBack: 20
};
const missedParams = { showDay: true, showWeek: false, showMonth: false, periodsBack: 20 };
const weeklyGhost = { showFourHours: false, showDay: false, showWeek: true, showMonth: false };

function context(chartInterval) {
  return {
    chartInterval,
    historicalVolatilityPeriodsPerYear: 365,
    continuousSession: true,
    exchangeTimeZone: "UTC"
  };
}

function candle(timestamp, open, high = open, low = open, close = open) {
  return { timestamp, open, high, low, close, volume: 100 };
}

test("catalog reaches all Booker period studies and compiles future lines with saved styles", () => {
  for (const { catalogId, definition } of bookerPivotStudies) {
    assert.equal(technicalDefinitionForCatalog(catalogId), definition.id);
    const instance = createTechnicalIndicatorInstance(definition.id, definition.id);
    assert.ok(isTechnicalIndicatorInstance(JSON.parse(JSON.stringify(instance))));
  }
  const renderData = new TechnicalRenderData(context("1h"));
  const instance = createTechnicalIndicatorInstance("booker-ziv-ghost-pivots", "ghost", {
    params: { ...weeklyGhost, showWeek: false, showFourHours: true },
    styles: { "4h": { visible: true, color: "#123456", width: 2, lineStyle: "dashed" } }
  });
  renderData.setData([candle(START, 10, 14, 9, 13), candle(START + HOUR, 13, 15, 12, 12)]);
  const { outputs, priceRegions } = renderData.compile([instance]);
  assert.deepEqual(outputs, []);
  assert.equal(priceRegions.length, 1);
  assert.equal(priceRegions[0].startTimestamp, START + 4 * HOUR);
  assert.equal(priceRegions[0].low, 12);
  assert.equal(priceRegions[0].color, "#123456");
  assert.equal(priceRegions[0].lineStyle, "dashed");
});

test("intraday pivot uses the previous complete bucket and stops across source gaps", () => {
  const bars = [
    candle(START, 10, 12, 10, 11),
    candle(START + HOUR, 11, 13, 10, 12),
    candle(START + 2 * HOUR, 12, 15, 11, 13),
    candle(START + 3 * HOUR, 13, 14, 9, 12),
    candle(START + 4 * HOUR, 20),
    candle(START + 5 * HOUR, 21)
  ];
  const [level] = intraday.priceRegions(bars, intradayParams, context("1h"));
  assert.deepEqual(level, {
    styleId: "4h",
    startTimestamp: START + 4 * HOUR,
    endTimestamp: START + 5 * HOUR,
    startEdge: "left",
    endEdge: "right",
    low: 12,
    high: 12
  });
  assert.deepEqual(
    intraday.priceRegions(
      bars.filter((_, index) => index !== 2),
      intradayParams,
      context("1h")
    ),
    []
  );
  assert.deepEqual(
    intraday.priceRegions(
      [...bars.slice(0, 4), candle(START + 8 * HOUR, 20)],
      intradayParams,
      context("1h")
    ),
    []
  );
  assert.equal(
    intraday.unavailableReason(bars.length, intradayParams, context("3h")),
    "external-data-unavailable"
  );
});

test("missed pivots require observed continuity and disappear on inclusive touches", () => {
  const bars = [
    candle(START, 100, 120, 90, 90),
    candle(START + DAY, 113, 119, 110, 113),
    candle(START + 2 * DAY, 115, 118, 111, 115)
  ];
  const [level] = missed.priceRegions(bars, missedParams, context("1d"));
  assert.equal(level.low, 100);
  assert.equal(level.startTimestamp, START + DAY);
  assert.equal(level.endTimestamp, null);
  assert.deepEqual(
    missed.priceRegions(
      [...bars.slice(0, 2), { ...bars[2], low: 100 }],
      missedParams,
      context("1d")
    ),
    []
  );
  assert.deepEqual(
    missed.priceRegions(
      [...bars.slice(0, 2), { ...bars[2], timestamp: START + 3 * DAY }],
      missedParams,
      context("1d")
    ),
    []
  );
  const withIncompleteRange = [...bars.slice(0, 2), { ...bars[2], low: null }];
  assert.deepEqual(missed.priceRegions(withIncompleteRange, missedParams, context("1d")), []);
});

test("ghost defaults use the daily source and a moving weekly projection anchors on Monday", () => {
  const expected = { showFourHours: true, showDay: true, showWeek: true, showMonth: true };
  assert.deepEqual(
    Object.fromEntries(
      ghost.definition.parameters.map(({ key, defaultValue }) => [key, defaultValue])
    ),
    expected
  );
  const bars = [candle(START, 10, 16, 9, 12), candle(START + DAY, 12, 18, 11, 12)];
  const [first] = ghost.priceRegions(bars, weeklyGhost, context("1d"));
  assert.equal(first.styleId, "1w");
  assert.equal(first.startTimestamp, START + 7 * DAY);
  assert.equal(first.low, 13);
  assert.equal(first.endTimestamp, null);
  const [later] = ghost.priceRegions(
    [...bars.slice(0, 1), { ...bars[1], close: 15 }],
    weeklyGhost,
    context("1d")
  );
  assert.equal(later.low, 14);
  assert.deepEqual(ghost.priceRegions(bars.slice(1), weeklyGhost, context("1d")), []);
  const [daily] = ghost.priceRegions(
    bars,
    { ...weeklyGhost, showDay: true, showWeek: false },
    context("1d")
  );
  assert.equal(daily.styleId, "1d");
  assert.equal(daily.startTimestamp, START + 2 * DAY);
});

test("exchange-supplied period marks permit actual non-UTC boundaries", () => {
  const boundary = START + 10 * HOUR;
  const followingOpening = START + 18 * HOUR;
  const bars = [candle(boundary, 20, 22, 18, 21)];
  const noCalendar = {
    ...context("1h"),
    continuousSession: false,
    exchangeTimeZone: "Europe/Moscow"
  };
  assert.equal(
    ghost.unavailableReason(bars.length, weeklyGhost, noCalendar),
    "external-data-unavailable"
  );
  const supplied = {
    ...noCalendar,
    bookerPivotPeriods: {
      "1w": {
        periods: [
          {
            start: boundary,
            end: START + 14 * HOUR,
            closed: false,
            coverageComplete: true,
            low: 18,
            high: 22,
            close: 21,
            observedRanges: []
          }
        ],
        nextStart: followingOpening
      }
    }
  };
  const [level] = ghost.priceRegions(bars, weeklyGhost, supplied);
  assert.equal(level.startTimestamp, followingOpening);
  assert.equal(level.low, (18 + 22 + 21) / 3);
});

function canvas() {
  const paths = [];
  const ctx = new Proxy(
    {
      moveTo: (x, y) => paths.push(["move", x, y]),
      lineTo: (x, y) => paths.push(["line", x, y])
    },
    { get: (target, key) => target[key] ?? (() => {}) }
  );
  return { ctx, paths };
}

const projected = {
  styleId: "4h",
  color: "#2962ff",
  width: 1,
  opacity: 1,
  lineStyle: "solid",
  startTimestamp: START + 4 * HOUR,
  endTimestamp: null,
  startEdge: "left",
  endEdge: "center",
  low: 30,
  high: 30
};

test("Lightweight calendar regions project a future boundary on the logical scale", () => {
  const fixture = nativeFixture("lightweight");
  try {
    const { lightweightCalendarRegions } = fixture.load("charts/lightweight-calendar-regions.ts");
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
    const { ctx, paths } = canvas();
    const layer = lightweightCalendarRegions(
      chart,
      { timeframe: "1h" },
      () => true,
      () => series
    );
    layer.update([projected], { index: 1, timestamp: START + HOUR });
    primitive
      .paneViews()[0]
      .renderer()
      .drawBackground({
        useMediaCoordinateSpace: (draw) =>
          draw({ context: ctx, mediaSize: { width: 100, height: 90 } })
      });
    assert.deepEqual(paths, [
      ["move", 35, 30],
      ["line", 100, 30]
    ]);
    layer.dispose();
  } finally {
    fixture.adapter.destroy();
  }
});

test("KLine calendar region uses real future slot range while chart candles remain unchanged", () => {
  const fixture = nativeFixture("kline");
  try {
    const { klineCalendarRegions } = fixture.load("charts/kline-calendar-regions.ts");
    const layer = klineCalendarRegions(fixture.native, { timeframe: "1h" }, () => true);
    layer.update([projected]);
    const indicator = fixture
      .activeIndicators()
      .find(({ name }) => name === "PERSONAL_TA_PRICE_REGIONS");
    const { ctx, paths } = canvas();
    const bars = [candle(START, 15), candle(START + HOUR, 16)];
    indicator.draw({
      ctx,
      indicator,
      bounding: { width: 100, height: 90 },
      barSpace: { bar: 10 },
      kLineDataList: bars,
      visibleRange: { from: 0, to: 2, realTo: 10 },
      xAxis: { convertToPixel: (index) => index * 10 },
      yAxis: { convertToPixel: (value) => value }
    });
    assert.equal(bars.length, 2);
    assert.deepEqual(paths, [
      ["move", 35, 30],
      ["line", 100, 30]
    ]);
    layer.dispose();
  } finally {
    fixture.adapter.destroy();
  }
});
