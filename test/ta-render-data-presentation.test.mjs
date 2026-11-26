import test from "node:test";
import assert from "node:assert/strict";
import { createSourceLoader, candle } from "./technical-volume-registration-fixture.mjs";

const baseLoad = createSourceLoader(),
  definitions = baseLoad("model/technical-indicators/definitions.js"),
  core = baseLoad("model/technical-indicators/index.js"),
  { TechnicalRenderData: LegacyData } = baseLoad("charts/technical-render-data.js");
const descriptor = {
  renderVersion: 2,
  plots: [
    {
      id: "value",
      seriesKey: "value",
      geometry: { kind: "line", gaps: "break" },
      color: { kind: "solid", color: "#4CAF50" },
      width: 2
    }
  ],
  fills: [
    {
      id: "body",
      fromSeries: "body",
      toSeries: "value",
      color: "#4CAF50",
      opacity: 0.1,
      gaps: "break"
    }
  ],
  hiddenSeries: ["body"]
};
const bars = [candle(10, 1, 10, 10, 0), candle(11, 1, 11, 11, 1), candle(12, 1, 12, 12, 2)];
function fixture(presentation = descriptor, extra = {}) {
  let calculations = 0;
  const load = createSourceLoader({
      "model/technical-indicators/definitions.js": {
        ...definitions,
        getTechnicalIndicatorDefinition(id) {
          const definition = definitions.getTechnicalIndicatorDefinition(id);
          return id === "rsi"
            ? { ...definition, presentation, ...(extra.outputs ? { outputs: extra.outputs } : {}) }
            : definition;
        }
      },
      "model/technical-indicators/runtime.js": {
        calculateTechnicalIndicator(instance, source) {
          calculations++;
          return {
            instanceId: instance.id,
            definitionId: instance.definitionId,
            status: "computed",
            timestamps: source.map((b) => b.timestamp),
            series: extra.series ?? { value: [null, 10, 11], body: [null, 12, 13] },
            warmupBars: 2,
            historyRequirement: { kind: "bars", bars: 2 }
          };
        }
      }
    }),
    { TechnicalRenderData } = load("charts/technical-render-data.js"),
    data = new TechnicalRenderData();
  data.setData(bars);
  return { data, calculations: () => calculations };
}

test("definitions without presentation retain their native render output shape and full numeric values", () => {
  const data = new LegacyData(),
    instance = core.createTechnicalIndicatorInstance("sma", "legacy", { params: { length: 1 } });
  data.setData(bars);
  const compiled = data.compile([instance]);
  assert.deepEqual(compiled.fills, []);
  assert.deepEqual(compiled.outputs, [
    {
      key: "legacy/value",
      instanceId: "legacy",
      paneKey: "price",
      outputId: "value",
      kind: "line",
      order: 0,
      levels: [],
      style: { color: "#2962ff", width: 1, opacity: 1, lineStyle: "solid", visible: true },
      timestamps: bars.map((b) => b.timestamp),
      values: [10, 11, 12]
    }
  ]);
});

test("presentation bridge owns indexed fill/plot keys without exposing hidden anchors as visible outputs", () => {
  const f = fixture(),
    instance = core.createTechnicalIndicatorInstance("rsi", "trend"),
    before = structuredClone(instance),
    compiled = f.data.compile([instance]);
  assert.equal(compiled.outputs.length, 1);
  const output = compiled.outputs[0],
    fill = compiled.fills[0];
  assert.equal(output.paneKey, "pane:trend");
  assert.deepEqual(output.values, [null, 10, 11]);
  assert.deepEqual(output.presentation.geometry, { kind: "line", gaps: "break" });
  assert.equal(output.style.color, "#4CAF50");
  assert.equal(output.style.width, 2);
  assert.equal(fill.key, "trend/fill/body");
  assert.equal(fill.scalePlotKey, output.key);
  assert.equal(fill.paneKey, output.paneKey);
  assert.equal(fill.scale, "none");
  assert.deepEqual(fill.from, [null, 12, 13]);
  assert.deepEqual(fill.to, [null, 10, 11]);
  assert.deepEqual(instance, before);
  assert.ok(!JSON.stringify(instance).includes("presentation"));
  assert.equal(core.isTechnicalIndicatorInstance({ ...instance, presentation: descriptor }), false);
});

test("pane collapse/manual output visibility/layout recompute presentation without recalculating formulas", () => {
  const f = fixture(),
    instance = core.createTechnicalIndicatorInstance("rsi", "trend");
  f.data.compile([instance]);
  const manual = {
      ...instance,
      styles: { value: { color: "#123456", width: 4, visible: false, opacity: 0.25 } }
    },
    styled = f.data.compile([manual]);
  assert.equal(f.calculations(), 1);
  assert.equal(styled.outputs[0].presentation.color.kind, "solid");
  assert.equal(styled.outputs[0].style.visible, false);
  // Fill has its own visibility; hiding one stroke does not rewrite the independent fill.
  assert.equal(styled.fills[0].visible, true);
  const collapsed = f.data.compile(
    [manual],
    [{ paneId: "trend", heightRatio: 0.2, collapsed: true }]
  );
  assert.equal(f.calculations(), 1);
  assert.ok(collapsed.outputs.every((o) => !o.style.visible && !o.presentation.visible));
  assert.ok(collapsed.fills.every((o) => !o.visible));
  assert.deepEqual(f.data.compile([]).fills, []);
});

test("inconsistent declaration/output geometry or missing hidden result fails before native resource creation", () => {
  for (const d of [
    { ...descriptor, plots: [{ ...descriptor.plots[0], id: "hidden-body" }] },
    { ...descriptor, plots: [{ ...descriptor.plots[0], geometry: { kind: "columns", base: 0 } }] },
    { ...descriptor, hiddenSeries: ["missing"] }
  ]) {
    const f = fixture(d),
      instance = core.createTechnicalIndicatorInstance("rsi", "invalid");
    assert.throws(() => f.data.compile([instance]), RangeError);
  }
});

test("down-only fill prefers its own finite direction plot rather than all-null first plot", () => {
  const d = {
      ...descriptor,
      precisionPolicy: "native-price",
      plots: [
        { ...descriptor.plots[0], id: "up", seriesKey: "up" },
        { ...descriptor.plots[0], id: "down", seriesKey: "down" }
      ],
      fills: [{ ...descriptor.fills[0], toSeries: "down" }]
    },
    f = fixture(d, {
      outputs: ["up", "down"].map((id) => ({ id, title: id, kind: "line", color: "#4CAF50" })),
      series: { up: [null, null, null], down: [null, 10, 11], body: [null, 12, 13] }
    }),
    instance = core.createTechnicalIndicatorInstance("rsi", "direction"),
    compiled = f.data.compile([instance]);
  assert.equal(compiled.fills[0].scalePlotKey, "direction/down");
  assert.equal(compiled.fills[0].precisionPolicy, "native-price");
  assert.deepEqual(compiled.outputs[0].values, [null, null, null]);
  assert.equal(compiled.outputs.length, 2);
  assert.ok(compiled.outputs.every((o) => o.presentation.precisionPolicy === "native-price"));
});
