import test from "node:test";
import assert from "node:assert/strict";
import { klineAsyncFixture, installedMethod } from "./kline-async-fixture.mjs";

const bars = Array.from({ length: 80 }, (_, i) => ({
  timestamp: Date.UTC(2025, 0, i + 1),
  open: 100 + i,
  high: 103 + i,
  low: 98 + i,
  close: 102 + i,
  volume: 1
}));
function create(f, id, paneId = id, order = 0) {
  return f
    .load("model/technical-indicators/instances.ts")
    .createTechnicalIndicatorInstance("rsi", id, { pane: { kind: "pane", id: paneId }, order });
}
function assertGeometry(f, keys) {
  const metrics = f.adapter.technicalPaneMetrics();
  assert.deepEqual(
    metrics.map((metric) => metric.key),
    ["price", ...keys.map((id) => `pane:${id}`)]
  );
  for (const metric of metrics) {
    const id = metric.key === "price" ? "candle_pane" : `technical:${metric.key.slice(5)}`,
      rendered = f.rendered(id);
    assert.ok(Math.abs(metric.top - rendered.top) < 0.001);
    assert.ok(Math.abs(metric.height - rendered.height) < 0.001);
  }
  assert.ok(
    Math.abs(f.paints.at(-1).height - metrics[0].height) < 0.001,
    "foreground canvas repaints at settled price height"
  );
  assert.equal(f.changes.length, 0, "native restore must not persist preferences");
  assert.ok(f.coherence.every(Boolean), "metrics must not mix new bounds and stale DOM paint");
}

test("fractional saved ratios produce whole pixel panes with a conserved total and no preference writes", async () => {
  const f = klineAsyncFixture();
  const geometry = f.load("charts/kline-pane-geometry.ts").klinePaneGeometry;
  for (const count of [1, 2, 12, 100]) {
    const groups = Array.from({ length: count }, (_, index) => ({
      key: `pane:${index}`,
      preference: { heightRatio: 0.180123, collapsed: index % 7 === 0 }
    }));
    const height = Math.max(821, 188 + 31 * (count + 1));
    const result = geometry(height, groups, { heightRatio: 0.0529 }, 28);
    assert.ok(result.every((pane) => Number.isInteger(pane.height)));
    assert.equal(result.reduce((total, pane) => total + pane.height, 0), height - 28 - count - 1);
    assert.ok(result[0].height >= 160);
    assert.ok(result.slice(1).every((pane) => pane.height >= 30));
  }
  f.adapter.setData(bars);
  await f.settle();
  const layout = [{ paneId: "saved", heightRatio: 0.180123, collapsed: false }];
  f.adapter.updateTechnicalIndicators([create(f, "saved")], layout);
  await f.settle();
  assert.ok(f.adapter.technicalPaneMetrics().every((pane) => Number.isInteger(pane.height)));
  assert.equal(layout[0].heightRatio, 0.180123);
  assert.equal(f.changes.length, 0);
  f.adapter.destroy();
});

test("installed async KLine createIndicator preserves height when a second RSI joins its pane", async () => {
  const f = klineAsyncFixture();
  f.setTimeHeight(23);
  f.adapter.setData(bars);
  await f.settle();
  const one = create(f, "one"),
    two = create(f, "two", "one", 1),
    layout = [{ paneId: "one", heightRatio: 0.4, collapsed: false }];
  f.adapter.updateTechnicalIndicators([one], layout);
  await f.settle();
  const height = f.adapter.technicalPaneMetrics()[1].height,
    camera = f.camera(),
    writes = f.primaryWrites();
  assert.ok(Math.abs(height - (f.container.clientHeight - 23 - 1) * 0.4) <= 1);
  assert.ok(f.adapter.technicalPaneMetrics().every((pane) => Number.isInteger(pane.height)));
  f.adapter.updateTechnicalIndicators([one, two], layout);
  await f.settle();
  assert.equal(f.adapter.technicalPaneMetrics()[1].height, height);
  const added = f.mutations.findLast((item) => item.kind === "create");
  assert.deepEqual(
    added.options,
    { id: "technical:one" },
    "stacked add must not replay an initial height after async calc"
  );
  assertGeometry(f, ["one"]);
  assert.deepEqual(f.camera(), camera);
  assert.equal(f.primaryWrites(), writes);
  assert.equal(f.creations(), 1);
  f.adapter.destroy();
});

test("obsolete pane completion cannot report removed geometry after a newer configuration", async () => {
  const f = klineAsyncFixture();
  f.adapter.setData(bars);
  await f.settle();
  f.adapter.updateTechnicalIndicators([create(f, "old")], []);
  f.adapter.updateTechnicalIndicators([create(f, "current")], []);
  const firstMetric = f.metricEvents.length;
  await f.settle();
  assertGeometry(f, ["current"]);
  assert.ok(
    f.metricEvents
      .slice(firstMetric)
      .every((metrics) => metrics.every((item) => item.key !== "pane:old"))
  );
  f.adapter.destroy();
});

test("async add/group/reorder/remove emits final geometry and repaints without data or camera reset", async () => {
  const f = klineAsyncFixture();
  f.adapter.setData(bars);
  await f.settle();
  f.adapter.setView({ camera: { barSpace: 8, rightOffsetBars: -12 } });
  f.ready();
  const one = create(f, "one"),
    two = create(f, "two", "two", 1),
    layout = [
      { paneId: "one", heightRatio: 0.25, collapsed: false },
      { paneId: "two", heightRatio: 0.2, collapsed: false }
    ];
  const camera = f.camera(),
    writes = f.primaryWrites();
  f.adapter.updateTechnicalIndicators([one, two], layout);
  await f.settle();
  assertGeometry(f, ["one", "two"]);
  f.adapter.updateTechnicalIndicators([one, { ...two, pane: { kind: "pane", id: "one" } }], layout);
  await f.settle();
  assertGeometry(f, ["one"]);
  f.adapter.updateTechnicalIndicators([one, two], [...layout].reverse());
  await f.settle();
  assertGeometry(f, ["two", "one"]);
  f.adapter.updateTechnicalIndicators([two], layout);
  await f.settle();
  assertGeometry(f, ["two"]);
  f.adapter.updateTechnicalIndicators([], layout);
  await f.settle();
  assertGeometry(f, []);
  assert.deepEqual(f.camera(), camera);
  assert.equal(f.primaryWrites(), writes);
  assert.equal(f.creations(), 1);
  f.adapter.destroy();
});

test("late native callbacks cannot repaint or publish geometry after owner disposal", async () => {
  const f = klineAsyncFixture();
  f.adapter.setData(bars);
  await f.settle();
  f.adapter.updateTechnicalIndicators([create(f, "old")], []);
  assert.ok(f.pending.length > 0);
  f.adapter.destroy();
  const metrics = f.metricEvents.length,
    paints = f.paints.length,
    writes = f.primaryWrites();
  await f.settle();
  assert.equal(f.metricEvents.length, metrics);
  assert.equal(f.paints.length, paints);
  assert.equal(f.primaryWrites(), writes);
  assert.equal(f.changes.length, 0);
});

test("installed override recalculates a new extendData wrapper even when context and calcParams are unchanged", () => {
  const globals = {
    isString: (value) => typeof value === "string",
    isNumber: (value) => typeof value === "number",
    isBoolean: (value) => typeof value === "boolean",
    isArray: Array.isArray,
    isFunction: (value) => typeof value === "function",
    isValid: (value) => value != null
  };
  const context = { rows: [] },
    wrapper = { context };
  const instance = {
    extendData: wrapper,
    setExtendData: installedMethod("IndicatorImp", "setExtendData", globals)
  };
  const override = installedMethod("IndicatorStore", "_overrideInstance", globals);
  assert.deepEqual([...override(instance, { extendData: wrapper })], [false, false, false]);
  context.rows = [{ value: 45 }];
  assert.deepEqual([...override(instance, { extendData: { context } })], [true, true, false]);
  assert.equal(instance.extendData.context, context);
});

test("adapter prepares full TA rows before native applyNewData and replaces its extendData wrapper", async () => {
  const f = klineAsyncFixture();
  f.adapter.updateTechnicalIndicators([create(f, "one")], []);
  await f.settle();
  const indicator = () => f.activeIndicators().find((item) => item.name.startsWith("PERSONAL_TA_"));
  const before = indicator().extendData,
    apply = f.native.applyNewData;
  f.native.applyNewData = (data) => {
    assert.equal(indicator().extendData.context.rows.length, data.length);
    apply(data);
  };
  f.adapter.setData(bars);
  await f.settle();
  assert.notEqual(indicator().extendData, before);
  assert.equal(indicator().extendData.context, before.context);
  assert.ok(indicator().result.some((row) => row.value !== undefined));
  f.adapter.destroy();
});
