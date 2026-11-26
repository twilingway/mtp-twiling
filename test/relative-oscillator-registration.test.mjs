import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { backup, closeSeries, gitSource } from "./keltner-fixture.mjs";
import { klineFixture } from "./ta-render-kline-fixture.mjs";
import { fixture as lightweightFixture } from "./ta-render-lightweight-fixture.mjs";

const load = createSourceLoader();
const core = load("model/technical-indicators/index.js");
const catalog = load("model/technical-indicators/catalog.js");
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const { presentationColor } = load("model/technical-indicators/presentation.js");
const { assertReadableDrivePayload } = load("services/drive/reader-guard.js");
const old = createSourceLoader({}, (path) =>
  gitSource("a9b6a37e451f9d0f2194d8cdc1d3006b8c1c1a3d", path)
);
const ids = [
  ["STD;Stochastic_RSI", "stochastic-rsi"],
  ["STD;Coppock%1Curve", "coppock-curve"],
  ["STD;Relative_Vigor_Index", "relative-vigor-index"],
  ["STD;Relative_Volatility_Index", "relative-volatility-index"],
  ["STD;Bull%Bear%Power", "bull-bear-power"]
];
const make = (id, params = {}, options = {}) =>
  core.createTechnicalIndicatorInstance(id, id, { params, ...options });
const rows = (closes, volume = 10) =>
  closes.map((close, index) => ({
    timestamp: (index + 1) * 1000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume
  }));

test("all five catalog entries resolve to separate panes and preserve styles through Drive", () => {
  for (const [publicId, id] of ids) {
    assert.equal(catalog.technicalDefinitionForCatalog(publicId), id);
    assert.ok(
      catalog.technicalCatalogEntries("ru").find((entry) => entry.id === publicId).available
    );
    assert.equal(make(id).pane.kind, "pane");
  }
  const instances = [
    make(
      "stochastic-rsi",
      { rsiLength: 9, stochasticLength: 7 },
      {
        styles: { upperBand: { color: "#123456", width: 3, visible: true } }
      }
    ),
    make("coppock-curve", { wmaLength: 6, longRocLength: 15, shortRocLength: 7 }),
    make("relative-vigor-index", { length: 5 }),
    make(
      "relative-volatility-index",
      {
        length: 12,
        maType: "SMA + Bollinger Bands",
        maLength: 5,
        bbMultiplier: 2.5
      },
      {
        styles: {
          "reference-80": { color: "#789ABC", width: 2, visible: false },
          background: { color: "#123456", width: 1, visible: true, opacity: 0.2 }
        }
      }
    ),
    make("bull-bear-power", { length: 12 })
  ];
  const payload = backup(instances);
  assert.deepEqual(assertReadableDrivePayload(payload).layout.technicalIndicators, instances);
  assert.throws(() => old("services/drive/reader-guard.js").assertReadableDrivePayload(payload), {
    code: "unsupported-format"
  });
  for (const instance of instances.slice(2, 4)) {
    assert.equal(Object.hasOwn(instance.params, "offset"), false);
    assert.equal(
      core.isTechnicalIndicatorInstance({ ...instance, params: { ...instance.params, offset: 5 } }),
      false
    );
  }
});

test("RVGI retains OHLC seed, first signal and timestamps under history append", () => {
  const input = rows([4, 7, 5, 8, 3, 6, 2]).map((bar) => ({
    ...bar,
    open: 4,
    high: 8,
    low: 2
  }));
  const instance = make("relative-vigor-index", { length: 1 });
  const result = core.calculateTechnicalIndicator(instance, input);
  closeSeries(result.series.value, [null, null, null, 1 / 3, 1 / 3, 1 / 4, 1 / 9]);
  closeSeries(result.series.signal, [null, null, null, null, null, null, 29 / 108]);
  assert.deepEqual(
    result.timestamps,
    input.map((bar) => bar.timestamp)
  );
  assert.equal(result.warmupBars, 4);
  assert.deepEqual(result.historyRequirement.firstPossibleIndex, { value: 3, signal: 6 });
  assert.deepEqual(
    core.calculateTechnicalIndicator(instance, input.slice(0, 5)).series.value,
    result.series.value.slice(0, 5)
  );
});

test("RVI uses its close-based kernel in the saved definition and leaves missing volume undefined", () => {
  const input = rows([1, 3, 2, 6, 4], null);
  const instance = make("relative-volatility-index", {
    length: 2,
    maLength: 2,
    maType: "SMA + Bollinger Bands"
  });
  const result = core.calculateTechnicalIndicator(instance, input);
  closeSeries(result.series.value, [null, 100, 650 / 7, 11450 / 121, 74425 / 899]);
  closeSeries(result.series.smoothing.slice(0, 3), [null, null, 675 / 7]);
  closeSeries(result.series.upperBand.slice(0, 3), [null, null, 725 / 7]);
  assert.equal(result.warmupBars, 2);
  assert.deepEqual(result.historyRequirement.firstPossibleIndex, { value: 1, smoothing: 2 });
  const anotherRange = input.map((bar) => ({ ...bar, high: bar.high + 12, low: bar.low - 17 }));
  assert.deepEqual(core.calculateTechnicalIndicator(instance, anotherRange).series, result.series);
  const vwma = make("relative-volatility-index", { length: 2, maLength: 2, maType: "VWMA" });
  const volumeMissing = core.calculateTechnicalIndicator(vwma, input);
  assert.deepEqual(volumeMissing.series.value, result.series.value);
  assert.deepEqual(volumeMissing.series.smoothing, Array(input.length).fill(null));
  assert.deepEqual(volumeMissing.series.lowerBand, Array(input.length).fill(null));
});

test("BBP signs and RVI fixed precision reach both chart adapters", async (t) => {
  const data = new TechnicalRenderData();
  data.setData(rows([4, 6, 4, 7, 4, 6, 5, 4]));
  const rvi = make("relative-volatility-index", {
    length: 2,
    maLength: 2,
    maType: "SMA + Bollinger Bands"
  });
  const bbp = make("bull-bear-power", { length: 2 }, { order: 1 });
  const graph = data.compile([rvi, bbp]);
  const histogram = graph.outputs.find((output) => output.instanceId === bbp.id);
  closeSeries(histogram.values.slice(0, 3), [0, 4 / 3, -8 / 9]);
  assert.deepEqual(
    histogram.values
      .slice(0, 3)
      .map((_, index) => presentationColor(histogram.presentation, index)),
    ["#089981", "#089981", "#F23645"]
  );
  assert.deepEqual(
    graph.references.map((reference) => reference.value),
    [80, 50, 20]
  );
  assert.ok(graph.fills.some((fill) => fill.id === "bollinger-fill" && fill.from[2] !== null));

  const lightweight = lightweightFixture(graph);
  t.after(() => lightweight.adapter.dispose());
  lightweight.render();
  const native = lightweight.series().find((series) => series.data[2]?.color === "#F23645");
  assert.ok(native);
  assert.equal(native.data[1].color, "#089981");
  assert.equal(native.data[0].value, 0);

  const kline = klineFixture(6);
  t.after(() => kline.dispose());
  kline.set(graph);
  await kline.ready();
  const klineRvi = kline
    .entries("technical:relative-volatility-index")
    .find((item) => item.figures.some((figure) => figure.key === "value"));
  assert.equal(klineRvi.precision, 2);
  closeSeries(
    klineRvi.result.slice(0, 3).map((row) => row.value ?? null),
    [null, 100, 260 / 3]
  );
  const klineBbp = kline
    .entries("technical:bull-bear-power")
    .find((item) => item.figures.some((figure) => figure.type === "bar"));
  assert.ok(klineBbp);
  const klineColor = kline.load("charts/kline-technical-geometry.js").klineTechnicalColor;
  assert.equal(klineColor(histogram, 1), "#089981");
  assert.equal(klineColor(histogram, 2), "#F23645");
});
