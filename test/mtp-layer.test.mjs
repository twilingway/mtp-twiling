import test from "node:test";
import assert from "node:assert/strict";
import { lightweightMtp } from "../public/mtp.js";

test("MTP renders after the grid, before candles, and only once per frame", () => {
  let primitive;
  let invalidations = 0;
  const stages = [];
  const context = { save() {}, restore() {}, scale() {} };
  const target = {
    useBitmapCoordinateSpace(draw) {
      draw({ context, horizontalPixelRatio: 2, verticalPixelRatio: 2 });
    }
  };
  const chart = {
    timeScale: () => ({
      getVisibleLogicalRange: () => ({ from: 4, to: 8 }),
      logicalToCoordinate: (index) => index * 5
    })
  };
  const series = {
    priceToCoordinate: (price) => 100 - price,
    attachPrimitive(value) { primitive = value; },
    detachPrimitive(value) { assert.equal(value, primitive); }
  };
  const model = {
    draw(ctx, from, to, xFor, yFor) {
      assert.equal(ctx, context);
      assert.equal(from, 4);
      assert.equal(to, 8);
      assert.equal(xFor(4), 20);
      assert.equal(yFor(30), 70);
      stages.push("mtp");
    }
  };
  const mtp = lightweightMtp(chart, series, model);
  primitive.attached({ requestUpdate: () => invalidations++ });
  const view = primitive.paneViews()[0];
  const renderer = view.renderer();
  // Lightweight 5 draws bottom views, grid, normal backgrounds, series foregrounds.
  if (view.zOrder() === "bottom") renderer.draw(target);
  stages.push("grid");
  if (view.zOrder() === "normal") renderer.drawBackground(target);
  stages.push("candles");
  if (view.zOrder() === "normal") renderer.draw(target);
  assert.deepEqual(stages, ["grid", "mtp", "candles"]);
  mtp.update();
  assert.equal(invalidations, 1);
  mtp.destroy();
});
