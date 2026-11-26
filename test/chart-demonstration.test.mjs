import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { demonstrationOpacity, demonstrationPoint } = sourceLoader()(
  "screens/terminal/chart-demonstration.ts"
);

test("a demonstration mark holds for two seconds and fades within the third", () => {
  assert.deepEqual(
    [0, 1999, 2000, 2250, 2500, 2750, 3000, 60_000].map((time) =>
      demonstrationOpacity(time, false)
    ),
    [1, 1, 1, 0.75, 0.5, 0.25, 0, 0]
  );
});

test("reduced motion keeps a static mark until dismissal", () => {
  assert.deepEqual(
    [0, 2000, 2500, 2999, 3000, 60_000].map((time) => demonstrationOpacity(time, true)),
    [1, 1, 1, 1, 0, 0]
  );
});

test("only valid coordinates inside the price plot can create marks", () => {
  const plot = { left: 240, top: 350, width: 160, height: 90 };
  assert.deepEqual(demonstrationPoint(240, 350, plot), { x: 0, y: 0 });
  assert.deepEqual(demonstrationPoint(399.5, 439, plot), { x: 159.5, y: 89 });
  for (const [x, y] of [
    [239, 360],
    [279, 349],
    [400, 385],
    [255, 440],
    [NaN, 374],
    [245, Infinity]
  ])
    assert.equal(demonstrationPoint(x, y, plot), null);
});
