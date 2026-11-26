import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSourceLoader, candle, candles } from "./technical-volume-registration-fixture.mjs";
export { createSourceLoader, candle, candles };
export const BASE = "f74c33d968d7ca258def096bfc2d731bbdf74b5f";
export const REVIEWED_MATH = "49bfcf77c9a5200f8bcaf6d70735bd167c500b5f";
const cwd = fileURLToPath(new URL("../", import.meta.url));
export const gitSource = (sha, relative) =>
  execFileSync("git", ["show", `${sha}:src/${relative}`], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
export const currentSource = (relative) =>
  readFileSync(new URL(`../src/${relative}`, import.meta.url), "utf8");
export const load = createSourceLoader();
export const core = load("model/technical-indicators/index.js");
export const historicalLoader = (sha = BASE) =>
  createSourceLoader({}, (relative) => gitSource(sha, relative));
export const ids = ["parabolic-sar", "supertrend"];
export const defaults = {
  "parabolic-sar": { start: 0.02, increment: 0.02, maximum: 0.2 },
  supertrend: { atrLength: 10, factor: 3 }
};
export const custom = {
  "parabolic-sar": { start: 0.2, increment: 0.2, maximum: 0.4 },
  supertrend: { atrLength: 2, factor: 1 }
};
export const make = core.createTechnicalIndicatorInstance;
export const calculate = (id, bars, params = {}) =>
  core.calculateTechnicalIndicator(make(id, id, { params }), bars);
export const ledger = () =>
  [
    [10, 8, 9],
    [12, 10, 11],
    [14, 12, 13],
    [15, 13, 14],
    [14, 11, 12],
    [12, 9, 10],
    [13, 10, 12]
  ].map(([high, low, close], i) => candle(close, null, high, low, i));
export const backup = (instances) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  layout: { technicalIndicators: instances },
  drawings: [],
  images: []
});
export const customInstance = (id, order = 0) =>
  make(id, `custom-${id}`, {
    params: custom[id],
    order,
    visible: false,
    pane: { kind: "pane", id: "shared-trend" },
    styles: Object.fromEntries(
      core.getTechnicalIndicatorDefinition(id).outputs.map((o, i) => [
        o.id,
        {
          color: "#123456",
          width: i + 2,
          visible: i === 0,
          opacity: 0.35,
          lineStyle: "dotted"
        }
      ])
    )
  });
export function invalidInstances(id) {
  const instance = make(id, id),
    definition = core.getTechnicalIndicatorDefinition(id);
  const invalid = [
    { ...instance, params: null },
    { ...instance, params: [] },
    { ...instance, params: { ...instance.params, unknown: 1 } },
    { ...instance, params: { ...instance.params, direction: 1 } },
    { ...instance, styles: null },
    { ...instance, styles: [] },
    { ...instance, styles: { hidden: { color: "#123456", width: 1, visible: true } } },
    { ...instance, schemaVersion: 2 },
    ...[
      "series",
      "timestamps",
      "historyRequirement",
      "warmupBars",
      "bodyMiddle",
      "presentation",
      "precisionPolicy"
    ].map((key) => ({ ...instance, [key]: {} }))
  ];
  for (const parameter of definition.parameters) {
    const missing = { ...instance.params };
    delete missing[parameter.key];
    invalid.push({ ...instance, params: missing });
    for (const value of [
      null,
      undefined,
      [],
      {},
      "2",
      NaN,
      Infinity,
      parameter.min - 0.01,
      parameter.max + 0.01,
      ...(parameter.type === "integer" ? [1.5] : [])
    ])
      invalid.push({ ...instance, params: { ...instance.params, [parameter.key]: value } });
  }
  for (const patch of [
    { color: "red" },
    { width: 0 },
    { width: 5 },
    { width: 1.5 },
    { visible: null },
    { opacity: 2 },
    { lineStyle: "unknown" },
    { mode: "auto" }
  ])
    invalid.push({
      ...instance,
      styles: {
        [definition.outputs[0].id]: { color: "#123456", width: 1, visible: true, ...patch }
      }
    });
  return invalid;
}
