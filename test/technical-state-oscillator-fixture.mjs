import { createHash } from "node:crypto";
import { createSourceLoader, candle, candles } from "./technical-volume-registration-fixture.mjs";
export { createSourceLoader, candle, candles };
export const load = createSourceLoader();
export const core = load("model/technical-indicators/index.js");
export const ids = ["tsi", "kst", "fisher-transform"];
export const defaults = {
  tsi: { longLength: 25, shortLength: 13, signalLength: 13 },
  kst: {
    roc1Length: 10,
    roc2Length: 15,
    roc3Length: 20,
    roc4Length: 30,
    sma1Length: 10,
    sma2Length: 10,
    sma3Length: 10,
    sma4Length: 15,
    signalLength: 9
  },
  "fisher-transform": { length: 9 }
};
export const custom = {
  tsi: { longLength: 3, shortLength: 2, signalLength: 4 },
  kst: {
    roc1Length: 1,
    roc2Length: 2,
    roc3Length: 3,
    roc4Length: 4,
    sma1Length: 2,
    sma2Length: 3,
    sma3Length: 4,
    sma4Length: 5,
    signalLength: 2
  },
  "fisher-transform": { length: 3 }
};
export const make = core.createTechnicalIndicatorInstance;
export const calculate = (id, bars, params = {}) =>
  core.calculateTechnicalIndicator(make(id, id, { params }), bars);
export const backup = (instances) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  layout: { technicalIndicators: instances },
  drawings: [],
  images: []
});
export const customInstance = (id, order) =>
  make(id, `custom-${id}`, {
    params: custom[id],
    order,
    visible: false,
    pane: { kind: "pane", id: "shared-state" },
    styles: Object.fromEntries(
      core
        .getTechnicalIndicatorDefinition(id)
        .outputs.map((output, i) => [
          output.id,
          { color: "#123456", width: i + 1, visible: i === 0, opacity: 0.35, lineStyle: "dotted" }
        ])
    )
  });
// Independently recorded through read-only `git show 5d569c3:src/...` before registry edits.
export const FROZEN42_SHA256 = "610fd4c860f6ccc49bc80c7f1f29651a5983d75ce2630ff565f5ed81823afc0a";
export function frozen42Contract(model) {
  const definitions = model.technicalIndicatorDefinitions.slice(0, 42);
  const instances = definitions.map((d, order) =>
    model.createTechnicalIndicatorInstance(d.id, `frozen-${d.id}`, { order })
  );
  const ordinary = Array.from({ length: 64 }, (_, i) =>
    candle(10 + (i % 7), i % 6, 12 + (i % 7), 8 + (i % 7), i)
  );
  const cases = [
    [],
    ordinary,
    ordinary.map((b) => ({ ...b, volume: null })),
    ordinary.map((b, i) =>
      i % 5 === 2 ? { ...b, open: null, high: null, low: null, close: null, volume: null } : b
    )
  ];
  return {
    definitions,
    instances,
    history: instances.map((i) => model.technicalIndicatorHistoryRequirement(i)),
    results: cases.map((bars) =>
      instances.map((i) =>
        model.calculateTechnicalIndicator(i, bars, { historicalVolatilityPeriodsPerYear: 365 })
      )
    )
  };
}
export const contractHash = (model) =>
  createHash("sha256")
    .update(JSON.stringify(frozen42Contract(model)))
    .digest("hex");
export function series(actual, expected) {
  if (actual.length !== expected.length) throw new Error("Series length differs");
  expected.forEach((v, i) => {
    if (
      v === null
        ? actual[i] !== null
        : typeof actual[i] !== "number" ||
          !Number.isFinite(actual[i]) ||
          Math.abs(actual[i] - v) > 3e-12 * Math.max(1, Math.abs(v))
    )
      throw new Error(`index${i}: ${actual[i]} != ${v}`);
  });
}
