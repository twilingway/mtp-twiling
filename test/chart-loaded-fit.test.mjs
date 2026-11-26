import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { nativeFixture } from "./native-technical-fixture.mjs";

const { lightweightLoadedFit } = createSourceLoader()("charts/lightweight-loaded-fit.js");

test("Lightweight can fit all loaded 15m bars, survives one reflow and suppresses only fit backfill", (t) => {
  const callbacks = new Map();
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.set(++frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  t.after(() => {
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  });
  function frame() {
    const batch = [...callbacks.values()];
    callbacks.clear();
    for (const callback of batch) callback();
  }
  let width = 800;
  let bars = 20_000;
  let spacing = 6;
  let minimum = 0.5;
  let near = 0;
  let native = 0;
  let onSize;
  let onVisible;
  const windows = [];
  const scale = {
    width: () => width,
    options: () => ({ minBarSpacing: minimum, barSpacing: spacing }),
    applyOptions: (options) => {
      minimum = options.minBarSpacing;
      spacing = Math.max(minimum, spacing);
    },
    subscribeSizeChange: (handler) => {
      onSize = handler;
    },
    subscribeVisibleLogicalRangeChange: (handler) => {
      onVisible = handler;
    },
    setVisibleLogicalRange: (range) => {
      windows.push(range);
      spacing = Math.max(minimum, width / (range.to - range.from + 1));
      onVisible(range);
    }
  };
  const fit = lightweightLoadedFit(
    scale,
    () => bars,
    () => near++,
    () => native++
  );
  fit.updateMinimum();
  assert.equal(minimum, 0.04);
  assert.equal(spacing, 6, "changing only the zoom-out limit leaves the active camera intact");
  fit.fit();
  assert.deepEqual(windows, [{ from: 0, to: 19_999 }]);
  assert.equal(spacing, 0.04);
  assert.equal(near, 0);
  width = 780;
  frame();
  onSize();
  assert.equal(minimum, 0.039);
  assert.equal(spacing, 0.039);
  assert.deepEqual(windows.at(-1), { from: 0, to: 19_999 });
  assert.equal(near, 0);
  frame();
  onVisible({ from: 4, to: 56 });
  assert.equal(near, 1, "ordinary later navigation still reaches older history");
  assert.equal(native, 3);
  bars = 100;
  fit.updateMinimum();
  assert.equal(minimum, 0.5);
  fit.fit();
  fit.dispose();
  assert.equal(callbacks.size, 0);
});

test("KLine fit right-aligns loaded bars within the 1px minimum and leaves its Reset baseline intact", () => {
  let near = 0;
  const f = nativeFixture("kline", [], { timeframe: "15m", onNearStart: () => near++ });
  const data = Array.from({ length: 4000 }, (_, index) => ({
    timestamp: Date.UTC(2026, 0, 1) + index * 15 * 60_000,
    open: 100,
    high: 110,
    low: 90,
    close: 101,
    volume: 1
  }));
  f.adapter.setData(data, false);
  f.adapter.setView({ camera: { barSpace: 13, rightOffsetBars: -25 } });
  const setBarSpace = f.native.setBarSpace.bind(f.native);
  f.native.setBarSpace = (spacing) => {
    setBarSpace(spacing);
    f.emit("visible", { from: 0 });
  };
  f.adapter.fit();
  const size = f.adapter.plotSize();
  const [first, last] = f.native.convertToPixel([{ dataIndex: 0 }, { dataIndex: data.length - 1 }]);
  assert.equal(f.native.getBarSpace(), 1);
  assert.equal(last.x, size.width - 0.5);
  assert.ok(first.x < 0, "the pinned engine cannot fit more real bars than pixels");
  assert.equal(near, 0);
  assert.deepEqual(f.native.getDataList(), data);
  f.emit("visible", { from: 0 });
  assert.equal(near, 1);
  f.adapter.resetView();
  assert.deepEqual(f.camera(), { spacing: 6, offset: 8 });
  f.adapter.destroy();
});
