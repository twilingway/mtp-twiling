import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const load = createSourceLoader();
const { trendStudies } = load("model/technical-indicators/catalog-expansion/trend.js");
const { compilePresentation, presentationColor } = load(
  "model/technical-indicators/presentation.js"
);
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const { technicalDefinitionForCatalog } = load("model/technical-indicators/catalog.js");
const { createTechnicalIndicatorInstance, calculateTechnicalIndicator } = load(
  "model/technical-indicators/index.js"
);

function candles(prices) {
  return prices.map((close, index) => ({
    timestamp: 1000 + index * 60000,
    close,
    open: close,
    high: close === null ? null : close + 1,
    low: close === null ? null : close - 1,
    volume: 100 + index
  }));
}

function calculate(id, prices, params) {
  return calculateTechnicalIndicator(
    createTechnicalIndicatorInstance(id, id, { params }),
    candles(prices)
  );
}

test("trend studies select the real catalog entries and retain their drawing placement", () => {
  assert.equal(trendStudies.length, 8);
  for (const { catalogId, definition } of trendStudies) {
    assert.equal(technicalDefinitionForCatalog(catalogId), definition.id);
    const instance = createTechnicalIndicatorInstance(definition.id, definition.id);
    assert.equal(instance.pane.kind, definition.defaultPane);
    const parameters = Object.fromEntries(
      definition.parameters.map(({ key, defaultValue }) => [key, defaultValue])
    );
    assert.deepEqual(instance.params, parameters);
  }
});

test("the regression channel covers only the latest complete window and honors side toggles", () => {
  const params = { length: 3, useUpperDeviation: false, lowerDeviation: 1 };
  const { series, warmupBars } = calculate("linear-regression-channel", [70, 10, 13, 10], params);
  assert.equal(warmupBars, 3);
  assert.deepEqual(series.center, [null, 11, 11, 11]);
  assert.deepEqual(series.upper, [null, null, null, null]);
  assert.equal(series.lower[0], null);
  assert.ok(series.lower.slice(1).every((value) => Math.abs(value - (11 - Math.SQRT2)) < 1e-12));
  assert.deepEqual(
    calculate("linear-regression-channel", [70, 10, null, 10], params).series.center,
    [null, null, null, null]
  );
});

test("both chart adapters retain the enabled half of the regression channel on the price pane", (t) => {
  const instance = createTechnicalIndicatorInstance("linear-regression-channel", "channel", {
    params: { length: 3, useUpperDeviation: false }
  });
  const bars = candles([70, 10, 13, 10]);
  const render = new TechnicalRenderData();
  render.setData(bars);
  const { fills } = render.compile([instance]);
  assert.ok(fills.find(({ id }) => id === "upperChannel").from.every((value) => value === null));
  assert.ok(
    fills
      .find(({ id }) => id === "lowerChannel")
      .to.slice(1)
      .every(Number.isFinite)
  );

  const lightweight = nativeFixture("lightweight");
  const kline = nativeFixture("kline");
  for (const fixture of [lightweight, kline]) {
    t.after(() => fixture.adapter.destroy());
    fixture.adapter.setData(bars);
    fixture.adapter.updateTechnicalIndicators([instance], []);
    fixture.ready();
  }
  const lines = lightweight
    .activeSeries()
    .filter(({ type }) => type === "Line")
    .slice(-3);
  assert.equal(lines.length, 3);
  assert.ok(lines.every(({ pane }) => pane === lightweight.panes[0]));
  assert.deepEqual(
    lines.map(({ data }) => data.map(({ value }) => value ?? null)),
    [
      [null, 11, 11, 11],
      [null, null, null, null],
      [null, 11 - 2 * Math.SQRT2, 11 - 2 * Math.SQRT2, 11 - 2 * Math.SQRT2]
    ]
  );
  const channel = kline
    .activeIndicators()
    .find(({ figures }) => figures?.some(({ key }) => key === "center"));
  assert.equal(channel.paneId, "candle_pane");
  assert.equal(channel.result[0].center, undefined);
  assert.equal(channel.result[3].center, 11);
  assert.equal(channel.result[3].upper, undefined);
  assert.equal(channel.result[3].lower, lines[2].data[3].value);
});

test("Trend Strength Index plots signed Pearson correlation with a zero-referenced fill", () => {
  const prices = [10, 12, 14, 12, 10, null];
  const result = calculate("trend-strength-index", prices, { length: 3 });
  assert.deepEqual(result.series.value, [null, null, 1, 0, -1, null]);
  const study = trendStudies.find(({ definition }) => definition.id === "trend-strength-index");
  const { fills } = compilePresentation(study.definition.presentation, {
    timestamps: result.timestamps,
    series: result.series,
    visible: true,
    collapsed: false
  });
  assert.deepEqual(fills[0].to, Array(prices.length).fill(0));
  assert.notEqual(fills[0].color, fills[0].belowColor);
});

test("risk and long-cycle studies report the actual warmup of each available output", () => {
  const mass = calculate("mass-index", [3, 4, 5], { emaLength: 2, sumLength: 2 });
  assert.equal(mass.historyRequirement.kind, "recursive");
  assert.deepEqual(mass.series.value, [null, 2, 2]);
  const ulcer = calculate("ulcer-index", [3, 4, 5, 6], { length: 2 });
  assert.equal(ulcer.warmupBars, 3);
  assert.deepEqual(ulcer.series.value, [null, null, 0, 0]);

  const prices = Array.from({ length: 727 }, (_, i) => 100 + i);
  const special = calculate("pring-special-k", prices, {
    firstSignalLength: 2,
    secondSignalLength: 2
  });
  assert.equal(special.warmupBars, 725);
  assert.equal(special.historyRequirement.lookbackBars, 727);
  assert.equal(special.series.specialK.findIndex(Number.isFinite), 724);
  assert.equal(special.series.signal.findIndex(Number.isFinite), 726);
});

test("RCI preserves ties, smoothing only activates on request, and ribbon lines warm independently", () => {
  const rci = calculate("rank-correlation-index", [10, 12, 15, 12], { length: 4 });
  assert.ok(Math.abs(rci.series.rci[3] - 63.245553203367585) < 1e-9);
  assert.deepEqual(rci.series.average, [null, null, null, null]);
  const smooth = calculate("rank-correlation-index", [10, 12, 14, 13, 12], {
    length: 2,
    maType: "SMA + Bollinger Bands",
    maLength: 2,
    bbMultiplier: 1
  });
  assert.deepEqual(smooth.series.average, [null, null, 100, 0, -100]);
  assert.deepEqual(smooth.series.upper, [null, null, 100, 100, -100]);
  assert.equal(smooth.historyRequirement.denseLookbackBars, 3);
  const ribbon = calculate("rci-ribbon", [10, 12, 14], {
    shortLength: 4,
    middleLength: 2,
    longLength: 3
  });
  assert.equal(ribbon.warmupBars, 2);
  assert.equal(ribbon.historyRequirement.lookbackBars, 4);
  assert.deepEqual(ribbon.series, {
    short: [null, null, null],
    middle: [null, 100, 100],
    long: [null, null, 100]
  });
});

test("Chop Zone columns have constant height, change palette with direction, and leave gaps empty", (t) => {
  const prices = [
    ...Array.from({ length: 40 }, (_, i) => 100 + i * 3),
    ...Array.from({ length: 59 }, (_, i) => 217 - i * 3),
    null
  ];
  const render = new TechnicalRenderData();
  const bars = candles(prices);
  const chop = createTechnicalIndicatorInstance("chop-zone", "chop");
  render.setData(bars);
  const graph = render.compile([chop]);
  const [{ presentation: plot, values }] = graph.outputs;
  assert.equal(values.findIndex(Number.isFinite), 29);
  assert.ok(values.every((value) => value === 1 || value === null));
  assert.equal(values.at(-1), null);
  assert.equal(presentationColor(plot, prices.length - 1), null);
  const upColor = presentationColor(plot, 39);
  const downColor = presentationColor(plot, 89);
  assert.ok(upColor && downColor);
  assert.notEqual(upColor, downColor);

  const lightweight = nativeFixture("lightweight");
  t.after(() => lightweight.adapter.destroy());
  lightweight.adapter.setData(bars);
  lightweight.adapter.updateTechnicalIndicators([chop], []);
  lightweight.ready();
  const columns = lightweight
    .activeSeries()
    .find(({ type, pane }) => type === "Histogram" && pane !== lightweight.panes[0]);
  assert.equal(columns.data[39].value, 1);
  assert.equal(columns.data[39].color, upColor);
  assert.equal(columns.data[89].color, downColor);
  assert.equal(columns.data.at(-1).value, undefined);

  const kline = nativeFixture("kline");
  t.after(() => kline.adapter.destroy());
  kline.adapter.setData(bars);
  kline.adapter.updateTechnicalIndicators([chop], []);
  kline.ready();
  const native = kline
    .activeIndicators()
    .find(
      ({ paneId, figures }) =>
        paneId === "technical:chop" && figures.some(({ key }) => key === "value")
    );
  const zoneFigure = native.figures.find(({ key }) => key === "value");
  const colorAt = (index) =>
    zoneFigure.styles({ current: { indicatorData: native.result[index] } }).color;
  assert.equal(native.result[39].value, 1);
  assert.equal(native.result[89].value, 1);
  assert.equal(native.result.at(-1).value, undefined);
  assert.equal(colorAt(39), upColor);
  assert.equal(colorAt(89), downColor);
});

test("long trend and RCI windows return a calculation limit without discarding exact parameters", () => {
  const prices = Array.from({ length: 16000 }, (_, i) => 100 + i);
  for (const id of ["trend-strength-index", "rank-correlation-index"]) {
    const result = calculate(id, prices, { length: 10000 });
    assert.equal(result.unavailableReason, "calculation-limit", id);
    assert.equal(result.warmupBars, 10000, id);
    assert.equal(result.timestamps.length, prices.length, id);
    assert.ok(
      Object.values(result.series).every((row) => row.every((value) => value === null)),
      id
    );
  }
});
