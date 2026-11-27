import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/model/opaque-rect-culler.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 }
}).outputText;
const { OpaqueRectCuller, OpaqueRectUnsupportedError } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const LIMIT = 16 * 1024 * 1024;

function reference(width, height, rectangles) {
  const pixels = new Uint8Array(width * height);
  for (const [x, y, w, h, style] of rectangles) {
    if (style === 0) continue;
    // An intentionally slow original-order pixel oracle, independent of the coverage algorithm.
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (
          col >= Math.min(x, x + w) &&
          col < Math.max(x, x + w) &&
          row >= Math.min(y, y + h) &&
          row < Math.max(y, y + h)
        ) {
          pixels[row * width + col] = style;
        }
      }
    }
  }
  return pixels;
}

function paint(culler, width, height) {
  const pixels = new Uint8Array(width * height);
  const written = new Uint8Array(pixels.length);
  const styles = [];
  let style = 0;
  culler.paint({
    setStyle(value) {
      style = value;
      assert.ok(style >= 1 && style <= 255);
      assert.ok(!styles.includes(style), "Each style is grouped once");
      styles.push(style);
    },
    fillRect(x, y, w, h) {
      assert.ok([x, y, w, h].every(Number.isSafeInteger));
      assert.equal(w, 1);
      assert.ok(h > 0 && x >= 0 && x + w <= width && y >= 0 && y + h <= height);
      for (let row = y; row < y + h; row++) {
        const address = row * width + x;
        assert.equal(written[address], 0, "Fragments must not overlap");
        written[address] = 1;
        pixels[address] = style;
      }
    }
  });
  return pixels;
}

function compare(width, height, rectangles) {
  const culler = new OpaqueRectCuller(width, height);
  culler.begin();
  for (const rect of rectangles) culler.addRect(...rect);
  culler.cull();
  assert.deepEqual(paint(culler, width, height), reference(width, height, rectangles));
  assert.ok(culler.memoryBytes <= LIMIT);
  return culler;
}

test("reverse painter preserves gaps, negative clipping, transparent overlays and all style IDs", () => {
  compare(64, 99, [
    [-9, -4, 21, 45, 255],
    [8, 80, -7, -74, 1],
    [0, 31, 40, 34, 3],
    [31, 96, -15, -65, 2],
    [5, 5, 30, 75, 0],
    [39, 60, 0, 17, 9],
    [39, 60, 17, 0, 9],
    [61, 90, 21, 21, 4],
    [6, 32, 3, 1, 1],
    [11, 63, 1, 2, 255]
  ]);
  compare(
    255,
    3,
    Array.from({ length: 255 }, (_, index) => [index, 0, 1, 3, index + 1])
  );
});

test("bit31 and complete words coalesce into a single vertical fragment", () => {
  const culler = compare(1, 130, [[0, 0, 1, 130, 5]]);
  assert.equal(culler.fragmentCount, 1);
  const rects = [];
  culler.paint({ setStyle() {}, fillRect: (...args) => rects.push(args) });
  assert.deepEqual(rects, [[0, 0, 1, 130]]);
  compare(1, 130, [
    [0, 0, 1, 130, 5],
    [0, 31, 1, 1, 6],
    [0, 32, 1, 1, 7],
    [0, 63, 1, 2, 8],
    [0, 95, 1, 2, 9],
    [0, 127, 1, 1, 10]
  ]);
});

test("deterministic differential frames match a naive original-order pixel reference", () => {
  let seed = 0x718af024;
  const random = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  for (let round = 0; round < 40; round++) {
    const width = [17, 33, 64][round % 3];
    const height = [31, 32, 33, 65, 97, 130][round % 6];
    const rectangles = Array.from({ length: 60 }, () => [
      random(width + 30) - 15,
      random(height + 40) - 20,
      random(41) - 20,
      random(141) - 70,
      random(8) === 0 ? 0 : random(255) + 1
    ]);
    compare(width, height, rectangles);
  }
});

test("begin reuses allocations, clears coverage/counts and permits repeated exact frames", () => {
  const culler = compare(8, 70, [[0, 0, 8, 70, 1]]);
  const retained = culler.memoryBytes;
  culler.begin();
  assert.equal(culler.commandCount, 0);
  assert.equal(culler.fragmentCount, 0);
  assert.equal(culler.memoryBytes, retained);
  culler.addRect(2, 31, 1, 2, 255);
  culler.cull();
  assert.deepEqual(paint(culler, 8, 70), reference(8, 70, [[2, 31, 1, 2, 255]]));
  culler.cull();
  assert.equal(culler.memoryBytes, retained);
  culler.begin();
  culler.cull();
  assert.equal(culler.fragmentCount, 0);
  assert.deepEqual(paint(culler, 8, 70), new Uint8Array(560));
});

test("rejects unsafe geometry/styles and wide rectangles before any paint", () => {
  for (const rect of [
    [0.5, 0, 1, 1, 1],
    [0, NaN, 1, 1, 1],
    [0, 0, Infinity, 1, 1],
    [0, 0, 1, 0.25, 1],
    [Number.MAX_SAFE_INTEGER, 0, 1, 1, 1],
    [0, Number.MIN_SAFE_INTEGER, 1, -1, 1],
    [0, 0, 1, 1, -1],
    [0, 0, 1, 1, 256],
    [0, 0, 1, 1, 1.5],
    [0, 0, 65, 1, 1]
  ]) {
    const culler = new OpaqueRectCuller(100, 70);
    culler.addRect(0, 0, 1, 70, 2);
    assert.throws(() => culler.addRect(...rect), OpaqueRectUnsupportedError);
    assert.throws(() => culler.cull(), OpaqueRectUnsupportedError);
    let writes = 0;
    assert.throws(
      () =>
        culler.paint({
          setStyle() {
            writes++;
          },
          fillRect() {
            writes++;
          }
        }),
      OpaqueRectUnsupportedError
    );
    assert.equal(writes, 0);
    culler.begin();
    culler.addRect(0, 0, 1, 1, 2);
    culler.cull();
    assert.equal(paint(culler, 100, 70)[0], 2);
  }
  const clipped = new OpaqueRectCuller(2, 2);
  clipped.addRect(-100, 0, 101, 1, 1);
  clipped.addRect(0, 0, 200, 2, 0);
  clipped.cull();
  assert.deepEqual(paint(clipped, 2, 2), new Uint8Array([1, 0, 0, 0]));
});

test("bitmap guards include coverage/buckets and dispose releases all owned array bytes", () => {
  for (const size of [
    [0, 1],
    [1, -1],
    [1.5, 1],
    [NaN, 1],
    [Infinity, 1],
    [2049, 2048],
    [4194304, 1]
  ]) {
    assert.throws(() => new OpaqueRectCuller(...size), OpaqueRectUnsupportedError);
  }
  const culler = compare(808, 1848, [[0, 0, 1, 100, 1]]);
  assert.ok(culler.memoryBytes > 187456);
  culler.dispose();
  culler.dispose();
  assert.equal(culler.memoryBytes, 0);
  assert.equal(culler.commandCount, 0);
  assert.equal(culler.fragmentCount, 0);
  for (const action of [
    () => culler.begin(),
    () => culler.addRect(0, 0, 1, 1, 1),
    () => culler.cull(),
    () => culler.paint({ setStyle() {}, fillRect() {} })
  ]) {
    assert.throws(action, OpaqueRectUnsupportedError);
  }
});

function instrumentedCore(onAllocate, onFill = () => {}) {
  const tracked = (Base) =>
    class extends Base {
      constructor(length) {
        if (length > 0) onAllocate(length * Base.BYTES_PER_ELEMENT);
        super(length);
      }
      fill(...args) {
        onFill();
        return super.fill(...args);
      }
    };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      Int32Array: tracked(Int32Array),
      Uint8Array: tracked(Uint8Array),
      Uint32Array: tracked(Uint32Array)
    }
  );
  return exports;
}

test("command growth preserves records and reserves simultaneous old plus both new arrays", () => {
  const events = [];
  const { OpaqueRectCuller: Core } = instrumentedCore((bytes) => events.push(bytes));
  const culler = new Core(1, 1);
  culler.addRect(0, 0, 1, 1, 1);
  for (let index = 1; index < 32768; index++) culler.addRect(0, 0, 1, 1, 1);
  const before = culler.memoryBytes;
  events.length = 0;
  culler.addRect(0, 0, 1, 1, 255);
  assert.deepEqual(events, [65536 * 16, 65536]);
  assert.ok(before + events.reduce((a, b) => a + b, 0) <= LIMIT);
  culler.cull();
  assert.equal(culler.commandCount, 32769);
  assert.equal(paint(culler, 1, 1)[0], 255);
});

test("transient growth rejects before allocation even when replacement steady state would fit", () => {
  const events = [];
  const { OpaqueRectCuller: Core, OpaqueRectUnsupportedError: Unsupported } = instrumentedCore(
    (bytes) => events.push(bytes)
  );
  const culler = new Core(512, 512);
  for (let x = 0; x < 512; x += 64) culler.addRect(x, 0, 64, 512, 1);
  for (let y = 0; y < 512; y += 2) {
    for (let x = 0; x < 512; x += 64) culler.addRect(x, y, 64, 1, 2);
  }
  culler.cull();
  assert.equal(culler.fragmentCount, 512 * 512);
  culler.begin();
  for (let index = 0; index < 262144; index++) culler.addRect(0, 0, 1, 1, 1);
  const before = culler.memoryBytes;
  const newBytes = 524288 * 17;
  assert.ok(before - 262144 * 17 + newBytes < LIMIT, "Replacement-only accounting would pass");
  assert.ok(before + newBytes > LIMIT, "Old plus replacement arrays exceed budget");
  events.length = 0;
  assert.throws(() => culler.addRect(0, 0, 1, 1, 1), Unsupported);
  assert.deepEqual(events, [], "Reject before either replacement allocation");
  assert.equal(culler.memoryBytes, before);
  assert.equal(culler.fragmentCount, 0);
  assert.throws(() => culler.paint({ setStyle() {}, fillRect() {} }), Unsupported);
  culler.dispose();
  assert.equal(culler.memoryBytes, 0);
});

test("fragment explosion is bounded and leaves no paintable partial result", () => {
  const culler = new OpaqueRectCuller(1024, 1024);
  for (let x = 0; x < 1024; x += 64) culler.addRect(x, 0, 64, 1024, 1);
  for (let y = 0; y < 1024; y += 2) {
    for (let x = 0; x < 1024; x += 64) culler.addRect(x, y, 64, 1, 2);
  }
  assert.throws(() => culler.cull(), OpaqueRectUnsupportedError);
  assert.ok(culler.memoryBytes <= LIMIT);
  assert.equal(culler.fragmentCount, 0);
  let writes = 0;
  assert.throws(
    () =>
      culler.paint({
        setStyle() {
          writes++;
        },
        fillRect() {
          writes++;
        }
      }),
    OpaqueRectUnsupportedError
  );
  assert.equal(writes, 0);
  culler.begin();
  culler.addRect(4, 63, 1, 2, 255);
  culler.cull();
  assert.equal(culler.fragmentCount, 1);
});

test("allocation failure is a deliberate fallback and frame can recover after begin", () => {
  let rejectAllocation = false;
  const { OpaqueRectCuller: Core, OpaqueRectUnsupportedError: Unsupported } = instrumentedCore(
    () => {
      if (rejectAllocation) throw new RangeError("Simulated allocation failure");
    }
  );
  const culler = new Core(3, 3);
  rejectAllocation = true;
  assert.throws(() => culler.addRect(0, 0, 1, 1, 1), Unsupported);
  assert.throws(() => culler.cull(), Unsupported);
  rejectAllocation = false;
  culler.begin();
  culler.addRect(0, 0, 1, 1, 255);
  culler.cull();
  assert.equal(paint(culler, 3, 3)[0], 255);
});

test("lower full-height overlap remains exact and bounded even with tiny visible output", () => {
  const culler = new OpaqueRectCuller(1, 32768);
  for (let index = 0; index < 128; index++) {
    culler.addRect(0, 0, 1, 32768, index === 127 ? 255 : 1);
  }
  culler.cull();
  assert.equal(culler.commandCount, 128);
  assert.equal(culler.fragmentCount, 1);
  assert.deepEqual(paint(culler, 1, 32768), new Uint8Array(32768).fill(255));
});

test("overdraw work budget rejects before store, cull scans or target writes; begin resets it", () => {
  const allocations = [];
  let fills = 0;
  const { OpaqueRectCuller: Core, OpaqueRectUnsupportedError: Unsupported } = instrumentedCore(
    (bytes) => allocations.push(bytes),
    () => fills++
  );
  const culler = new Core(1, 32768);
  // 8192 commands * 1024 words exactly fills the 8 Mi column-word budget.
  for (let index = 0; index < 8192; index++) culler.addRect(0, 0, 1, 32768, 1);
  culler.addRect(0, 0, 1, 32768, 0);
  culler.addRect(1, 0, 1, 32768, 1);
  culler.addRect(0, 0, 0, 32768, 1);
  const bytes = culler.memoryBytes;
  allocations.length = 0;
  assert.throws(
    () => culler.addRect(0, 0, 1, 1, 1),
    (error) => {
      assert.ok(error instanceof Unsupported);
      return /work budget/.test(error.message);
    }
  );
  assert.equal(culler.commandCount, 8192, "The over-budget command must not be stored");
  assert.equal(culler.memoryBytes, bytes);
  assert.deepEqual(allocations, []);
  assert.equal(culler.fragmentCount, 0);
  assert.throws(() => culler.cull(), Unsupported);
  assert.equal(fills, 0, "A rejected recording must not start clearing/scanning coverage");
  assert.deepEqual(allocations, [], "A rejected frame must not allocate cull fragments");
  let writes = 0;
  assert.throws(
    () =>
      culler.paint({
        setStyle() {
          writes++;
        },
        fillRect() {
          writes++;
        }
      }),
    Unsupported
  );
  assert.equal(writes, 0);
  culler.begin();
  culler.addRect(0, 31, 1, 2, 255);
  culler.cull();
  assert.equal(culler.commandCount, 1);
  assert.equal(culler.fragmentCount, 1);
  assert.ok(fills > 0);
  assert.deepEqual(paint(culler, 1, 32768), reference(1, 32768, [[0, 31, 1, 2, 255]]));
});
