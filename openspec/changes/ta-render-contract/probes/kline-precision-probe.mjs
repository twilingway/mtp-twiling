import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const source = fs.readFileSync(
  new URL("../../../../node_modules/klinecharts/dist/index.esm.js", import.meta.url),
  "utf8"
);
const hash = crypto.createHash("sha256").update(source).digest("hex");
assert.equal(hash, "313a26786af901e2b5b93c16ac002c6ceeebb54ecc9b6a55e386f1b31805ca5d");
const scope = {
  IndicatorImp: { prototype: {} },
  IndicatorStore: { prototype: {} },
  YAxisImp: { prototype: {} },
  IndicatorSeries: { Price: "price", Volume: "volume" },
  isNumber: (value) => typeof value === "number" && Number.isFinite(value),
  isValid: (value) => value !== null && value !== undefined,
  CandleType: { Area: "area" },
  YAxisType: { Percentage: "percentage", Log: "log" },
  index10: (value) => 10 ** value,
  log10: Math.log10
};
for (const method of [
  "IndicatorImp.prototype.setPrecision",
  "IndicatorStore.prototype.synchronizeSeriesPrecision",
  "YAxisImp.prototype.calcRange"
]) {
  const start = source.indexOf(`${method} = function`);
  const end = source.indexOf("\n    };", start) + 7;
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(source.slice(start, end), scope);
}
assert.match(
  source,
  /instance = new IndicatorClazz\(\);\s*this\.synchronizeSeriesPrecision\(instance\);\s*this\._overrideInstance\(instance, indicator\)/
);
assert.match(source, /isNumber\(precision\) && instance\.setPrecision\(precision\)/);

function range(indicators, nativePrecision) {
  const chartStore = {
    getIndicatorStore: () => ({ getInstances: () => indicators }),
    getPrecision: () => ({ price: nativePrecision }),
    getVisibleDataList: () => [{ dataIndex: 0, data: { low: 1, high: 1, close: 1 } }]
  };
  const chart = {
    getChartStore: () => chartStore,
    getStyles: () => ({ candle: { type: "candle", area: { value: "close" } } })
  };
  const parent = {
    getChart: () => chart,
    getId: () => "candle_pane",
    getOptions: () => ({ gap: { top: 0, bottom: 0 } }),
    getYAxisWidget: () => ({ getBounding: () => ({ height: 300 }) })
  };
  return scope.YAxisImp.prototype.calcRange.call({
    getParent: () => parent,
    isInCandle: () => true,
    getType: () => "normal"
  });
}
let nativePrecision = 6;
const store = { _chartStore: { getPrecision: () => ({ price: nativePrecision, volume: 0 }) } };
const sync = (instance) =>
  scope.IndicatorStore.prototype.synchronizeSeriesPrecision.call(store, instance);
function sequence(initialSeries, explicitPrecision) {
  const instance = {
    series: initialSeries,
    precision: 4,
    _precisionFlag: false,
    setPrecision: scope.IndicatorImp.prototype.setPrecision
  };
  sync(instance);
  instance.series = "price";
  if (explicitPrecision !== undefined) instance.setPrecision(explicitPrecision);
  return instance;
}
const nativePrice = sequence("price");
const latePrice = sequence("normal");
const legacyPinned = sequence("normal", 6);
const equalExplicit = sequence("price", 6);
assert.equal(nativePrice.precision, 6);
assert.equal(latePrice.precision, 4);
assert.equal(legacyPinned._precisionFlag, true);
assert.equal(equalExplicit._precisionFlag, false);
nativePrecision = 8;
for (const instance of [nativePrice, latePrice, legacyPinned, equalExplicit]) sync(instance);
assert.equal(nativePrice.precision, 8);
assert.equal(legacyPinned.precision, 6);
assert.equal(equalExplicit.precision, 8);
const changedExplicit = sequence("price", 6);
assert.equal(changedExplicit._precisionFlag, true);

const cases = [];
for (const precision of [6, 8]) {
  for (const hidden of [false, true]) {
    const owner = {
      precision,
      figures: hidden ? [] : [{ key: "upTrend" }],
      result: [{ upTrend: 1 }],
      visible: !hidden
    };
    const companion = { precision, figures: [], result: [], visible: !hidden };
    const baseline = range([owner], precision);
    const matched = range([owner, companion], precision);
    const wrong = range([owner, { ...companion, precision: 4 }], precision);
    assert.deepEqual(matched, baseline);
    assert.ok(wrong.range > baseline.range * 99);
    cases.push({
      precision,
      hidden,
      baseline: baseline.range,
      matched: matched.range,
      wrong: wrong.range
    });
  }
}
console.log(
  JSON.stringify(
    {
      assertions: "PASS",
      kind: "extracted-native-methods-and-sequence-model",
      actualCreate: false,
      actualCanvas: false,
      sdkHash: hash,
      cases,
      syncAt8: {
        nativePrice: nativePrice.precision,
        legacyPinned: legacyPinned.precision,
        equalExplicit: equalExplicit.precision,
        changedExplicitFlag: changedExplicit._precisionFlag
      }
    },
    null,
    2
  )
);
