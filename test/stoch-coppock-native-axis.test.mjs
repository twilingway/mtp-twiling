import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
const installed = readFileSync(
  new URL(
    "../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",
    import.meta.url
  ),
  "utf8"
);
assert.equal(
  createHash("sha256").update(installed).digest("hex"),
  "dec157fcccf103e2d152cce52b29204a66ab3a7df713af4132e6bb70e22233b9"
);
const context = vm.createContext({ console, performance, setTimeout, clearTimeout });
vm.runInContext(
  installed.replace(/^import .*;$/gm, "").replace(/^export \{[^\n]+\};$/gm, "") +
    "\nglobalThis.sdk={PriceScale,PriceRangeImpl,AutoscaleInfoImpl};",
  context
);
const { PriceScale, PriceRangeImpl, AutoscaleInfoImpl } = context.sdk;
const { lightweightReferenceContext } = createSourceLoader()(
  "charts/lightweight-reference-context.js"
);
function axis(mode, sources) {
  let range;
  PriceScale.prototype._private__recalculatePriceRangeImpl.call({
    _internal_isCustomPriceRange: () => false,
    _internal_isAutoScale: () => true,
    _private__invalidatedForRange: {
      _internal_visibleBars: { _internal_left: () => 0, _internal_right: () => 20 }
    },
    _private__options: { mode },
    _internal_sourcesForAutoScale: () => sources,
    _internal_hasVisibleEdgeMarks: () => false,
    _private__marginAbove: 0,
    _private__marginBelow: 0,
    _internal_isLog: () => false,
    _internal_setPriceRange: (value) => {
      range = value;
    }
  });
  return [range._internal_minValue(), range._internal_maxValue()];
}
test("actual installed LW axis unions converted legitimate ranges under shared percentage/indexed context", () => {
  for (const mode of [0, 2, 3]) {
    const k = {
      priceToCoordinate: (value) => value,
      priceScale: () => ({ options: () => ({ mode }) })
    };
    const context = lightweightReferenceContext(
      { timeScale: () => ({ getVisibleRange: () => ({ from: 1, to: 2 }) }) },
      () => undefined
    );
    context.update(
      [
        {
          instanceId: "s",
          paneKey: "pane:s",
          key: "s/k",
          style: { visible: true },
          timestamps: [1000, 2000],
          values: [40, 60]
        }
      ],
      new Map([["s/k", k]])
    );
    const sources = [
      [40, 40, 60],
      [50, 50, 61],
      [80, 80, 80],
      [50, 50, 50],
      [20, 20, 20]
    ].map(([base, min, max]) => {
      const provider = context.autoscale(
        "s",
        "pane:s",
        () => base,
        80,
        (original) => original(),
        () => mode
      );
      return {
        _internal_visible: () => true,
        _internal_firstValue: () => ({ _internal_value: base }),
        _internal_autoscaleInfo: () => {
          const value = provider(() => ({ priceRange: { minValue: min, maxValue: max } }));
          return new AutoscaleInfoImpl(
            new PriceRangeImpl(value.priceRange.minValue, value.priceRange.maxValue),
            null
          );
        }
      };
    });
    const expected = mode === 0 ? [20, 80] : mode === 2 ? [-50, 100] : [50, 200];
    assert.deepEqual(axis(mode, sources), expected);
    // Native coordinate transform uses the same chosen common base as the corrected axis union.
    const coordinate = PriceScale.prototype._internal_priceToCoordinate.call(
      {
        _internal_isPercentage: () => mode === 2,
        _internal_isIndexedTo100: () => mode === 3,
        _private__logicalToCoordinate: (value) => value
      },
      80,
      40
    );
    assert.equal(coordinate, expected[1]);
  }
});
