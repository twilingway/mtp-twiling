import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader({ "react/jsx-runtime": jsxRuntime });
const {
  CHART_LAYOUT_COUNTS,
  chartGridDividers,
  chartGridResizeRange,
  chartLayoutRowWidths,
  isChartLayoutCount,
  resizeChartGridTracks
} = load("model/chart-workspace-layout.js");
const { ChartLayoutControl } = load("screens/terminal/ChartLayoutControl.js");

test("three-chart legacy and large layouts keep stable balanced rows", () => {
  assert.deepEqual(
    CHART_LAYOUT_COUNTS,
    Array.from({ length: 16 }, (_, i) => i + 1)
  );
  for (const count of CHART_LAYOUT_COUNTS) {
    assert.equal(isChartLayoutCount(count), true);
    const widths = chartLayoutRowWidths(count);
    assert.equal(
      widths.reduce((sum, value) => sum + value, 0),
      count
    );
    assert.ok(widths.length <= 4);
    assert.ok(Math.max(...widths) <= 4);
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1);
  }
  assert.deepEqual(chartLayoutRowWidths(1), [1]);
  assert.deepEqual(chartLayoutRowWidths(2), [2]);
  assert.deepEqual(chartLayoutRowWidths(3), [2, 1]);
  assert.deepEqual(chartLayoutRowWidths(7), [3, 2, 2]);
  assert.deepEqual(chartLayoutRowWidths(10), [4, 3, 3]);
  assert.deepEqual(chartLayoutRowWidths(16), [4, 4, 4, 4]);
  for (const invalid of [0, 17, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(isChartLayoutCount(invalid), false);
});

test("layout select exposes all chart counts and previews a 4×4 grid", () => {
  const { setDisplayPreferences } = load("i18n/preferences.js");
  setDisplayPreferences({ locale: "en" });
  const control = renderToStaticMarkup(
    createElement(ChartLayoutControl, { value: 16, onChange: () => {} })
  );
  assert.match(control, /<select aria-label="Chart layout" aria-controls="chart-workspace">/);
  assert.equal(control.match(/<option /g)?.length, 16);
  assert.match(control, /<option value="16" aria-label="Chart count: 16" selected="">16<\/option>/);
  assert.equal(control.match(/class="chart-layout-icon-row"/g)?.length, 4);
  assert.equal(control.match(/class="chart-layout-icon-cell"/g)?.length, 16);
});

test("resize handles follow the real visual boundaries of stacked and wide layouts", () => {
  const boundaries = (count, narrow) =>
    chartGridDividers(count, narrow).map(({ axis, boundary, cross }) => [
      axis,
      boundary,
      cross.start,
      cross.end
    ]);
  assert.deepEqual(boundaries(1, false), []);
  assert.deepEqual(boundaries(3, false), [
    ["column", 6, 0, 2],
    ["row", 1, 6, 12]
  ]);
  assert.deepEqual(boundaries(3, true), [
    ["row", 1, 0, 1],
    ["row", 2, 0, 1]
  ]);
  assert.deepEqual(boundaries(16, false), [
    ["column", 3, 0, 4],
    ["column", 6, 0, 4],
    ["column", 9, 0, 4],
    ["row", 1, 0, 12],
    ["row", 2, 0, 12],
    ["row", 3, 0, 12]
  ]);
  assert.equal(boundaries(16, true).length, 15);
});

test("resizing adjacent tracks preserves the sum and minimum while leaving other tracks fixed", () => {
  const rows = [400, 400, 400];
  const [row] = chartGridDividers(3, true);
  assert.deepEqual(chartGridResizeRange(rows, row, 240), [-160, 160]);
  assert.deepEqual(resizeChartGridTracks(rows, row, Infinity, 240), [560, 240, 400]);
  const columns = Array(12).fill(100);
  const [firstColumn, nextColumn] = chartGridDividers(10, false);
  assert.equal(firstColumn.boundary, 3);
  assert.equal(nextColumn.boundary, 4);
  const next = resizeChartGridTracks(columns, firstColumn, 500, 120);
  assert.ok(Math.abs(next.slice(0, 3).reduce((sum, value) => sum + value, 0) - 392) < 1e-9);
  assert.ok(Math.abs(next[3] - 8) < 1e-9);
  assert.deepEqual(next.slice(4), columns.slice(4));
  assert.ok(Math.abs(next.reduce((sum, value) => sum + value, 0) - 1200) < 1e-9);
  assert.deepEqual(columns, Array(12).fill(100));
});
