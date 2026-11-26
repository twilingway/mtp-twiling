import test from "node:test";
import assert from "node:assert/strict";
import {
  core,
  load,
  ids,
  defaults,
  custom,
  make,
  calculate,
  ledger,
  candles,
  candle,
  invalidInstances
} from "./technical-trend-price-fixture.mjs";
const catalog = load("model/technical-indicators/catalog.js"),
  math = load("model/technical-indicators/trend-state/index.js"),
  { compilePresentation } = load("model/technical-indicators/presentation.js"),
  { TechnicalRenderData } = load("charts/technical-render-data.js");

test("append2 declares47 computed definitions and48 local catalog entries including Volume", () => {
  assert.equal(core.technicalIndicatorDefinitions.length, 47);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(45).map((d) => d.id),
    ids
  );
  for (const [i, id] of ids.entries()) {
    const definition = core.getTechnicalIndicatorDefinition(id),
      instance = make(id, id);
    assert.deepEqual(instance.params, defaults[id]);
    assert.deepEqual(instance.pane, { kind: "overlay" });
    assert.equal(instance.schemaVersion, 1);
    assert.equal(definition.defaultPane, "overlay");
    assert.equal(definition.presentation.precisionPolicy, "native-price");
    assert.deepEqual(
      definition.outputs.map((o) => o.id),
      i === 0 ? ["value"] : ["upTrend", "downTrend"]
    );
    assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.presentation.plots));
    assert.equal(
      catalog.technicalDefinitionForCatalog(i === 0 ? "STD;PSAR" : "STD;Supertrend"),
      id
    );
  }
  for (const locale of ["ru", "en"]) {
    const entries = catalog.technicalCatalogEntries(locale);
    assert.equal(entries.length, 127);
    assert.equal(entries.filter((e) => e.available).length, 48);
    assert.equal(
      catalog.technicalCatalogEntries(locale, "blocked").filter((e) => e.available).length,
      0
    );
    for (const key of ["STD;DPO", "STD;Trend%1Strength%1Index"])
      assert.equal(entries.find((e) => e.id === key).available, false);
  }
});

test("SAR actual runtime matches independent hand projection/reversal ledger and exact history", () => {
  const result = calculate("parabolic-sar", ledger(), custom["parabolic-sar"]);
  assert.deepEqual(result.series, { value: [null, 8, 8, 10, 15, 15, 9] });
  assert.equal(result.warmupBars, 2);
  assert.deepEqual(result.historyRequirement, {
    kind: "recursive",
    lookbackBars: null,
    seedBars: 2,
    seedPolicy: "two-adjacent-bars-close-direction",
    convergence: "full-input-dependent"
  });
  assert.deepEqual(
    calculate("parabolic-sar", ledger().slice(0, 4), { start: 0, increment: 0, maximum: 0 }).series
      .value,
    [null, 8, 8, 8]
  );
  assert.ok(
    core.isTechnicalIndicatorInstance(
      make("parabolic-sar", "start-above-max", { params: { start: 0.8, maximum: 0.2 } })
    )
  );
});

test("Supertrend actual runtime retains all five raw rows and independent hand ATR/band ledger", () => {
  const result = calculate("supertrend", ledger(), custom.supertrend);
  assert.deepEqual(result.series, {
    value: [null, 13.5, 13.5, 11.625, 11.625, 13.34375, 13.34375],
    direction: [1, 1, 1, -1, -1, 1, 1],
    upTrend: [null, null, null, 11.625, 11.625, null, null],
    downTrend: [null, 13.5, 13.5, null, null, 13.34375, 13.34375],
    bodyMiddle: [null, 11, 13, 14, 12, 10, 12]
  });
  assert.deepEqual(result.historyRequirement, {
    kind: "recursive",
    lookbackBars: null,
    seedBars: 2,
    seedPolicy: "contiguous-true-range-wilder-and-trailing-bands",
    convergence: "full-input-dependent"
  });
  assert.equal(
    core.technicalIndicatorHistoryRequirement(make("supertrend", "default")).seedBars,
    10
  );
  const one = calculate("supertrend", ledger(), { atrLength: 1, factor: 1 });
  assert.equal(one.series.value[0], null);
  assert.equal(one.series.direction[0], 1);
  assert.equal(one.series.bodyMiddle[0], null);
  assert.equal(one.warmupBars, 2);
  assert.equal(
    calculate("supertrend", candles([0, 0, 0]), { atrLength: 1 }).series.value[1],
    0,
    "a real computed zero remains valid; unknown seed must not be replaced by zero"
  );
});

test("runtime preserves reviewed defaults/custom/gaps/noVolume/causality and no fake price zeros", () => {
  const bars = Object.freeze(
    [
      ...ledger().slice(0, 3),
      candle(null, null, null, null, 3),
      ...ledger()
        .slice(0, 3)
        .map((b, i) => ({ ...b, timestamp: 1710000000123 + (i + 4) * 71999 }))
    ].map(Object.freeze)
  );
  const before = JSON.stringify(bars);
  for (const id of ids) {
    for (const params of [defaults[id], custom[id]]) {
      const result = calculate(id, bars, params),
        expected =
          id === "parabolic-sar"
            ? { value: math.parabolicSar(bars, params.start, params.increment, params.maximum) }
            : math.supertrend(bars, params.atrLength, params.factor);
      assert.deepEqual(result.series, expected);
      assert.deepEqual(
        result.timestamps,
        bars.map((b) => b.timestamp)
      );
      assert.equal(result.series.value[3], null);
      assert.equal(result.series.value[4], null);
      assert.equal(Object.hasOwn(result, "unavailableReason"), false);
      for (let n = 0; n <= bars.length; n++) {
        const prefix = calculate(id, bars.slice(0, n), params);
        for (const [key, values] of Object.entries(result.series))
          assert.deepEqual(prefix.series[key], values.slice(0, n));
      }
      for (const values of Object.values(result.series))
        assert.ok(values.every((v) => v === null || Number.isFinite(v)));
    }
  }
  assert.equal(JSON.stringify(bars), before);
  const noOpen = ledger().map((b) => ({ ...b, open: null }));
  assert.deepEqual(
    calculate("supertrend", noOpen, custom.supertrend).series.value,
    calculate("supertrend", ledger(), custom.supertrend).series.value
  );
  assert.ok(calculate("supertrend", noOpen).series.bodyMiddle.every((v) => v === null));
  for (const id of ids) {
    assert.deepEqual(calculate(id, []).series.value, []);
    assert.deepEqual(
      calculate(id, candles([12, 12, 12])).series.value,
      id === "supertrend" ? [null, null, null] : [null, 12, 12]
    );
    assert.ok(calculate(id, candles([12, 12, 12])).series.value.every((v) => v !== 0));
    for (const values of Object.values(calculate(id, candles([1e308, -1e308, 1, 2])).series))
      assert.ok(values.every((v) => v === null || Number.isFinite(v)));
  }
});

test("root validator rejects malformed exact params/styles before dispatch; bounds match reviewed metadata", () => {
  for (const id of ids) {
    const instance = make(id, id),
      definition = core.getTechnicalIndicatorDefinition(id),
      preset = math.trendStatePresets.find((p) => p.id === id);
    for (const parameter of definition.parameters) {
      assert.deepEqual(
        { min: parameter.min, max: parameter.max },
        preset.localLimits[parameter.key]
      );
      for (const value of [parameter.min, parameter.max])
        assert.equal(
          core.isTechnicalIndicatorInstance({
            ...instance,
            params: { ...instance.params, [parameter.key]: value }
          }),
          true
        );
    }
    for (const invalid of invalidInstances(id)) {
      assert.equal(core.isTechnicalIndicatorInstance(invalid), false);
      assert.throws(() => core.calculateTechnicalIndicator(invalid, []), RangeError);
    }
    for (const bars of [
      [{ ...ledger()[0], close: 100 }],
      [{ ...ledger()[0], volume: -1 }],
      [{ ...ledger()[0], high: NaN }],
      [ledger()[1], ledger()[0]]
    ])
      assert.throws(() => core.calculateTechnicalIndicator(instance, bars), RangeError);
  }
});

test("production descriptors compile cross/linebr/hidden anchors/fills through real bridge in both panes", () => {
  for (const pane of [{ kind: "overlay" }, { kind: "pane", id: "own" }]) {
    const sar = make("parabolic-sar", "sar", { pane }),
      st = make("supertrend", "st", { pane, params: custom.supertrend }),
      data = new TechnicalRenderData();
    data.setData(ledger());
    const result = data.compile([sar, st]);
    assert.equal(result.outputs.length, 3);
    assert.equal(result.fills.length, 2);
    assert.deepEqual(
      result.outputs.map((o) => o.outputId),
      ["value", "upTrend", "downTrend"]
    );
    assert.ok(result.outputs.every((o) => o.presentation.precisionPolicy === "native-price"));
    assert.ok(
      result.fills.every(
        (f) =>
          f.precisionPolicy === "native-price" &&
          f.scale === "none" &&
          f.opacity === 0.1 &&
          f.gaps === "break"
      )
    );
    assert.equal(result.outputs[0].presentation.geometry.kind, "cross");
    assert.deepEqual(result.outputs[0].presentation.geometry.size, {
      unit: "pine-relative",
      value: 1
    });
    assert.equal(result.outputs[0].style.color, "#2962FF");
    assert.deepEqual(
      result.outputs.slice(1).map((o) => o.style.color),
      ["#4CAF50", "#F23645"]
    );
    assert.ok(result.outputs.slice(1).every((o) => o.presentation.geometry.gaps === "break"));
    assert.equal(result.fills[0].from[0], null);
    assert.equal(result.fills[1].from[0], null);
    assert.ok(result.fills[0].to.every((v, i) => v === null || result.fills[1].to[i] === null));
    assert.equal(result.fills[0].scalePlotKey, "st/upTrend");
    assert.equal(result.fills[1].scalePlotKey, "st/downTrend");
    st.styles = {
      upTrend: { color: "#123456", width: 4, visible: false, opacity: 0.5, lineStyle: "dashed" }
    };
    const customResult = data.compile([st]);
    assert.equal(customResult.outputs[0].style.visible, false);
    assert.equal(customResult.outputs[1].style.visible, true);
    assert.ok(customResult.fills.every((f) => f.visible));
    if (pane.kind === "pane")
      assert.ok(
        data
          .compile([sar, st], [{ paneId: "own", heightRatio: 0.2, collapsed: true }])
          .fills.every((f) => !f.visible)
      );
    st.visible = false;
    assert.ok(data.compile([st]).fills.every((f) => !f.visible));
    data.dispose();
  }
  const definition = core.getTechnicalIndicatorDefinition("supertrend").presentation,
    result = calculate("supertrend", ledger(), custom.supertrend),
    input = {
      timestamps: result.timestamps,
      series: result.series,
      visible: true,
      collapsed: false
    };
  for (const mutate of [
    (d) => ({ ...d, hiddenSeries: [...d.hiddenSeries, "missing"] }),
    (d) => ({ ...d, fills: [{ ...d.fills[0], toSeries: "undeclared" }] }),
    (d) => ({ ...d, plots: [{ ...d.plots[0], seriesKey: "bodyMiddle" }] })
  ])
    assert.throws(() => compilePresentation(mutate(definition), input), RangeError);
  assert.throws(
    () =>
      compilePresentation(definition, { ...input, series: { ...input.series, direction: [1] } }),
    RangeError
  );
});
