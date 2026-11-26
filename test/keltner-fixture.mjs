import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
export { createSourceLoader };
export const BASE = "0d17cf10a1a7f199d34d66235bd17352ca3f2627";
export const MATH = "780e9c5287153021b516b472fb1282b22f3b59a4";
export const BASE_DRIVE_KEYS =
  "length source fastLength slowLength signalLength multiplier smoothK smoothD expansionLength contractionLength middleLength diLength adxSmoothing divisor emaLength oscillatorAverage signalAverage longLength shortLength roc1Length roc2Length roc3Length roc4Length sma1Length sma2Length sma3Length sma4Length atrLength factor start increment maximum offset sigma".split(
    " "
  );
export const gitSource = (sha, relative) =>
  execFileSync("git", ["show", `${sha}:src/${relative}`], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
export const load = createSourceLoader(),
  core = load("model/technical-indicators/index.js");
export const defaults = {
  length: 20,
  multiplier: 2,
  source: "close",
  useExponentialMa: true,
  bandsStyle: "Average True Range",
  atrLength: 10
};
export const make = (params = {}, options = {}) =>
  core.createTechnicalIndicatorInstance("keltner-channels", "kc", { params, ...options });
export const bars = (n = 30) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: 1700000000000 + i * 60000,
    open: 100 + (i % 7),
    high: 102 + (i % 7),
    low: 98 + (i % 7),
    close: 100 + (i % 7),
    volume: i % 5
  }));
export const ledger = () =>
  [
    [10, 8, 9],
    [15, 11, 14],
    [14, 10, 11],
    [20, 16, 18],
    [12, 8, 10],
    [13, 9, 12],
    [8, 4, 5]
  ].map(([high, low, close], i) => ({
    timestamp: i + 1,
    open: close,
    high,
    low,
    close,
    volume: null
  }));
export const calculate = (input, params = {}) =>
  core.calculateTechnicalIndicator(make(params), input);
export const backup = (instances) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  layout: { technicalIndicators: instances },
  drawings: [],
  images: []
});
export function closeSeries(actual, expected) {
  if (actual.length !== expected.length) throw Error("series length");
  for (const [i, value] of expected.entries()) {
    if (
      value === null
        ? actual[i] !== null
        : !Number.isFinite(actual[i]) ||
          Math.abs(actual[i] - value) > 3e-12 * Math.max(1, Math.abs(value))
    )
      throw Error(`index${i}: ${actual[i]} != ${value}`);
  }
}
export function invalidInstances() {
  const instance = make(),
    invalid = [
      { ...instance, params: null },
      { ...instance, params: [] },
      { ...instance, params: { ...instance.params, unknown: 1 } },
      { ...instance, params: { ...instance.params, bandStyle: "Range" } },
      { ...instance, styles: null },
      { ...instance, styles: { background: { color: "#123456", width: 1, visible: true } } },
      ...[
        "historyRequirement",
        "firstReadyBars",
        "series",
        "timestamps",
        "unavailableReason",
        "presentation",
        "fills"
      ].map((key) => ({ ...instance, [key]: {} }))
    ];
  for (const p of core.getTechnicalIndicatorDefinition("keltner-channels").parameters) {
    const missing = { ...instance.params };
    delete missing[p.key];
    invalid.push({ ...instance, params: missing });
    const values =
      p.type === "boolean"
        ? [0, 1, "true", "false"]
        : p.type === "choice"
          ? [true, 0, "range", "Range ", "Average  True Range", "EMA"]
          : p.type === "source"
            ? ["unknown", true, 0]
            : [
                "2",
                true,
                NaN,
                Infinity,
                p.min - 1,
                p.max + 1,
                ...(p.type === "integer" ? [1.5] : [])
              ];
    for (const value of [undefined, null, [], {}, ...values])
      invalid.push({ ...instance, params: { ...instance.params, [p.key]: value } });
  }
  return invalid;
}
