import assert from "node:assert/strict";
import test from "node:test";
import { core, load } from "./technical-volume-registration-fixture.mjs";

const { technicalDefinitionForCatalog } = load("model/technical-indicators/catalog.js");
const { compilePresentation } = load("model/technical-indicators/presentation.js");

function candles(closes, opens = closes, volumes = closes.map(() => 1)) {
  return closes.map((close, index) => ({
    timestamp: index + 1,
    open: opens[index],
    high: Math.max(close ?? 0, opens[index] ?? 0),
    low: Math.min(close ?? 0, opens[index] ?? 0),
    close,
    volume: volumes[index]
  }));
}

function calculate(id, bars, params = {}) {
  const instance = core.createTechnicalIndicatorInstance(id, id, { params });
  return core.calculateTechnicalIndicator(instance, bars);
}

test("average catalog IDs resolve to price overlays with portable defaults", () => {
  const expected = [
    [
      "STD;Kaufmans_Adaptive_Moving_Average",
      "kama",
      { source: "close", erLength: 10, fastLength: 2, slowLength: 30 }
    ],
    ["STD;McGinley%1Dynamic", "mcginley-dynamic", { length: 14 }],
    ["STD;MA%1Cross", "moving-average-cross", { shortLength: 9, longLength: 21 }],
    [
      "STD;MA%Ribbon",
      "moving-average-ribbon",
      {
        ma1Average: "sma",
        ma1Source: "close",
        ma1Length: 20,
        ma2Average: "sma",
        ma2Source: "close",
        ma2Length: 50,
        ma3Average: "sma",
        ma3Source: "close",
        ma3Length: 100,
        ma4Average: "sma",
        ma4Source: "close",
        ma4Length: 200
      }
    ]
  ];
  for (const [catalogId, definitionId, params] of expected) {
    assert.equal(technicalDefinitionForCatalog(catalogId), definitionId);
    const instance = core.createTechnicalIndicatorInstance(definitionId, definitionId);
    assert.deepEqual(instance.pane, { kind: "overlay" });
    assert.deepEqual(instance.params, params);
    assert.ok(core.isTechnicalIndicatorInstance(JSON.parse(JSON.stringify(instance))));
  }
});

test("registered KAMA observes the selected source and rejects reversed fast/slow lengths", () => {
  const result = calculate("kama", candles([50, 50, 50, 50], [10, 11, 12, null]), {
    source: "open",
    erLength: 2,
    fastLength: 2,
    slowLength: 3
  });
  assert.equal(result.warmupBars, 3);
  assert.equal(result.historyRequirement.seedPolicy, "prior-price-after-efficiency-window");
  assert.deepEqual(result.series.value.slice(0, 2), [null, null]);
  assert.ok(Math.abs(result.series.value[2] - 103 / 9) < 1e-12);
  assert.equal(result.series.value[3], null);
  assert.throws(
    () =>
      core.createTechnicalIndicatorInstance("kama", "reversed", {
        params: { fastLength: 5, slowLength: 3 }
      }),
    RangeError
  );
});

test("registered McGinley preserves a missing observation and reseeds after zero", () => {
  const result = calculate("mcginley-dynamic", candles([10, 20, null, 0, 7]), { length: 2 });
  assert.equal(result.historyRequirement.seedPolicy, "first-nonzero");
  assert.deepEqual(result.series.value, [10, 165 / 16, null, null, 7]);
});

test("registered MA Cross compiles only discrete events with adjustable cross style", () => {
  const bars = candles([1, 1, 3, 2, 2]);
  const id = "moving-average-cross";
  const result = calculate(id, bars, { shortLength: 1, longLength: 2 });
  assert.equal(result.warmupBars, 1);
  assert.equal(result.historyRequirement.lookbackBars, 3);
  const presentation = compilePresentation(core.getTechnicalIndicatorDefinition(id).presentation, {
    ...result,
    styles: { cross: { color: "#bb4433", width: 2, visible: false } },
    visible: true,
    collapsed: false
  });
  const crosses = presentation.plots.find((plot) => plot.id === "cross");
  assert.equal(crosses.geometry.kind, "cross");
  assert.deepEqual(crosses.color, { kind: "solid", color: "#bb4433" });
  assert.equal(crosses.visible, false);
  assert.deepEqual(crosses.values, [null, null, 3, 2, null]);
});

test("registered ribbon computes four independently configured lines with missing volume", () => {
  const result = calculate(
    "moving-average-ribbon",
    candles([10, 20, 40, 80], [8, 16, 32, 64], [1, 3, null, null]),
    {
      ma1Average: "sma",
      ma1Source: "open",
      ma1Length: 2,
      ma2Average: "ema",
      ma2Length: 3,
      ma3Average: "wma",
      ma3Source: "hl2",
      ma3Length: 2,
      ma4Average: "vwma",
      ma4Length: 2
    }
  );
  assert.equal(result.warmupBars, 1);
  assert.equal(result.historyRequirement.kind, "recursive");
  assert.deepEqual(result.series.ma1, [null, 12, 24, 48]);
  assert.deepEqual(result.series.ma2, [10, 15, 27.5, 53.75]);
  assert.deepEqual(result.series.ma3, [null, 15, 30, 60]);
  const [first, weighted, ...missing] = result.series.ma4;
  assert.equal(first, null);
  assert.ok(Math.abs(weighted - 17.5) < 1e-12);
  assert.deepEqual(missing, [null, null]);
});
