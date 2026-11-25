import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nativeSource = readFileSync(
  join(dirname(require.resolve("klinecharts")), "index.esm.js"),
  "utf8"
);
const nativeCanvas = nativeSource.slice(
  nativeSource.indexOf("var Canvas = /** @class */"),
  nativeSource.indexOf("function createDefaultBounding")
);
assert.ok(nativeCanvas.includes("Canvas.prototype._executeListener"));
const helperSource = ts.transpileModule(
  readFileSync(new URL("../src/charts/kline-canvas-resize.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;

async function fixture({ ratio = 1 } = {}) {
  const frames = new Map(),
    observers = [],
    styleWrites = [],
    canvases = [];
  let frameId = 0,
    width = 85,
    draws = 0;
  const requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  const tick = () => {
    const batch = [...frames.values()];
    frames.clear();
    for (const callback of batch) callback();
  };
  class ResizeObserver {
    targets = [];
    sizes = new Map();
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      this.targets = [];
    }
    unobserve(target) {
      this.targets = this.targets.filter((item) => item !== target);
    }
  }
  const canvasDom = () => {
    const context = { clearRect() {}, scale() {} };
    return {
      width: 0,
      height: 0,
      style: {},
      get clientWidth() {
        return parseFloat(this.style.width) || 0;
      },
      get clientHeight() {
        return parseFloat(this.style.height) || 0;
      },
      getContext: () => context
    };
  };
  const context = vm.createContext({
    exports: {},
    window: { devicePixelRatio: ratio },
    DEFAULT_REQUEST_ID: -1,
    requestAnimationFrame,
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver,
    createDom: () => canvasDom(),
    getPixelRatio: () => ratio,
    isValid: (value) => value != null,
    isSupportedDevicePixelContentBox: async () => true
  });
  new vm.Script(nativeCanvas + helperSource).runInContext(context);
  const NativeCanvas = vm.runInContext("Canvas", context);
  for (const height of [420, 371]) {
    const canvas = new NativeCanvas({}, () => draws++);
    canvases.push(canvas);
    canvas.update(width, height);
  }
  tick();
  await Promise.resolve();
  const emit = () => {
    for (const observer of observers) {
      const changed = observer.targets.filter((target) => {
        const size = `${target.clientWidth}:${target.clientHeight}`;
        if (observer.sizes.get(target) === size) return false;
        observer.sizes.set(target, size);
        return true;
      });
      const entries = changed.map((target) => ({
        target,
        devicePixelContentBoxSize: [
          {
            inlineSize: Math.round(target.clientWidth * ratio),
            blockSize: Math.round(target.clientHeight * ratio)
          }
        ]
      }));
      if (entries.length) observer.callback(entries);
    }
  };
  const chart = {
    getDom: () => ({ querySelectorAll: () => canvases.map((canvas) => canvas.getElement()) }),
    setStyles: (styles) => {
      styleWrites.push(styles.yAxis.size);
      for (const canvas of canvases)
        canvas.update(styles.yAxis.size, canvas.getElement().clientHeight);
      emit();
    }
  };
  const attach = () => context.exports.attachKlineCanvasResize(chart, () => width);
  const settled = () => {
    for (let index = 0; frames.size && index < 20; index++) tick();
    assert.equal(frames.size, 0, "resize recovery must settle");
  };
  return {
    canvases,
    observers,
    frames,
    styleWrites,
    attach,
    tick,
    emit,
    settled,
    width: (value) => (width = value),
    draws: () => draws,
    addCanvas(height) {
      const canvas = new NativeCanvas({}, () => draws++);
      canvases.push(canvas);
      canvas.update(width, height);
      return canvas;
    },
    race() {
      // Queue an ordinary redraw first. The actual installed Canvas drops the
      // subsequent RO pixel-resize callback while this redraw is pending.
      for (const canvas of canvases) canvas.update(width, canvas.getElement().clientHeight);
      for (const [index, canvas] of canvases.entries()) canvas.update(width, [516, 275][index]);
      emit();
      tick();
    }
  };
}

test("installed KLine Canvas loses pixel resize during pending redraw; public recovery fixes both panes", async () => {
  const f = await fixture();
  f.race();
  assert.deepEqual(
    f.canvases.map((canvas) => canvas.getElement().height),
    [420, 371]
  );
  assert.deepEqual(
    f.canvases.map((canvas) => canvas.getElement().clientHeight),
    [516, 275]
  );
  const count = f.draws();
  for (const canvas of f.canvases) canvas.update(85, canvas.getElement().clientHeight);
  f.settled();
  assert.equal(f.draws(), count, "unchanged native resize cannot repair this race");
  const dispose = f.attach();
  f.emit();
  f.settled();
  assert.deepEqual(f.styleWrites, [86, 85]);
  assert.deepEqual(
    f.canvases.map((canvas) => canvas.getElement().height),
    [516, 275]
  );
  assert.ok(f.draws() > count);
  f.emit();
  f.settled();
  assert.deepEqual(f.styleWrites, [86, 85], "healthy buffers must not trigger repeated nudges");
  dispose();
});

test("healthy HiDPI buffers and transient native resizing need no recovery", async () => {
  const f = await fixture({ ratio: 2 });
  const dispose = f.attach();
  f.emit();
  f.settled();
  assert.deepEqual(f.styleWrites, []);
  assert.deepEqual(
    f.canvases.map((canvas) => canvas.getElement().height),
    [840, 742]
  );
  // A genuine resize without an already pending native redraw finishes naturally.
  for (const canvas of f.canvases) canvas.update(85, 600);
  f.emit();
  f.settled();
  assert.deepEqual(f.styleWrites, []);
  assert.deepEqual(
    f.canvases.map((canvas) => canvas.getElement().height),
    [1200, 1200]
  );
  dispose();
});

test("recovery restores the current responsive width and cancels all work on destroy", async () => {
  const f = await fixture();
  f.race();
  const dispose = f.attach();
  f.emit();
  f.tick();
  f.tick();
  assert.deepEqual(f.styleWrites, [86]);
  f.width(70);
  f.settled();
  assert.deepEqual(f.styleWrites, [86, 70]);
  dispose();
  f.emit();
  assert.equal(f.frames.size, 0);

  const retiring = await fixture();
  retiring.race();
  const cancel = retiring.attach();
  retiring.emit();
  cancel();
  retiring.settled();
  assert.deepEqual(retiring.styleWrites, []);
});

test("new technical panes join recovery and removed canvases release observers", async () => {
  const f = await fixture(),
    dispose = f.attach(),
    recoveryObserver = f.observers.at(-1);
  const added = f.addCanvas(200);
  f.settled();
  await Promise.resolve();
  dispose.refresh();
  added.update(85, 200);
  added.update(85, 300);
  f.emit();
  f.tick();
  assert.equal(added.getElement().height, 200);
  f.settled();
  assert.equal(added.getElement().height, 300);
  const removed = f.canvases.splice(0, 1)[0].getElement();
  dispose.refresh();
  assert.ok(!recoveryObserver.targets.includes(removed));
  dispose();
  assert.equal(recoveryObserver.targets.length, 0);
});
