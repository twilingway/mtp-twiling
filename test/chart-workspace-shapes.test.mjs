import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { CHART_LAYOUTS, CHART_LAYOUT_COUNTS, chartLayout, chartGridDividers, defaultChartLayout } =
  load("model/chart-workspace-layout.ts");
const { readWorkspaceGridSizes, workspaceGridStorageKey, writeWorkspaceGridSizes } = load(
  "screens/terminal/workspace-grid-storage.ts"
);

function cellsFor({ rows, columns, panes, count }) {
  const cells = Array.from({ length: rows }, () => Array(columns).fill(0));
  assert.deepEqual(
    panes.map(({ slot }) => slot),
    Array.from({ length: count }, (_, index) => index + 1)
  );
  for (const pane of panes) {
    for (const [start, end, limit] of [
      [pane.rowStart, pane.rowEnd, rows],
      [pane.columnStart, pane.columnEnd, columns]
    ])
      assert.ok(
        Number.isInteger(start) &&
          Number.isInteger(end) &&
          start >= 0 &&
          end > start &&
          end <= limit
      );
    for (let row = pane.rowStart; row < pane.rowEnd; row++) {
      for (let column = pane.columnStart; column < pane.columnEnd; column++) {
        assert.equal(cells[row][column], 0);
        cells[row][column] = pane.slot;
      }
    }
  }
  assert.ok(cells.every((row) => row.every((slot) => slot !== 0)));
  return cells;
}

test("each layout exactly fills its grid with distinct stable slots", () => {
  assert.equal(new Set(CHART_LAYOUTS.map(({ id }) => id)).size, CHART_LAYOUTS.length);
  assert.equal(chartLayout("99-wide"), undefined);
  assert.equal(chartLayout(null), undefined);
  for (const count of CHART_LAYOUT_COUNTS) {
    const choices = CHART_LAYOUTS.filter((item) => item.count === count);
    assert.ok(choices.includes(defaultChartLayout(count)));
    assert.ok(choices.length >= (count === 1 ? 1 : 2));
    assert.equal(new Set(choices.map(({ panes }) => JSON.stringify(panes))).size, choices.length);
    for (const item of choices) {
      assert.equal(chartLayout(item.id), item);
      cellsFor(item);
    }
  }
});

test("every resize handle covers exactly the shared edges of each layout", () => {
  for (const item of CHART_LAYOUTS) {
    const cells = cellsFor(item);
    const handles = chartGridDividers(item, false);
    const has = (axis, boundary, cross) =>
      handles.some(
        (handle) =>
          handle.axis === axis &&
          handle.boundary === boundary &&
          handle.cross.start <= cross &&
          cross < handle.cross.end
      );
    for (let row = 0; row < item.rows; row++) {
      for (let column = 0; column < item.columns; column++) {
        if (row)
          assert.equal(has("row", row, column), cells[row][column] !== cells[row - 1][column]);
        if (column)
          assert.equal(has("column", column, row), cells[row][column] !== cells[row][column - 1]);
      }
    }
    assert.deepEqual(
      chartGridDividers(item, true).map(({ axis, boundary, cross }) => [axis, boundary, cross]),
      Array.from({ length: item.count - 1 }, (_, i) => ["row", i + 1, { start: 0, end: 1 }])
    );
  }
});

test("device-local track sizes are scoped by owner, layout and screen mode", () => {
  const properties = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value)
    }
  });
  try {
    const layout = defaultChartLayout(3);
    const desktop = workspaceGridStorageKey("first", layout, false);
    const mobile = workspaceGridStorageKey("first", layout, true);
    const alternate = workspaceGridStorageKey("first", chartLayout("3-wide"), false);
    const other = workspaceGridStorageKey("second", layout, false);
    assert.equal(new Set([desktop, mobile, alternate, other]).size, 4);
    writeWorkspaceGridSizes(desktop, { row: [250, 350] });
    writeWorkspaceGridSizes(mobile, { row: [320, 280, 300] });
    assert.deepEqual(readWorkspaceGridSizes(desktop, layout, false), { row: [250, 350] });
    assert.deepEqual(readWorkspaceGridSizes(mobile, layout, true), { row: [320, 280, 300] });
    assert.deepEqual(readWorkspaceGridSizes(alternate, chartLayout("3-wide"), false), {});
    assert.deepEqual(readWorkspaceGridSizes(other, layout, false), {});
    data.set(desktop, '{"row":[250,0],"column":[1]}');
    assert.deepEqual(readWorkspaceGridSizes(desktop, layout, false), {});
  } finally {
    if (properties) Object.defineProperty(globalThis, "localStorage", properties);
    else delete globalThis.localStorage;
  }
});
