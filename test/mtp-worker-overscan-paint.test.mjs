import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const load = createSourceLoader();
const { MTP_WORKER_PROTOCOL, paintMtpWorkerFrame, paintMtpWorkerCapture } = load(
  "model/mtp-worker-protocol.js"
);
const { paintMtpWorkerEdges } = load("model/mtp-worker-edge-paint.js");

function recorder(options = {}) {
  const commands = [];
  const context = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args) => {
          if (name === "getImageData" && options.failRead) throw new Error("readback failed");
          commands.push([name, ...args]);
        },
      set: (_target, name, value) => {
        commands.push([name, value]);
        return true;
      }
    }
  );
  return { context, commands };
}

function fixture(overrides = {}) {
  const start = overrides.start ?? 100;
  const end = overrides.end ?? 3101;
  const captureStart = overrides.captureStart ?? 50;
  const captureEnd = overrides.captureEnd ?? 3150;
  const length = 3300;
  const prefix = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) prefix[i + 1] = prefix[i] + 20 + Math.sin(i / 11);
  const frame = {
    dataKey: "data",
    length,
    start,
    end,
    captureStart,
    captureEnd,
    sampleStep: Math.max(1, Math.ceil((end - start) / 3000)),
    x: Float64Array.from(
      { length: captureEnd - captureStart + 1 },
      (_, i) => (i + captureStart - start) * 0.25
    ),
    priceOrigin: 19,
    yOrigin: 300,
    ySlope: -20,
    styles: [
      { period: 7, color: "#123abc", width: 8, opacity: 0.3 },
      { period: 640, color: "#eeaaff", width: 2.5, opacity: 0.8 }
    ],
    width: 2400,
    height: 1200,
    padX: 264,
    padY: 25,
    horizontalRatio: 2.75,
    verticalRatio: 2.75,
    lineCap: "square",
    lineJoin: "miter",
    miterLimit: 17,
    shadowColor: "rgba(255, 0, 0, 0)",
    ...overrides
  };
  return { frame, prefix };
}

// Frozen pre-overscan traversal: offset and step are independently calculated.
function previousCore(context, frame, prefix) {
  context.save();
  context.setLineDash([]);
  context.strokeStyle = "#1e90ff";
  context.lineWidth = 1;
  for (const style of frame.styles) {
    context.strokeStyle = style.color;
    context.lineWidth = style.width;
    context.globalAlpha = style.opacity;
    context.beginPath();
    let begun = false;
    for (
      let i = Math.max(frame.start, style.period - 1);
      i <= frame.end;
      i += Math.max(1, Math.ceil((frame.end - frame.start) / 3000))
    ) {
      const value = (prefix[i + 1] - prefix[i + 1 - style.period]) / style.period;
      const x = frame.x[i - frame.captureStart];
      const y = frame.yOrigin + (value - frame.priceOrigin) * frame.ySlope;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        begun = false;
        continue;
      }
      if (begun) context.lineTo(x, y);
      else {
        context.moveTo(x, y);
        begun = true;
      }
    }
    context.stroke();
  }
  context.restore();
}

for (const span of [3000, 3001]) {
  test(`core commands remain exact at sampling span ${span}, fractional DPR and gaps`, () => {
    const { frame, prefix } = fixture({ start: 100, end: 100 + span });
    frame.x[130 - frame.captureStart] = NaN;
    frame.x[642 - frame.captureStart] = NaN;
    const actual = recorder(),
      expected = recorder();
    paintMtpWorkerFrame(actual.context, frame, prefix);
    previousCore(expected.context, frame, prefix);
    assert.deepEqual(actual.commands, expected.commands);
    assert.equal(actual.commands.filter(([op]) => op === "stroke").length, 2);
  });
  test(`expanded and compressed captures emit bitwise-identical core commands at span ${span}`, () => {
    const { frame, prefix } = fixture({ start: 100, end: 100 + span });
    // Real-market magnitudes exercise cancellation without changing the shared prefix.
    for (let index = 1; index < prefix.length; index++) prefix[index] *= 5100.123456789;
    frame.priceOrigin *= 5100.123456789;
    frame.ySlope /= 5100.123456789;
    const coreOnly = {
      ...frame,
      captureStart: frame.start,
      captureEnd: frame.end,
      x: frame.x.slice(frame.start - frame.captureStart, frame.end - frame.captureStart + 1)
    };
    const expanded = recorder(),
      compressed = recorder();
    paintMtpWorkerFrame(expanded.context, frame, prefix);
    paintMtpWorkerFrame(compressed.context, coreOnly, prefix);
    assert.deepEqual(expanded.commands, compressed.commands);
  });
}

test("expanded paths preserve each period's original phase, warmup and sampled gaps", () => {
  const { frame, prefix } = fixture({
    start: 701,
    end: 3202,
    captureStart: 600,
    captureEnd: 3250,
    sampleStep: 1
  });
  // Exercise a two-bar grid whose warmup anchor differs from the first period.
  frame.start = 101;
  frame.end = 3202;
  frame.captureStart = 50;
  frame.sampleStep = 2;
  frame.x = Float64Array.from(
    { length: frame.captureEnd - frame.captureStart + 1 },
    (_, i) => i + 50
  );
  frame.x[645 - frame.captureStart] = NaN;
  const { context, commands } = recorder();
  paintMtpWorkerCapture(context, frame, prefix);
  const paths = [];
  for (const command of commands) {
    if (command[0] === "beginPath") paths.push([]);
    if (command[0] === "moveTo" || command[0] === "lineTo") paths.at(-1).push(command);
  }
  assert.equal(paths[0][0][1], 51); // Core anchor 101, not captureStart 50.
  assert.equal(paths[1][0][1], 639); // Period 640 retains its own warmup/phase.
  assert.ok(paths[0].some(([op, x]) => op === "moveTo" && x === 647));
  assert.ok(paths[1].some(([op, x]) => op === "moveTo" && x === 647));
  for (const path of paths) for (const [, x] of path) assert.equal(x % 2, 1);
  assert.ok(paths.every((path) => path.at(-1)[1] <= frame.captureEnd));
});

test("edge clear and clip use integer physical strips, never the visible core", () => {
  const { frame, prefix } = fixture();
  const { context, commands } = recorder();
  paintMtpWorkerEdges(context, frame, prefix);
  assert.deepEqual(commands.slice(0, 10), [
    ["getImageData", 0, 0, 1, 1],
    ["save"],
    ["setTransform", 1, 0, 0, 1, 0, 0],
    ["clearRect", 0, 0, 264, 1200],
    ["clearRect", 2136, 0, 264, 1200],
    ["beginPath"],
    ["rect", 0, 0, 264, 1200],
    ["rect", 2136, 0, 264, 1200],
    ["clip"],
    ["setTransform", 2.75, 0, 0, 2.75, 264, 25]
  ]);
  for (const [, x, , width] of commands.filter(([op]) => op === "clearRect" || op === "rect")) {
    assert.ok(x + width <= frame.padX || x >= frame.width - frame.padX);
    assert.ok(Number.isInteger(x) && Number.isInteger(width));
  }
  assert.equal(commands.at(-1)[0], "restore");
});

test("no additional real bars or zero padding skips all edge commands", () => {
  for (const overrides of [{ captureStart: 100, captureEnd: 3101 }, { padX: 0 }]) {
    const { frame, prefix } = fixture(overrides);
    const { context, commands } = recorder();
    paintMtpWorkerEdges(context, frame, prefix);
    assert.deepEqual(commands, []);
  }
});

function workerHarness(options = {}) {
  const messages = [],
    canvases = [],
    allocations = [];
  const { context, commands } = recorder(options);
  class Canvas {
    constructor(width, height) {
      this.w = width;
      this.h = height;
      canvases.push(this);
    }
    set width(value) {
      this.w = value;
      this.check();
    }
    set height(value) {
      this.h = value;
      this.check();
    }
    check() {
      allocations.push([this.w, this.h]);
      assert.ok(this.w <= 4096 && this.h <= 4096 && this.w * this.h <= 4 * 1024 * 1024);
    }
    getContext() {
      return context;
    }
    transferToImageBitmap() {
      return {
        closed: 0,
        close() {
          this.closed++;
        }
      };
    }
  }
  const scope = {
    postMessage(message) {
      messages.push(message);
    },
    onmessage: null
  };
  const file = new URL("../src/model/mtp-raster-worker.ts", import.meta.url);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(
    `(function(require,exports,globalThis,OffscreenCanvas){${output}\n})`
  ).runInThisContext()(
    (specifier) =>
      specifier.includes("generated/")
        ? { BUILD_ID: "unit" }
        : load(`model/${specifier.split("/").at(-1)}`),
    {},
    scope,
    Canvas
  );
  const send = (data) => scope.onmessage({ data });
  send({ type: "hello", protocol: MTP_WORKER_PROTOCOL, build: "unit" });
  return { send, messages, canvases, allocations, commands };
}

test("protocol 2 Worker paints core first, then strips, on one bounded backing", () => {
  const worker = workerHarness();
  assert.equal(MTP_WORKER_PROTOCOL, 2);
  assert.equal(worker.messages[0].type, "ready");
  for (const [width, height] of [
    [1024, 4096],
    [4096, 1024]
  ]) {
    const { frame, prefix } = fixture({ width, height });
    worker.send({ type: "render", id: 1, key: "key", frame, prefix });
    assert.equal(worker.messages.at(-1).type, "result");
  }
  assert.equal(worker.canvases.length, 1);
  assert.ok(worker.allocations.some(([w, h]) => w === 0 && h === 4096));
  const firstClear = worker.commands.findIndex(([op]) => op === "clearRect");
  const firstFence = worker.commands.findIndex(([op]) => op === "getImageData");
  assert.ok(firstFence > 0 && firstFence < firstClear);
  assert.equal(worker.commands.slice(0, firstFence).filter(([op]) => op === "stroke").length, 2);
  assert.equal(worker.commands.slice(0, firstClear).filter(([op]) => op === "stroke").length, 2);
  assert.ok(worker.commands.some(([op, value]) => op === "lineCap" && value === "square"));
  assert.ok(worker.commands.some(([op, value]) => op === "miterLimit" && value === 17));
});

test("a failed core fence reaches the existing Worker failure boundary before any edge mutation", () => {
  const worker = workerHarness({ failRead: true });
  const { frame, prefix } = fixture();
  worker.send({ type: "render", id: 1, key: "key", frame, prefix });
  assert.equal(worker.messages.at(-1).type, "failure");
  assert.match(worker.messages.at(-1).reason, /readback failed/);
  assert.equal(
    worker.messages.some(({ type }) => type === "result"),
    false
  );
  assert.equal(
    worker.commands.some(([op]) => op === "clearRect" || op === "clip"),
    false
  );
  const coreOnly = workerHarness({ failRead: true });
  const core = fixture({ captureStart: 100, captureEnd: 3101 });
  coreOnly.send({ type: "render", id: 1, key: "core", frame: core.frame, prefix: core.prefix });
  assert.equal(coreOnly.messages.at(-1).type, "result", "no extra real bars means no fence");
});

test("malformed capture geometry is rejected before canvas allocation", () => {
  for (const overrides of [
    { captureStart: -1 },
    { captureEnd: 3300 },
    { sampleStep: 1 },
    { padX: 0.5 },
    { padY: -1 },
    { x: new Float64Array(1) },
    { horizontalRatio: NaN },
    { width: 4096, height: 4096 }
  ]) {
    const worker = workerHarness();
    const { frame, prefix } = fixture(overrides);
    worker.send({ type: "render", id: 1, key: "key", frame, prefix });
    assert.equal(worker.messages.at(-1).type, "failure");
    assert.equal(worker.canvases.length, 0);
  }
});
