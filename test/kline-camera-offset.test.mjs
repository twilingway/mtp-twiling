import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { readKlineCameraOffset, preserveKlineCamera } = sourceLoader({
  "charts/klinecharts": { DomPosition: { Main: "main" } }
})("charts/kline-preserve-camera.ts");

function fixture(initialSpacing = 13, initialOffset = 18) {
  let spacing = initialSpacing;
  let offset = initialOffset;
  let width = 800;
  let available = true;
  const writes = [];
  const chart = {
    getBarSpace: () => spacing,
    getOffsetRightDistance: () => Math.max(0, offset * spacing),
    getSize: () => available ? { width } : undefined,
    getDataList: () => [{ timestamp: 0 }],
    convertToPixel: () => available ? [{ x: Math.floor(width - (offset + 0.5) * spacing) }] : [],
    setBarSpace: (value) => { spacing = value; },
    setOffsetRightDistance: (value) => { offset = value / spacing; writes.push(value); }
  };
  return {
    chart, writes,
    setOffset: (value) => { offset = value; },
    setWidth: (value) => { width = value; },
    unavailable: () => { available = false; }
  };
}

test("fractional positive camera survives repeated native floor-quantized reads and restoration", () => {
  for (const [spacing, offset] of [[13, 18], [8, 12.5], [13.25, 18.375], [1.3, 0.02]]) {
    const f = fixture(spacing, offset);
    for (let iteration = 0; iteration < 100; iteration++) {
      const restored = readKlineCameraOffset(f.chart);
      assert.equal(restored, offset);
      f.chart.setOffsetRightDistance(restored * f.chart.getBarSpace());
    }
  }
});

test("unmodified fractional positive camera does not accumulate preservation writes", () => {
  const f = fixture();
  for (let iteration = 0; iteration < 100; iteration++)
    preserveKlineCamera(f.chart, () => {});
  assert.equal(readKlineCameraOffset(f.chart), 18);
  assert.deepEqual(f.writes, []);
});

test("native reconfiguration restores the exact fractional positive spacing and offset", () => {
  const f = fixture(13, 18.375);
  preserveKlineCamera(f.chart, () => {
    f.chart.setBarSpace(6);
    f.setOffset(0);
    f.setWidth(765);
  });
  assert.equal(f.chart.getBarSpace(), 13);
  assert.equal(readKlineCameraOffset(f.chart), 18.375);
  assert.deepEqual(f.writes, [18.375 * 13]);
});

test("clamped zero and historical negative offsets retain the signed geometry fallback", () => {
  const f = fixture(8, -37);
  assert.equal(f.chart.getOffsetRightDistance(), 0);
  assert.equal(readKlineCameraOffset(f.chart), -37);
  preserveKlineCamera(f.chart, () => f.setOffset(0));
  assert.equal(readKlineCameraOffset(f.chart), -37);
  assert.deepEqual(f.writes, [-296]);
  f.setOffset(0);
  assert.equal(readKlineCameraOffset(f.chart), 0);
});

test("positive offsets remain exact when plot geometry is temporarily unavailable", () => {
  const f = fixture(13, 18.375);
  f.unavailable();
  assert.equal(readKlineCameraOffset(f.chart), 18.375);
  f.setOffset(0);
  assert.equal(readKlineCameraOffset(f.chart), 0);
});
