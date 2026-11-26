import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { lightweightDrawingX } = load("charts/lightweight-drawing-projection.js");
const { logicalForTime } = load("model/intervals/projected-time.js");
const { drawingGeometry } = load("model/drawing-model.js");
const sdk = readFileSync(
  new URL(
    "../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",
    import.meta.url
  ),
  "utf8"
);
const implementation = sdk.match(
  /\n    _internal_indexToCoordinate\(index\) \{[\s\S]*?\n    \}/
)?.[0];
assert.ok(implementation, "the installed Lightweight coordinate method is available");
const indexToX = vm.runInNewContext(`({ ${implementation} })._internal_indexToCoordinate`, {
  isInteger: Number.isInteger
});

const hour = 3_600_000;
const day = 24 * hour;
const sessionStart = Date.UTC(2026, 10, 23);
const anchors = Object.freeze([
  Object.freeze({ timestamp: sessionStart + day, value: 12 }),
  Object.freeze({ timestamp: sessionStart + 2 * day, value: 13 })
]);

for (const { step, barSpacing, indices, expected } of [
  { step: 4 * hour, barSpacing: 20, indices: [4.5, 9.5], expected: [599, 699] },
  { step: 5 * 60_000, barSpacing: 1, indices: [192.5, 385.5], expected: [413, 606] }
]) {
  test(`daily line and Fibonacci anchors keep their horizontal span on ${step / 60_000}m`, () => {
    const candles = [];
    for (let date = 0; date < 3; date++)
      for (let time = 4 * hour; time <= 20 * hour; time += step)
        candles.push({ timestamp: sessionStart + date * day + time });
    const scale = {
      logicalToCoordinate: (index) =>
        indexToX.call(
          {
            _internal_isEmpty: () => false,
            _internal_baseIndex: () => candles.length - 1,
            _private__rightOffset: 0,
            _private__barSpacing: barSpacing,
            _private__width: 800
          },
          index
        )
    };
    const logical = (timestamp) => logicalForTime(candles, timestamp, step);
    assert.deepEqual(
      anchors.map((anchor) => logical(anchor.timestamp)),
      indices
    );
    assert.deepEqual(indices.map(scale.logicalToCoordinate), [0, 0]);
    const project = ({ timestamp, value }) => ({
      x: lightweightDrawingX(scale, logical(timestamp)),
      y: 300 - (value - 12) * 100
    });
    const fib = drawingGeometry({ name: "fibonacciLine", points: anchors }, project, 800, 600);
    assert.deepEqual([fib.from, fib.to], expected);
    const segment = drawingGeometry({ name: "segment", points: anchors }, project, 800, 600);
    assert.deepEqual(
      segment.lines[0].map(({ x }) => x),
      expected
    );
    const exact = candles[1].timestamp;
    assert.equal(project({ timestamp: exact, value: 12 }).x, scale.logicalToCoordinate(1));
    const unloaded = project({ timestamp: sessionStart - 120 * day - step / 2, value: 12 });
    assert.ok(unloaded.x < 0, "an older anchor does not teleport into the viewport");
  });
}

test("missing scale geometry and invalid logical indexes do not look like the left edge", () => {
  assert.equal(lightweightDrawingX({ logicalToCoordinate: () => null }, 3.5), null);
  assert.equal(lightweightDrawingX({ logicalToCoordinate: () => 42 }, NaN), null);
});
