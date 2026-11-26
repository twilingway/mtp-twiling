import test from "node:test";
import assert from "node:assert/strict";
import { numeric42Witness } from "./ta-render-contract-fixture.mjs";
import {
  createSourceLoader,
  core,
  contractHash,
  FROZEN42_SHA256
} from "./technical-state-oscillator-fixture.mjs";

const load = createSourceLoader(),
  { compilePresentation, presentationColor } = load("model/technical-indicators/presentation.js"),
  { presentationRuns } = load("model/technical-indicators/presentation-geometry.js");
const plot = (
  color = { kind: "solid", color: "#2962FF" },
  geometry = { kind: "line", gaps: "break" }
) => ({ id: "value", seriesKey: "value", geometry, color, width: 1 });
const definition = (plots = [plot()], fills = [], hiddenSeries = []) => ({
  renderVersion: 2,
  plots,
  fills,
  hiddenSeries
});
const input = (values, extra = {}) => ({
  timestamps: values.map((_, i) => i * 60000),
  series: { value: values },
  visible: true,
  collapsed: false,
  ...extra
});
const colors = (id, values, extra = {}) => {
  const compiled = compilePresentation(
    definition([plot({ kind: "palette", id }, { kind: "columns", base: 0 })]),
    input(values, extra)
  );
  return values.map((_, i) => presentationColor(compiled.plots[0], i));
};

test("render-only modules leave all original42 definitions, numeric results, history and v1 fixtures unchanged", () => {
  assert.equal(contractHash(core), FROZEN42_SHA256);
  // Captured from read-only git show50b5873 before any render metadata integration.
  assert.equal(
    numeric42Witness(core),
    "7cd3515d0bf89d288c3715165c8da0d3584df81ae50525ce2681825cde507ca3"
  );
});

test("MACD/PVO sign-change columns use immediate previous slots, zero branch, equality and missing masks", () => {
  const values = [null, 1, 2, 2, 0, -1, -2, -1, -1, null, -1, 0];
  assert.deepEqual(colors("macd-sign-change-v1", values), [
    null,
    "#B2DFDB",
    "#26A69A",
    "#B2DFDB",
    "#B2DFDB",
    "#FF5252",
    "#FF5252",
    "#FFCDD2",
    "#FF5252",
    null,
    "#FF5252",
    "#26A69A"
  ]);
});

test("AO columns compare change independent of sign; equality red, first/after-null locally green", () => {
  assert.deepEqual(colors("ao-change-v1", [-5, -3, -3, 3, 5, 4, null, -5]), [
    "#009688",
    "#009688",
    "#F44336",
    "#009688",
    "#009688",
    "#F44336",
    null,
    "#009688"
  ]);
});

test("any explicit v1 color is solid, including an old default; styles and numbers are never mutated", () => {
  const styles = {
      value: { color: "#B2DFDB", width: 3, visible: true, opacity: 0.35, lineStyle: "dotted" }
    },
    values = [1, 2, null, -1],
    before = structuredClone({ styles, values });
  assert.deepEqual(colors("macd-sign-change-v1", values, { styles }), [
    "#B2DFDB",
    "#B2DFDB",
    null,
    "#B2DFDB"
  ]);
  const compiled = compilePresentation(definition(), input(values, { styles }));
  assert.equal(compiled.plots[0].width, 3);
  assert.equal(compiled.plots[0].opacity, 0.35);
  assert.equal(compiled.plots[0].lineStyle, "dotted");
  assert.deepEqual({ styles, values }, before);
});

test("cross carries finite price outputs only and maps legacy width to relative size without connectors", () => {
  const d = definition([
      plot(undefined, { kind: "cross", size: { unit: "pine-relative", value: 1 } })
    ]),
    compiled = compilePresentation(
      d,
      input([100, null, 105], {
        styles: {
          value: { color: "#123456", width: 4, visible: true }
        }
      })
    );
  assert.deepEqual(compiled.plots[0].geometry, {
    kind: "cross",
    size: { unit: "pine-relative", value: 4 }
  });
  assert.equal(compiled.plots[0].scale, "include-when-visible");
  assert.deepEqual(compiled.plots[0].values, [100, null, 105]);
  assert.equal(presentationColor(compiled.plots[0], 1), null);
});

test("ST hidden anchors never become plots/scale; paired runs break on direction/null/missing body", () => {
  const up = [null, 10, 11, null, null, 13, 14],
    down = [null, null, null, 15, 14, null, null],
    body = [null, 12, 12, 13, null, 14, 15],
    d = definition(
      [
        { ...plot(), id: "up", seriesKey: "up" },
        { ...plot(), id: "down", seriesKey: "down" }
      ],
      [
        {
          id: "upfill",
          fromSeries: "body",
          toSeries: "up",
          color: "#4CAF50",
          opacity: 0.1,
          gaps: "break"
        },
        {
          id: "downfill",
          fromSeries: "body",
          toSeries: "down",
          color: "#F23645",
          opacity: 0.1,
          gaps: "break"
        }
      ],
      ["body", "direction"]
    ),
    source = input(up, { series: { up, down, body, direction: [1, -1, -1, 1, 1, -1, -1] } }),
    compiled = compilePresentation(d, source);
  assert.deepEqual(
    compiled.plots.map((p) => p.seriesKey),
    ["up", "down"]
  );
  assert.deepEqual(
    compiled.fills.map((f) => f.scale),
    ["none", "none"]
  );
  assert.deepEqual(presentationRuns(compiled.fills[0].from, compiled.fills[0].to), [
    { first: 1, last: 2 },
    { first: 5, last: 6 }
  ]);
  assert.deepEqual(presentationRuns(compiled.fills[1].from, compiled.fills[1].to), [
    { first: 3, last: 3 }
  ]);
  for (const patch of [{ visible: false }, { collapsed: true }]) {
    const hidden = compilePresentation(d, { ...source, ...patch });
    assert.ok(hidden.plots.every((p) => !p.visible));
    assert.ok(hidden.fills.every((f) => !f.visible));
  }
});

test("line runs preserve singleton and original adjacency; bounds never bridge unknown slots", () => {
  const values = [1, null, 3, 4, null, 6];
  assert.deepEqual(presentationRuns(values), [
    { first: 0, last: 0 },
    { first: 2, last: 3 },
    { first: 5, last: 5 }
  ]);
  assert.deepEqual(presentationRuns(values, undefined, 1, 4), [{ first: 2, last: 3 }]);
  assert.deepEqual(presentationRuns([], undefined), []);
  assert.deepEqual(presentationRuns(values, undefined, 100, 200), []);
  assert.deepEqual(presentationRuns(values, undefined, -2, 0), [{ first: 0, last: 0 }]);
  assert.throws(() => presentationRuns(values, [1]), RangeError);
  assert.throws(() => presentationRuns(values, undefined, 0.5, 3), RangeError);
});

test("compiler rejects invalid graph/version/null shape/length/non-finite/timestamps without inventing data", () => {
  const d = definition(),
    source = input([1, null, 3]);
  for (const malformed of [
    { ...d, renderVersion: 3 },
    definition([plot(), plot()]),
    definition([{ ...plot(), seriesKey: "missing" }]),
    definition([plot()], [], ["value"]),
    definition([plot({ kind: "palette", id: "unknown" }, { kind: "columns", base: 0 })]),
    definition([plot({ kind: "palette", id: "ao-change-v1" })]),
    definition(
      [plot()],
      [
        {
          id: "value",
          fromSeries: "value",
          toSeries: "value",
          color: "#123456",
          opacity: 0.1,
          gaps: "break"
        }
      ]
    )
  ])
    assert.throws(() => compilePresentation(malformed, source), RangeError);
  for (const extra of [
    { series: { value: [1, 2] } },
    { series: { value: [1, undefined, 3] } },
    { series: { value: [1, NaN, 3] } },
    { series: { value: [1, Infinity, 3] } },
    { timestamps: [0, 0, 1] },
    { timestamps: [0, 2, 1] },
    { styles: { unknown: { color: "#123456", width: 1, visible: true } } },
    { styles: { value: { color: "#123456", width: 1, visible: true, opacity: -1 } } }
  ])
    assert.throws(() => compilePresentation(d, { ...source, ...extra }), RangeError);
});
