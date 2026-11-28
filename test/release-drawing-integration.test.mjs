import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({ "i18n/messages.ts": { t: (value) => value } });
const { dragChartDrawing } = load("screens/terminal/chart-drawing-drag.ts");
const { annotationDefaults } = load("model/drawing-annotation.ts");
const json = (value) => JSON.parse(JSON.stringify(value));
const project = ({ timestamp, value }) => ({ x: timestamp, y: value });
const chart = {
  plotSize: () => ({ width: 1000, height: 600 }),
  pointToPixel: project,
  pixelToPoint: (timestamp, value) => ({ timestamp, value })
};
const pointerPoint = ({ x, y }) => ({ timestamp: x, value: y });
const arc = (
  points = [
    { timestamp: 0, value: 0 },
    { timestamp: 200, value: 0 },
    { timestamp: 350, value: 80 }
  ]
) => ({ id: "arc", name: "arc", points });
const gesture = (original, handle, clone = false) => ({
  id: original.id,
  original,
  pixels: original.points.map(project),
  handle,
  clone,
  cloneId: clone ? "clone" : null,
  start: { x: 0, y: 0 }
});

test("release shared drag preserves raw Arc anchors for body/Ctrl-clone and constrains only visible C edits", () => {
  const original = arc();
  const translated = original.points.map((point) => ({
    timestamp: point.timestamp + 30,
    value: point.value + 50
  }));
  for (const [handle, clone] of [
    [-1, false],
    [-1, true],
    [2, true]
  ]) {
    const result = dragChartDrawing(
      gesture(original, handle, clone),
      { x: 30, y: 50 },
      chart,
      pointerPoint,
      null
    );
    assert.deepEqual(json(result.points), translated);
    assert.equal(result.id, clone ? "clone" : "arc");
  }
  const control = dragChartDrawing(
    gesture(original, 2),
    { x: 250, y: 100 },
    chart,
    pointerPoint,
    null
  );
  assert.deepEqual(json(control.points), [
    original.points[0],
    original.points[1],
    { timestamp: 100, value: 180 }
  ]);
  assert.equal(original.points[2].timestamp, 350, "legacy raw anchor remains intact");
});

test("release shared drag atomically rejects an Arc endpoint edit whose constrained C leaves the pane", () => {
  const original = arc([
    { timestamp: 0, value: 100 },
    { timestamp: 200, value: 100 },
    { timestamp: 100, value: 180 }
  ]);
  const bounded = {
    ...chart,
    pixelToPoint: (timestamp, value) =>
      timestamp >= 0 && timestamp <= 200 && value >= 0 && value <= 200 ? { timestamp, value } : null
  };
  const result = dragChartDrawing(
    gesture(original, 0),
    { x: 0, y: 80 },
    bounded,
    pointerPoint,
    null
  );
  assert.deepEqual(json(result.points), original.points);
});

test("release shared drag retains annotation virtual handles independently of Arc anchor constraints", () => {
  const table = {
    id: "table",
    name: "table",
    points: [{ timestamp: 100, value: 100 }],
    settings: annotationDefaults("table")
  };
  const resized = dragChartDrawing(gesture(table, 100), { x: 30, y: 0 }, chart, pointerPoint, null);
  assert.deepEqual(json(resized.settings.annotation.table.columnWidths), [150, 90, 120]);
  assert.equal(resized.points, table.points);
  const signpost = {
    id: "signpost",
    name: "signpost",
    points: table.points,
    settings: annotationDefaults("signpost")
  };
  const moved = dragChartDrawing(gesture(signpost, 1), { x: 30, y: 50 }, chart, pointerPoint, null);
  assert.equal(moved.settings.annotation.offsetX, 30);
  assert.equal(moved.settings.annotation.offsetY, -10);
  assert.equal(moved.points, signpost.points);
});
