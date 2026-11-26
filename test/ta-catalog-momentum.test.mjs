import assert from "node:assert/strict";
import test from "node:test";
import { backup, closeSeries } from "./keltner-fixture.mjs";
import { klineFixture } from "./ta-render-kline-fixture.mjs";
import { fixture as lightweightFixture } from "./ta-render-lightweight-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const core = load("model/technical-indicators/index.js");
const catalog = load("model/technical-indicators/catalog.js");
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const { assertReadableDrivePayload } = load("services/drive/reader-guard.js");

const ids = [
  ["STD;Price_Momentum_Oscillator", "pmo", ["value", "signal"]],
  ["STD;Price_Oscillator", "ppo", ["value", "signal", "histogram"]],
  ["STD;SMI", "smi", ["value", "signal"]],
  ["STD;SMI_Ergodic_Indicator_Oscillator", "smi-ergodic-indicator", ["value", "signal"]],
  ["STD;SMI_Ergodic_Oscillator", "smi-ergodic-oscillator", ["histogram"]],
  ["STD;Connors_RSI", "connors-rsi", ["value"]],
  ["STD;DPO", "dpo", ["value"]]
];

const bars = (prices) =>
  prices.map((close, index) => ({
    timestamp: (1 + index + index * index) * 1000,
    open: close,
    close,
    high: close + (index % 4) + 1,
    low: close - 1,
    volume: 10 + index
  }));

test("momentum studies resolve from the catalog and preserve their parameters and styles in Drive", () => {
  const entries = catalog.technicalCatalogEntries("ru");
  const data = bars(Array.from({ length: 130 }, (_, index) => 100 + ((index * index) % 71)));
  const instances = ids.map(([catalogId, id, outputIds], order) => {
    assert.equal(catalog.technicalDefinitionForCatalog(catalogId), id);
    assert.equal(entries.find((entry) => entry.id === catalogId)?.available, true);
    const instance = core.createTechnicalIndicatorInstance(id, id, {
      order,
      styles: { [outputIds[0]]: { color: "#b51965", width: 2, visible: true } }
    });
    assert.equal(instance.pane.kind, "pane");
    const result = core.calculateTechnicalIndicator(instance, data);
    assert.equal(result.definitionId, id);
    assert.deepEqual(Object.keys(result.series), outputIds);
    for (const values of Object.values(result.series)) {
      assert.equal(values.length, data.length);
      assert.ok(values.some(Number.isFinite), id);
    }
    return instance;
  });
  assert.deepEqual(
    assertReadableDrivePayload(backup(instances)).layout.technicalIndicators,
    instances
  );
});

test("PPO source and average settings reach the runtime and reject unknown choices", () => {
  const data = bars([10, 20, 30, 40, 50]);
  const params = {
    source: "close",
    fastLength: 1,
    slowLength: 2,
    signalLength: 2,
    oscillatorAverage: "SMA",
    signalAverage: "SMA"
  };
  const instance = core.createTechnicalIndicatorInstance("ppo", "ppo", { params });
  const result = core.calculateTechnicalIndicator(instance, data);
  closeSeries(result.series.value, [null, 100 / 3, 20, 100 / 7, 100 / 9]);
  closeSeries(result.series.histogram, [null, null, -20 / 3, -20 / 7, -100 / 63]);
  assert.deepEqual(result.historyRequirement, {
    kind: "finite",
    lookbackBars: 3,
    seedPolicy: "window",
    convergence: "exact-after-lookback"
  });
  const high = core.createTechnicalIndicatorInstance("ppo", "ppo-high", {
    params: { ...params, source: "high" }
  });
  closeSeries(core.calculateTechnicalIndicator(high, data).series.value.slice(0, 2), [
    null,
    100 / 3
  ]);
  assert.notDeepEqual(
    core.calculateTechnicalIndicator(high, data).series.value,
    result.series.value
  );
  assert.equal(
    core.isTechnicalIndicatorInstance({
      ...instance,
      params: { ...params, oscillatorAverage: "WMA" }
    }),
    false
  );
});

test("centered DPO reaches both adapters at the earlier candle with no second displacement", async (t) => {
  const data = bars([1, 2, 5, 10, 11, 13, 17, 22]);
  const centered = core.createTechnicalIndicatorInstance("dpo", "dpo", {
    params: { length: 3, centered: true }
  });
  const settings = {
    params: { length: 3, centered: false }
  };
  const uncentered = core.createTechnicalIndicatorInstance("dpo", "dpo", settings);
  const render = new TechnicalRenderData();
  render.setData(data);
  const graph = render.compile([centered]);
  const expected = [-5 / 3, -11 / 3, -11 / 3, -4 / 3, -8 / 3, -13 / 3, null, null];
  closeSeries(graph.outputs[0].values, expected);
  assert.deepEqual(
    graph.references.map(({ value }) => value),
    [0]
  );
  assert.deepEqual(
    graph.outputs[0].timestamps,
    data.map(({ timestamp }) => timestamp)
  );
  closeSeries(render.compile([uncentered]).outputs[0].values, [
    null,
    null,
    null,
    null,
    25 / 3,
    22 / 3,
    25 / 3,
    32 / 3
  ]);

  const lightweight = lightweightFixture(graph);
  t.after(() => lightweight.adapter.dispose());
  lightweight.render();
  const line = lightweight
    .series()
    .find((series) => series.kind === "Line" && series.data[0]?.value < 0);
  assert.ok(line);
  closeSeries(
    line.data.map((row) => row.value ?? null),
    expected
  );
  assert.deepEqual(line.data[7], { time: data[7].timestamp / 1000 });

  const kline = klineFixture();
  t.after(() => kline.dispose());
  kline.set(graph);
  await kline.ready();
  const native = kline
    .entries("technical:dpo")
    .find((item) => item.figures.some((figure) => figure.key === "value"));
  assert.ok(native);
  closeSeries(
    native.result.map((row) => row.value ?? null),
    expected
  );
});
