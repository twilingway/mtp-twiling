import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { bindDrawingAxisLabels, bindImageProjection } = sourceLoader()(
  "screens/terminal/drawing-projection.ts"
);
const labels = { prices: [], times: [], timeStyle: { fill: "#2962ff", textColor: "#fff" } };

test("logical labels attach to asynchronous adapters once without starting a repaint loop", () => {
  const projection = new EventTarget();
  let chart = null;
  const writes = [];
  const stop = bindDrawingAxisLabels(() => chart, projection, labels);
  chart = {
    setDrawingAxisLabels(value) {
      writes.push(value);
      // Native label invalidation can synchronously enter a paint callback.
      projection.dispatchEvent(new Event("change"));
    }
  };
  projection.dispatchEvent(new Event("change"));
  projection.dispatchEvent(new Event("change"));
  assert.deepEqual(writes, [labels]);
  stop();
  assert.deepEqual(writes, [labels, null]);
  projection.dispatchEvent(new Event("change"));
  assert.equal(writes.length, 2);
});

test("old label cleanup cannot clear a replacement adapter and retired adapters are skipped", () => {
  const projection = new EventTarget();
  const oldWrites = [];
  const nextWrites = [];
  const original = { setDrawingAxisLabels: (value) => oldWrites.push(value) };
  const replacement = { setDrawingAxisLabels: (value) => nextWrites.push(value) };
  let chart = original;
  const stopOld = bindDrawingAxisLabels(() => chart, projection, labels);
  chart = replacement;
  stopOld();
  assert.deepEqual(oldWrites, [labels, null]);
  assert.deepEqual(nextWrites, []);
  const stopNext = bindDrawingAxisLabels(() => chart, projection, labels);
  replacement.retired = true;
  projection.dispatchEvent(new Event("change"));
  stopNext();
  assert.deepEqual(nextWrites, [labels]);
});

test("adapter replacement remains synchronous when clearing the old adapter repaints", () => {
  const projection = new EventTarget();
  const writes = [];
  let chart = {
    setDrawingAxisLabels(value) {
      writes.push(["old", value]);
      projection.dispatchEvent(new Event("change"));
    }
  };
  const stop = bindDrawingAxisLabels(() => chart, projection, labels);
  chart = { setDrawingAxisLabels: (value) => writes.push(["new", value]) };
  projection.dispatchEvent(new Event("change"));
  assert.deepEqual(writes, [
    ["old", labels],
    ["old", null],
    ["new", labels]
  ]);
  stop();
});

test("images move in the same projection event and retain the latest drag origin", () => {
  const projection = new EventTarget();
  const element = { style: { transform: "" }, hidden: false };
  let projected = { x: 20, y: 30 };
  let dragPoint = null;
  const stop = bindImageProjection(
    element,
    projection,
    () => projected,
    (point) => {
      dragPoint = point;
    },
    true
  );
  assert.equal(element.style.transform, "translate(20px,30px)");
  projected = { x: 80, y: 90 };
  projection.dispatchEvent(new Event("change"));
  assert.equal(element.style.transform, "translate(80px,90px)");
  assert.deepEqual(dragPoint, projected);
  projected = { x: NaN, y: 90 };
  projection.dispatchEvent(new Event("change"));
  assert.equal(element.hidden, true);
  assert.equal(dragPoint, null);
  projected = { x: 100, y: 110 };
  stop();
  projection.dispatchEvent(new Event("change"));
  assert.equal(element.hidden, true);
  assert.equal(dragPoint, null);
});
