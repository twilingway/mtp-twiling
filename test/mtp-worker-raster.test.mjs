import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
function load(relative) {
  const file = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
  assert.ok(file.startsWith(sourceRoot));
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const source =
    relative.replaceAll("\\", "/") === "generated/app-version.js"
      ? 'export const BUILD_ID = "unit";'
      : readFileSync(file, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${code}\n})`, {
    filename: file
  }).runInThisContext()(
    (specifier) => load(path.relative(sourceRoot, path.resolve(path.dirname(file), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const { MtpModel, MTP_COMBINED_PERIODS } = load("model/mtp.js");
const { MtpWorkerRasterCache } = load("model/mtp-worker-raster-cache.js");
const { mtpWorkerIntent } = load("model/mtp-worker-snapshot.js");
const { paintMtpWorkerFrame, MTP_WORKER_PROTOCOL } = load("model/mtp-worker-protocol.js");
const { MtpWorkerRefill } = load("model/mtp-worker-refill.js");
const { MTP_EMERGENCY_VERTEX_LIMIT } = load("model/mtp-worker-emergency.js");
const { mtpWorkerBuffer } = load("model/mtp-worker-buffer.js");
const { mtpWorkerGeometry, mtpWorkerContentKey, mtpWorkerPreview } = load(
  "model/mtp-worker-geometry.js"
);

function rasterCacheFor(search = "?mtpRaster=worker", enabled = true) {
  const code = ts.transpileModule(
    readFileSync(new URL("../src/model/mtp-raster-cache.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
    }
  ).outputText;
  const module = { exports: {} };
  new vm.Script(
    `(function(require,module,exports,__MTP_RASTER_DEV__,location){${code}\n})`
  ).runInThisContext()(
    (specifier) => load(path.relative(sourceRoot, path.resolve(sourceRoot, "model", specifier))),
    module,
    module.exports,
    enabled,
    { search }
  );
  return module.exports.MtpRasterCache;
}

function activationEnvironment() {
  const workers = [],
    timers = new Map();
  let loads = 0,
    serial = 0;
  const environment = {
    canvas: () => null,
    delay(action, milliseconds) {
      const id = serial++;
      timers.set(id, { action, milliseconds });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    async loadWorker() {
      loads++;
      return { MtpWorkerRasterCache: OwnedClient };
    }
  };
  class OwnedClient extends MtpWorkerRasterCache {
    constructor(update) {
      super(update, {
        build: "unit",
        delay: environment.delay,
        cancel: environment.cancel,
        create() {
          const worker = {
            onmessage: null,
            onerror: null,
            onmessageerror: null,
            terminated: 0,
            messages: [],
            postMessage(message, transfer = []) {
              this.messages.push(structuredClone(message, { transfer }));
            },
            terminate() {
              this.terminated++;
            }
          };
          workers.push(worker);
          return worker;
        }
      });
    }
  }
  return { environment, workers, timers, loads: () => loads };
}

test("default auto creates one owned worker lazily on the first supported heavy LW draw", async () => {
  const Cache = rasterCacheFor(""),
    f = activationEnvironment(),
    { frame } = lightweightFrame();
  const cache = new Cache(() => {}, undefined, f.environment);
  assert.equal(f.loads(), 0);
  assert.equal(f.workers.length, 0);
  assert.equal(cache.pending(), false);
  assert.equal(cache.draw(frame), true, "heavy native paint is suppressed while worker starts");
  assert.equal(cache.pending(), true);
  cache.draw(frame);
  await new Promise((done) => setImmediate(done));
  assert.equal(f.loads(), 1);
  assert.equal(f.workers.length, 1);
  const worker = f.workers[0];
  assert.equal(worker.messages[0].type, "hello");
  worker.onmessage({ data: { type: "ready", protocol: MTP_WORKER_PROTOCOL, build: "unit" } });
  cache.draw(frame);
  cache.draw(frame);
  assert.equal(worker.messages.filter((message) => message.type === "render").length, 1);
  cache.draw({ ...frame, to: 5 });
  assert.equal(f.loads(), 1);
  assert.equal(f.workers.length, 1, "zooming light keeps the already-owned worker");
  cache.destroy();
  assert.equal(worker.terminated, 1);
  assert.equal(f.timers.size, 0);
});

test("default auto leaves disabled, empty, light and unsupported frames native without loading a worker", async () => {
  const Cache = rasterCacheFor("?unrelated=1");
  for (const change of [
    (frame) => {
      frame.model.periods = [];
    },
    (frame) => {
      frame.model.reset([], frame.model.periods);
    },
    (frame) => {
      frame.model.periods = MTP_COMBINED_PERIODS.slice(0, 29);
    },
    (frame) => {
      frame.from = 0;
      frame.to = 5;
    },
    (frame) => {
      frame.model.reset(frame.model.data.slice(0, 5), frame.model.periods);
    },
    (frame) => {
      frame.mode = 1;
    },
    (frame) => {
      frame.mode = undefined;
    },
    (frame) => {
      delete frame.uniformX;
    },
    (frame) => {
      frame.scope.bitmapSize = { width: 4097, height: 100 };
    },
    (frame) => {
      frame.scope.bitmapSize = { width: 4096, height: 4096 };
    },
    (frame) => {
      frame.scope.verticalPixelRatio = 0;
    },
    (frame) => {
      frame.scope.context.filter = "blur(1px)";
    }
  ]) {
    const f = activationEnvironment(),
      { frame } = lightweightFrame();
    change(frame);
    const cache = new Cache(() => {}, undefined, f.environment);
    assert.equal(cache.draw(frame), false);
    assert.equal(cache.pending(), false);
    await new Promise((done) => setImmediate(done));
    assert.equal(f.loads(), 0);
    assert.equal(f.workers.length, 0);
    assert.equal(cache.workerStatus().state, "off");
    cache.destroy();
  }
});

test("native opt-out and disabled build never activate; explicit worker preserves eager loading", async () => {
  for (const [search, enabled] of [
    ["?mtpRaster=native", true],
    ["", false]
  ]) {
    const Cache = rasterCacheFor(search, enabled),
      f = activationEnvironment(),
      { frame } = lightweightFrame();
    const cache = new Cache(() => {}, undefined, f.environment);
    assert.equal(cache.draw(frame), false);
    assert.equal(cache.pending(), false);
    await new Promise((done) => setImmediate(done));
    assert.equal(f.loads(), 0);
    assert.equal(f.workers.length, 0);
    cache.destroy();
  }
  const Cache = rasterCacheFor("?mtpRaster=worker"),
    f = activationEnvironment();
  const cache = new Cache(() => {}, undefined, f.environment);
  assert.equal(cache.pending(), true);
  await new Promise((done) => setImmediate(done));
  assert.equal(f.loads(), 1);
  assert.equal(f.workers.length, 1, "force mode retains its pre-existing no-draw startup behavior");
  cache.destroy();
  assert.equal(f.workers[0].terminated, 1);
});

test("default cache instances own independent lazy workers and cancellation", async () => {
  const Cache = rasterCacheFor(""),
    f = activationEnvironment();
  const a = new Cache(() => {}, undefined, f.environment),
    b = new Cache(() => {}, undefined, f.environment);
  a.draw(lightweightFrame().frame);
  b.draw(lightweightFrame().frame);
  await new Promise((done) => setImmediate(done));
  assert.equal(f.loads(), 2);
  assert.equal(f.workers.length, 2);
  a.destroy();
  assert.equal(f.workers[0].terminated, 1);
  assert.equal(f.workers[1].terminated, 0);
  assert.equal(b.pending(), true);
  b.destroy();
  assert.equal(f.workers[1].terminated, 1);
  assert.equal(f.timers.size, 0);
});

function context() {
  const commands = [],
    blits = [],
    blitStates = [],
    transforms = [],
    clips = [];
  return {
    commands,
    blits,
    blitStates,
    transforms,
    clips,
    globalCompositeOperation: "source-over",
    filter: "none",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    lineCap: "round",
    lineJoin: "bevel",
    miterLimit: 7,
    save() {
      commands.push(["save"]);
    },
    restore() {
      commands.push(["restore"]);
    },
    setLineDash(dash) {
      commands.push(["dash", ...dash]);
    },
    beginPath() {
      commands.push(["begin", this.strokeStyle, this.lineWidth, this.globalAlpha]);
    },
    moveTo(x, y) {
      commands.push(["move", x, y]);
    },
    lineTo(x, y) {
      commands.push(["line", x, y]);
    },
    stroke() {
      commands.push(["stroke"]);
    },
    drawImage(...args) {
      blits.push(args);
      blitStates.push({ shadowColor: this.shadowColor, alpha: this.globalAlpha });
    },
    translate(...values) {
      transforms.push(["translate", ...values]);
    },
    scale(...values) {
      transforms.push(["scale", ...values]);
    },
    rect(...values) {
      clips.push(values);
    },
    clip() {}
  };
}
function frameWith(length = 1000, periods = [4, 6, 49, 160, 446, 640]) {
  const model = new MtpModel();
  model.reset(
    Array.from({ length }, (_, i) => ({
      timestamp: i * 3600000,
      close: 100 + i / 500 + Math.sin(i / 17) * 20
    })),
    periods
  );
  model.styles = {
    mtp160: { color: "#123456", width: 2.75, opacity: 0.43 },
    mtp440: { color: "#654321", width: 1.25, opacity: 0 },
    mtp640: { color: "#ff00cc", width: 4, opacity: 1 }
  };
  const ctx = context();
  return {
    scope: {
      context: ctx,
      bitmapSize: { width: 250, height: 170 },
      horizontalPixelRatio: 1.25,
      verticalPixelRatio: 1.7
    },
    model,
    from: 0,
    to: length - 1,
    mode: 0,
    xFor: (i) => i * 0.15 - 7.25,
    yFor: (price) => 120 + (price - 80) * -1.25,
    paint() {
      assert.fail("Worker must not invoke native paint");
    }
  };
}
function bitmap() {
  return {
    closed: 0,
    close() {
      this.closed++;
      assert.equal(this.closed, 1, "bitmap closes exactly once");
    }
  };
}
function baselineProjection(frame) {
  // The existing LW adapter uses these same domain anchors before MtpModel.draw.
  const domain = frame.model.extrema(Math.floor(frame.from) - 1, Math.ceil(frame.to) + 1);
  const low = domain.minValue,
    high = domain.maxValue;
  const lowY = frame.yFor(low),
    highY = frame.yFor(high);
  const slope = (highY - lowY) / (high - low);
  return (price) => (price === null ? null : lowY + (price - low) * slope);
}
function sameCommands(actual, expected) {
  assert.equal(actual.length, expected.length, "command count");
  for (let i = 0; i < actual.length; i++) assert.deepEqual(actual[i], expected[i], `command ${i}`);
}
function fixture(options = {}) {
  const messages = [],
    timers = new Map();
  let timerId = 0,
    updates = 0;
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: 0,
    postMessage(message, transfer = []) {
      messages.push(structuredClone(message, { transfer }));
    },
    terminate() {
      this.terminated++;
    }
  };
  const environment = {
    build: "unit",
    create: () => worker,
    delay(action, milliseconds) {
      timers.set(++timerId, { action, milliseconds });
      return timerId;
    },
    cancel(id) {
      timers.delete(id);
    }
  };
  if (options.now) environment.now = options.now;
  const cache = new MtpWorkerRasterCache(() => updates++, environment);
  const send = (data) => worker.onmessage?.({ data });
  const ready = () => send({ type: "ready", protocol: MTP_WORKER_PROTOCOL, build: "unit" });
  const result = (request = messages.at(-1), image = bitmap()) => {
    send({ type: "result", id: request.id, key: request.key, bitmap: image });
    return image;
  };
  return {
    cache,
    worker,
    messages,
    timers,
    environment,
    send,
    ready,
    result,
    updates: () => updates
  };
}

function partialFrame(width = 1000, height = 400, ratio = 1) {
  const f = lightweightFrame();
  const { frame, reads } = f;
  let from = 5000;
  const span = 424;
  frame.scope.bitmapSize = { width: Math.round(width * ratio), height: Math.round(height * ratio) };
  frame.scope.horizontalPixelRatio = frame.scope.verticalPixelRatio = ratio;
  frame.scope.context.miterLimit = 1;
  frame.model.styles = {};
  frame.xFor = (index) => {
    reads.x++;
    return ((index - from) * width) / span;
  };
  frame.yFor = (price) => {
    reads.y++;
    return 200 - (price - 100) * 3;
  };
  const camera = (delta) => {
    from = 5000 - delta;
    frame.from = from;
    frame.to = from + span;
  };
  camera(0);
  return { frame, reads, camera };
}

function lightweightFrame(length = 5425) {
  const frame = frameWith(length, MTP_COMBINED_PERIODS);
  frame.uniformX = "lightweight";
  const reads = { x: 0, y: 0, extrema: 0, prefix: 0 };
  const spacing = 180 / (length - 1);
  let dx = 0,
    dy = 0;
  frame.xFor = (index) => {
    reads.x++;
    return 10 + index * spacing + dx;
  };
  frame.yFor = (price) => {
    reads.y++;
    return (140 - price) * 0.6 + dy;
  };
  const extrema = frame.model.extrema.bind(frame.model);
  frame.model.extrema = (...args) => {
    reads.extrema++;
    return extrema(...args);
  };
  frame.model.prefix.subarray = function (...args) {
    reads.prefix++;
    return Float64Array.prototype.subarray.apply(this, args);
  };
  return {
    frame,
    reads,
    camera(x, y = 0) {
      dx = x;
      dy = y;
      frame.from = -x / spacing;
      frame.to = length - 1 - x / spacing;
    }
  };
}

test("real horizontal capture preserves core and exact dense native X within adaptive surface caps", () => {
  const { frame } = partialFrame();
  const intent = mtpWorkerIntent(frame),
    captured = intent.frame;
  assert.equal(captured.start, 4999);
  assert.equal(captured.end, 5424);
  assert.ok(captured.captureStart < captured.start);
  assert.equal(captured.captureEnd, 5424, "no invented future bars");
  assert.equal(captured.sampleStep, 1);
  assert.equal(captured.padX, 500, "each side targets half this actual plot width");
  assert.equal(captured.x.length, captured.captureEnd - captured.captureStart + 1);
  for (let index = captured.captureStart; index <= captured.captureEnd; index++)
    assert.equal(captured.x[index - captured.captureStart], frame.xFor(index));
  assert.equal(frame.model.prefix.byteLength > 0, true, "model prefix remains attached");
  const exact = context(),
    native = context();
  paintMtpWorkerFrame(exact, captured, frame.model.prefix);
  frame.model.draw(native, frame.from, frame.to, frame.xFor, baselineProjection(frame));
  sameCommands(exact.commands, native.commands);
  const generic = mtpWorkerIntent({ ...frame, uniformX: undefined }).frame;
  assert.equal(
    generic.captureStart,
    generic.start,
    "arbitrary callbacks never imply extra X geometry"
  );
  assert.equal(generic.captureEnd, generic.end);
  for (const [width, height, ratio] of [
    [1000, 400, 1],
    [2700, 1400, 2.75],
    [4096, 1024, 3],
    [1024, 4096, 1]
  ]) {
    const allocation = mtpWorkerBuffer(width, height, ratio);
    assert.ok(allocation.width <= 4096 && allocation.height <= 4096);
    assert.ok(allocation.width * allocation.height <= 4 * 1024 * 1024);
    assert.equal(allocation.width - allocation.padX * 2, width);
    assert.equal(allocation.height - allocation.padY * 2, height);
    assert.ok(allocation.padX <= Math.ceil(Math.max(96 * ratio, width / 2)));
  }
  assert.equal(mtpWorkerBuffer(4096, 1024, 3).padX, 0);
});

test("reserve follows each actual plot, from phone and six small panes to wide desktop, within unchanged caps", () => {
  for (const [width, height, ratio, expectedPad] of [
    [144, 300, 1, 96],
    [268, 700, 1, 134],
    [737, 1800, 2.75, 369], // Actual 268 CSS px phone plot at fractional DPR.
    [400, 400, 1, 200], // A small pane independently gets its own half-width.
    [431, 720, 1, 216], // Actual six-pane geometry reported from the user's browser.
    [1294, 1213, 1, 647], // Representative single-pane geometry, within the same 4 Mi-pixel cap.
    [1230, 1150, 1, 615], // Estimated single-pane MTP plot after axes/header space.
    [1800, 900, 1, 900],
    [2400, 900, 1, 848], // 4096px side cap.
    [2400, 1600, 1, 110], // 4 Mi-pixel area cap.
    [3600, 1000, 2, 248], // Actual 1800 CSS px plot, reduced to 124 CSS px per side.
    [4096, 1024, 1, 0]
  ]) {
    const buffer = mtpWorkerBuffer(width, height, ratio);
    assert.equal(buffer.padX, expectedPad, `${width} physical px at DPR ${ratio}`);
    assert.equal(buffer.width - 2 * buffer.padX, width);
    assert.equal(buffer.height - 2 * buffer.padY, height);
    assert.ok(buffer.width <= 4096 && buffer.height <= 4096);
    assert.ok(buffer.width * buffer.height <= 4 * 1024 * 1024);
  }
});

test("prefetch uses half the achieved reserve for phone, wide and budget-clamped actual plots", () => {
  for (const [width, height, ratio] of [
    [268, 400, 2.75],
    [1800, 900, 1],
    [2400, 1600, 1]
  ]) {
    const { frame, camera } = partialFrame(width, height, ratio);
    camera(2700);
    const intent = mtpWorkerIntent(frame);
    const geometry = mtpWorkerGeometry(
      frame,
      intent,
      mtpWorkerContentKey(frame),
      mtpWorkerContentKey(frame, true)
    );
    const actualReserve = intent.frame.padX / ratio;
    assert.ok(
      actualReserve > 96,
      "this scene exercises an achieved reserve above the old fixed minimum"
    );
    for (const direction of [-1, 1]) {
      camera(2700 + (direction * actualReserve * 0.49 * 424) / width);
      assert.equal(mtpWorkerPreview(frame, geometry).refill, false);
      camera(2700 + (direction * actualReserve * 0.51 * 424) / width);
      const plan = mtpWorkerPreview(frame, geometry);
      assert.equal(plan.covered, true);
      assert.equal(plan.uncovered, false);
      assert.equal(plan.refill, true, "start before falling to the old fixed 48px remainder");
    }
  }
});

test("half-reserve prefetch runs before any missing edge and stays cheap, bounded and idle-exact", () => {
  let clock = 0;
  const f = fixture({ now: () => clock }),
    { frame, camera, reads } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  const origin = mtpWorkerIntent(frame);
  const geometry = mtpWorkerGeometry(
    frame,
    origin,
    mtpWorkerContentKey(frame),
    mtpWorkerContentKey(frame, true)
  );
  const paints = f.cache.status().emergency.paints;
  camera(100); // 236px, with more than half the 500px actual reserve remaining.
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().dispatched, 1);
  camera(108); // 255px: refill with 245px still available, well before the old 48px threshold.
  const plan = mtpWorkerPreview(frame, geometry);
  assert.equal(plan.covered, true);
  assert.equal(plan.refill, true);
  assert.equal(plan.uncovered, false);
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().dispatched, 2);
  assert.equal(f.cache.status().emergency.paints, paints);
  const scan = { ...reads },
    snapshot = f.cache.status().snapshots;
  for (let i = 0; i < 60; i++) {
    clock++;
    camera(108 + i / 100);
    f.cache.draw(frame, true);
  }
  assert.equal(reads.extrema, scan.extrema);
  assert.equal(reads.prefix, scan.prefix);
  assert.equal(f.cache.status().snapshots, snapshot);
  assert.equal(f.cache.status().dispatched, 2);
  const beforeReceive = { ...reads };
  f.result();
  assert.deepEqual(reads, beforeReceive, "response never projects or captures a new frame");
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().dispatched, 2, "new reserve prevents an identical refill loop");
  assert.equal(f.cache.pending(), true);
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  assert.equal(f.timers.size, 0);
  f.cache.destroy();
});

test("even a one-pixel uncovered edge uses full coarse instead of a nearly complete bitmap", () => {
  const f = fixture({ now: () => 0 }),
    { frame, camera } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  const origin = mtpWorkerIntent(frame);
  const geometry = mtpWorkerGeometry(
    frame,
    origin,
    mtpWorkerContentKey(frame),
    mtpWorkerContentKey(frame, true)
  );
  camera((501 * 424) / 1000); // 500px actual reserve plus precisely one uncovered CSS pixel.
  const plan = mtpWorkerPreview(frame, geometry);
  assert.equal(plan.uncovered, true);
  assert.ok(plan.clip.x >= 0.999 && plan.clip.x <= 1.001);
  assert.ok(plan.clip.width > 998);
  const blits = frame.scope.context.blits.length,
    paints = f.cache.status().emergency.paints;
  f.cache.draw(frame, true);
  assert.equal(frame.scope.context.blits.length, blits, "no partial/coarse double alpha");
  assert.equal(f.cache.status().emergency.paints, paints + 1);
  f.cache.destroy();
});

test("history boundaries and zero reserve never prefetch a covered stationary view", () => {
  for (const zero of [false, true]) {
    const { frame } = partialFrame();
    if (zero) frame.scope.bitmapSize = { width: 4096, height: 1024 };
    const intent = mtpWorkerIntent(frame);
    const geometry = mtpWorkerGeometry(
      frame,
      intent,
      mtpWorkerContentKey(frame),
      mtpWorkerContentKey(frame, true)
    );
    const plan = mtpWorkerPreview(frame, geometry);
    assert.equal(plan.covered, true);
    assert.equal(plan.refill, false);
    if (zero) assert.equal(intent.frame.padX, 0);
  }
});

test("both loaded-history sides prefetch at half their available reserve, before coverage loss", () => {
  const { frame, camera } = partialFrame();
  camera(2700); // Both sides have real, not-yet-captured history.
  const intent = mtpWorkerIntent(frame);
  const geometry = mtpWorkerGeometry(
    frame,
    intent,
    mtpWorkerContentKey(frame),
    mtpWorkerContentKey(frame, true)
  );
  assert.equal(geometry.historyLeft, false);
  assert.equal(geometry.historyRight, false);
  for (const direction of [-1, 1]) {
    camera(2700 + direction * 100);
    assert.equal(mtpWorkerPreview(frame, geometry).refill, false);
    camera(2700 + direction * 108);
    const plan = mtpWorkerPreview(frame, geometry);
    assert.equal(plan.covered, true);
    assert.equal(plan.refill, true);
    assert.equal(plan.uncovered, false);
  }
});

test("unchanged ready and in-flight draws serialize metadata once; held tail guard alone may serialize twice", () => {
  const countSerializations = (action) => {
    const stringify = JSON.stringify;
    let count = 0;
    JSON.stringify = function (...args) {
      count++;
      return stringify.apply(this, args);
    };
    try {
      action();
      return count;
    } finally {
      JSON.stringify = stringify;
    }
  };
  const f = fixture(),
    { frame } = lightweightFrame();
  f.ready();
  f.cache.draw(frame);
  assert.equal(
    countSerializations(() => f.cache.draw(frame)),
    1,
    "unchanged in-flight geometry reuses its hard key"
  );
  f.result();
  assert.equal(
    countSerializations(() => f.cache.draw(frame)),
    1,
    "unchanged ready geometry reuses its hard key"
  );
  frame.model.data.at(-1).close += 3;
  frame.model.update(frame.model.data);
  f.cache.invalidate(true);
  const before = f.cache.status().snapshots;
  assert.equal(
    countSerializations(() => f.cache.draw(frame, true)),
    2,
    "actual held stale-ready checks its separate hard key"
  );
  assert.equal(f.cache.status().snapshots, before);
  assert.equal(f.cache.status().dispatched, 1);
  f.cache.destroy();
});

test("60 held LW draws follow a covered full-history bitmap with no snapshots or dispatch until idle", () => {
  const f = fixture(),
    { frame, reads, camera } = lightweightFrame();
  f.ready();
  f.cache.draw(frame);
  const image = f.result();
  f.cache.draw(frame);
  const before = { ...f.cache.status() },
    oldReads = { ...reads },
    oldBlits = frame.scope.context.blits.length;
  f.cache.setInteraction(true);
  for (let i = 1; i <= 60; i++) {
    camera(i / 10, i / 20);
    f.cache.draw(frame, true);
  }
  assert.equal(f.cache.status().snapshots, before.snapshots);
  assert.equal(f.cache.status().dispatched, before.dispatched);
  assert.equal(reads.extrema, oldReads.extrema);
  assert.equal(reads.prefix, oldReads.prefix);
  assert.ok(reads.x - oldReads.x <= 60 * 3);
  assert.ok(reads.y - oldReads.y <= 60 * 3);
  assert.equal(
    frame.scope.context.blits.length - oldBlits,
    60,
    "the complete fan stays visible during a covered gesture"
  );
  assert.equal(image.closed, 0);
  assert.equal(f.cache.pending(), true, "preview does not complete exact readiness");
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  assert.equal(f.cache.status().snapshots, before.snapshots + 1);
  assert.equal(f.cache.status().dispatched, before.dispatched + 1);
  const request = f.messages.at(-1);
  assert.equal(
    request.key,
    mtpWorkerIntent(frame).key,
    "settled work uses the final exact range/X array"
  );
  f.result(request);
  assert.equal(f.cache.pending(), true);
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  assert.equal(image.closed, 1);
  f.cache.destroy();
});

test("unchanged LW redraws reuse exact ready and in-flight keys without history scans", () => {
  const f = fixture(),
    { frame, reads } = lightweightFrame();
  f.ready();
  f.cache.draw(frame);
  const before = { ...reads };
  for (let i = 0; i < 60; i++) f.cache.draw(frame);
  assert.equal(f.cache.status().snapshots, 1);
  assert.equal(f.cache.status().dispatched, 1);
  assert.equal(reads.extrema, before.extrema);
  assert.equal(reads.prefix, before.prefix);
  assert.ok(
    reads.x - before.x <= 60 * (MTP_EMERGENCY_VERTEX_LIMIT + 3),
    "warmup phases may use different X samples, but even no-bitmap work has a fixed total budget"
  );
  f.result();
  f.cache.draw(frame);
  const readyReads = { ...reads };
  const readyEmergency = f.cache.status().emergency.paints;
  for (let i = 0; i < 60; i++) f.cache.draw(frame);
  assert.equal(f.cache.status().snapshots, 1);
  assert.equal(f.cache.status().dispatched, 1);
  assert.equal(reads.extrema, readyReads.extrema);
  assert.equal(reads.prefix, readyReads.prefix);
  assert.ok(reads.x - readyReads.x <= 60 * 3);
  assert.equal(
    f.cache.status().emergency.paints,
    readyEmergency,
    "ready coverage never invokes main emergency paint"
  );
  assert.equal(f.cache.pending(), false);
  f.cache.destroy();
});

test("a jump beyond one captured viewport paints bounded current-data MA until exact worker pixels arrive", () => {
  let clock = 0;
  const f = fixture({ now: () => clock }),
    { frame, camera, reads } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  const a = f.result();
  f.cache.draw(frame);
  const baseline = { ...f.cache.status().emergency },
    blits = frame.scope.context.blits.length;
  camera(600);
  f.cache.draw(frame, true);
  const job = f.messages.at(-1),
    sampled = f.cache.status().emergency;
  assert.equal(sampled.paints, baseline.paints + 1);
  assert.ok(sampled.lastVertices > 0 && sampled.lastVertices <= MTP_EMERGENCY_VERTEX_LIMIT);
  assert.equal(
    frame.scope.context.blits.length,
    blits,
    "the non-overlapping old raster is not faked into the new view"
  );
  assert.equal(a.closed, 0);
  assert.equal(f.cache.pending(), true);
  const busyReads = { ...reads },
    busySnapshots = f.cache.status().snapshots;
  clock = 10;
  camera(605);
  for (let i = 0; i < 20; i++) f.cache.draw(frame, true);
  assert.equal(f.cache.status().emergency.paints, sampled.paints + 20);
  assert.equal(reads.prefix, busyReads.prefix);
  assert.equal(reads.extrema, busyReads.extrema);
  assert.equal(f.cache.status().snapshots, busySnapshots);
  assert.equal(f.cache.status().dispatched, 2);
  assert.equal(f.cache.pending(), true, "coarse real points never complete exact readiness");
  f.result(job);
  const beforeBitmap = f.cache.status().emergency.paints;
  f.cache.draw(frame, true);
  assert.equal(
    f.cache.status().emergency.paints,
    beforeBitmap,
    "a safe partial worker bitmap takes priority over coarse main paint"
  );
  assert.equal(frame.scope.context.blits.length, blits + 1);
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  f.cache.destroy();
});

test("covered bitmap stays native while an uncovered clip uses full real coarse without double alpha", () => {
  const f = fixture({ now: () => 0 }),
    { frame, camera } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  const emergency = f.cache.status().emergency.paints;
  const origin = mtpWorkerIntent(frame);
  const geometry = mtpWorkerGeometry(
    frame,
    origin,
    mtpWorkerContentKey(frame),
    mtpWorkerContentKey(frame, true)
  );
  camera(0);
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().emergency.paints, emergency);
  camera(634);
  const plan = mtpWorkerPreview(frame, geometry);
  assert.ok(
    plan.clip.width > 0 && plan.clip.width < 10,
    "the boundary has a real but tiny safe clip"
  );
  const blits = frame.scope.context.blits.length;
  f.cache.draw(frame, true);
  assert.equal(frame.scope.context.blits.length, blits);
  assert.equal(
    f.cache.status().emergency.paints,
    emergency + 1,
    "coarse replaces a mostly-missing bitmap; it is never painted underneath that partial bitmap"
  );
  f.cache.destroy();
});

test("rejected coarse keeps a valid partial clip, but cancellation cannot paint or rearm anything", () => {
  for (const cancelled of [false, true]) {
    let clock = 0;
    const f = fixture({ now: () => clock }),
      { frame, camera } = partialFrame();
    f.ready();
    f.cache.draw(frame);
    const old = f.result();
    f.cache.draw(frame);
    camera(100);
    f.cache.draw(frame, true); // One refill is already in flight.
    clock = 10;
    camera(423);
    const paints = f.cache.status().emergency.paints,
      blits = frame.scope.context.blits.length;
    frame.model.sma = () => {
      if (cancelled) f.cache.destroy();
      return null;
    };
    f.cache.draw(frame, true);
    assert.equal(f.cache.status().emergency.paints, paints);
    assert.equal(frame.scope.context.blits.length, blits + (cancelled ? 0 : 1));
    if (!cancelled) {
      assert.equal(frame.scope.context.blits.at(-1)[0], old);
      assert.ok(frame.scope.context.clips.at(-1)[2] > 0);
      assert.equal(f.cache.pending(), true);
    } else {
      assert.equal(f.timers.size, 0);
      assert.equal(old.closed, 1);
    }
    f.cache.destroy();
  }
});

test("emergency paint uses new reset data while old ownership, unsupported projection and destroyed caches cannot paint", () => {
  const f = fixture({ now: () => 0 }),
    { frame } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  const old = f.result();
  f.cache.draw(frame);
  const before = f.cache.status().emergency.paints,
    blits = frame.scope.context.blits.length;
  frame.model.reset(
    frame.model.data.map((candle) => ({ ...candle, close: candle.close + 200 })),
    frame.model.periods
  );
  frame.yFor = (price) => 200 - (price - 300) * 3;
  f.cache.invalidate(true);
  f.cache.draw(frame, true);
  assert.equal(old.closed, 1);
  assert.equal(frame.scope.context.blits.length, blits);
  assert.equal(f.cache.status().emergency.paints, before + 1);
  assert.equal(f.cache.pending(), true);
  const after = f.cache.status().emergency.paints;
  f.cache.draw({ ...frame, mode: 1 }, true);
  assert.equal(
    f.cache.status().emergency.paints,
    after,
    "unsafe mode never reaches emergency main paint"
  );
  f.cache.destroy();
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().emergency.paints, after);
  const g = fixture(),
    other = partialFrame();
  g.ready();
  g.cache.draw(other.frame);
  g.result();
  g.cache.draw(other.frame);
  const count = g.cache.status().emergency.paints;
  assert.equal(g.cache.draw(partialFrame().frame, true), false);
  assert.equal(
    g.cache.status().emergency.paints,
    count,
    "different model owner cannot borrow the old emergency path"
  );
  g.cache.destroy();
});

test("held old response is preview only and never dispatches the previously queued camera", () => {
  const f = fixture(),
    { frame, camera } = lightweightFrame();
  f.ready();
  f.cache.draw(frame);
  const a = f.messages.at(-1);
  camera(2);
  f.cache.draw(frame); // Programmatic B is queued behind A.
  const before = f.cache.status().snapshots;
  f.cache.setInteraction(true);
  camera(5);
  f.cache.draw(frame, true);
  const old = f.result(a);
  assert.equal(f.cache.status().dispatched, 1, "receive cannot dispatch B during held input");
  assert.equal(f.cache.pending(), true);
  f.cache.draw(frame, true);
  assert.equal(frame.scope.context.blits.at(-1)[0], old);
  assert.equal(f.cache.status().snapshots, before);
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  assert.equal(f.cache.status().dispatched, 2);
  assert.equal(f.messages.at(-1).key, mtpWorkerIntent(frame).key);
  f.cache.destroy();
});

test("held unchanged-close and changed-tail revisions preserve safe preview with no history work until exact idle", () => {
  for (const delta of [0, 3]) {
    const f = fixture(),
      { frame, camera, reads } = lightweightFrame();
    f.ready();
    f.cache.draw(frame);
    const image = f.result();
    f.cache.draw(frame);
    f.cache.setInteraction(true);
    const before = { ...f.cache.status() },
      oldReads = { ...reads },
      blits = frame.scope.context.blits.length;
    frame.model.data.at(-1).close += delta;
    frame.model.update(frame.model.data);
    f.cache.invalidate(true);
    assert.equal(image.closed, 0, "active invalidation waits for actual hard guards");
    camera(3);
    for (let i = 0; i < 60; i++) f.cache.draw(frame, true);
    assert.equal(image.closed, 0);
    assert.equal(frame.scope.context.blits.length, blits + 60);
    assert.equal(frame.scope.context.blits.at(-1)[0], image);
    assert.equal(f.cache.pending(), true, "a stale tail preview is never current exact readiness");
    assert.equal(f.cache.status().snapshots, before.snapshots);
    assert.equal(f.cache.status().dispatched, before.dispatched);
    assert.equal(reads.extrema, oldReads.extrema);
    assert.equal(reads.prefix, oldReads.prefix);
    assert.ok(reads.x - oldReads.x <= 60 * 3);
    assert.ok(reads.y - oldReads.y <= 60 * 3);
    f.cache.setInteraction(false);
    f.cache.draw(frame);
    assert.equal(image.closed, 0, "idle retains a soft preview until exact current data is ready");
    assert.equal(frame.scope.context.blits.length, blits + 61);
    assert.equal(f.cache.status().snapshots, before.snapshots + 1);
    assert.equal(f.cache.status().dispatched, before.dispatched + 1);
    assert.equal(f.messages.at(-1).prefix.length, frame.model.data.length + 1);
    assert.equal(f.messages.at(-1).key, mtpWorkerIntent(frame).key);
    f.result();
    assert.equal(f.cache.pending(), true);
    f.cache.draw(frame);
    assert.equal(image.closed, 1);
    assert.equal(f.cache.pending(), false);
    f.cache.destroy();
  }
});

test("a non-held tail update requires new exact data and disabled/empty/destroy release retained preview immediately", () => {
  for (const ending of ["settled", "disabled", "empty", "destroy"]) {
    const f = fixture(),
      { frame } = lightweightFrame();
    f.ready();
    f.cache.draw(frame);
    const image = f.result();
    f.cache.draw(frame);
    frame.model.data.at(-1).close += 3;
    frame.model.update(frame.model.data);
    f.cache.invalidate(true);
    assert.equal(image.closed, 0);
    const blits = frame.scope.context.blits.length;
    if (ending === "settled") {
      f.cache.draw(frame);
      assert.equal(
        image.closed,
        0,
        "same-hard soft data remains a preview while exact data is pending"
      );
      assert.equal(frame.scope.context.blits.length, blits + 1);
      assert.equal(f.cache.pending(), true);
      assert.equal(f.cache.status().dispatched, 2);
      f.result();
      f.cache.draw(frame);
      assert.equal(f.cache.pending(), false);
    } else if (ending === "destroy") f.cache.destroy();
    else {
      if (ending === "disabled") frame.model.periods = [];
      else frame.model.reset([], frame.model.periods);
      f.cache.invalidate(false);
      assert.equal(f.cache.pending(), false);
    }
    assert.equal(image.closed, 1);
    f.cache.destroy();
  }
});

test("settled same-close and changed-close soft updates keep safe preview until the current exact actual blit", () => {
  for (const delta of [0, 3]) {
    const f = fixture(),
      { frame } = lightweightFrame();
    f.ready();
    f.cache.draw(frame);
    const old = f.result();
    f.cache.draw(frame);
    frame.model.data.at(-1).close += delta;
    frame.model.update(frame.model.data);
    f.cache.invalidate(true);
    const blits = frame.scope.context.blits.length;
    for (let i = 0; i < 20; i++) {
      f.cache.draw(frame);
      assert.equal(frame.scope.context.blits.at(-1)[0], old);
      assert.equal(f.cache.pending(), true, "an old revision never completes exact readiness");
    }
    assert.equal(old.closed, 0);
    assert.equal(frame.scope.context.blits.length, blits + 20);
    assert.equal(f.cache.status().dispatched, 2);
    assert.equal(f.cache.status().snapshots, 2);
    const current = f.result();
    assert.equal(old.closed, 0);
    assert.equal(f.cache.pending(), true, "response alone does not end pending");
    f.cache.draw(frame);
    assert.equal(old.closed, 1);
    assert.equal(frame.scope.context.blits.at(-1)[0], current);
    assert.equal(f.cache.pending(), false);
    f.cache.destroy();
  }
});

test("settled hard changes still forbid the old bitmap before the new exact frame", () => {
  for (const change of [
    (frame) => {
      frame.model.styles.mtp160.width = 8;
    },
    (frame) => {
      frame.model.reset(frame.model.data, frame.model.periods);
    },
    (frame) => {
      frame.model.update([...frame.model.data, { timestamp: 999999999, close: 110 }]);
    },
    (frame) => {
      frame.scope.horizontalPixelRatio = 2;
    },
    (frame) => {
      frame.scope.bitmapSize.width++;
    },
    (frame) => {
      frame.mode = 2;
    },
    (frame) => {
      frame.model = lightweightFrame().frame.model;
    }
  ]) {
    const f = fixture(),
      { frame } = lightweightFrame();
    f.ready();
    f.cache.draw(frame);
    const old = f.result();
    f.cache.draw(frame);
    const blits = frame.scope.context.blits.length;
    change(frame);
    f.cache.invalidate(true);
    f.cache.draw(frame);
    assert.equal(old.closed, 1);
    assert.equal(frame.scope.context.blits.length, blits);
    f.cache.destroy();
  }
});

test("generic, gapped and non-affine held views stay blank without preparing heavy work", () => {
  for (const kind of ["generic", "gapped", "non-affine"]) {
    const f = fixture(),
      { frame, camera } = lightweightFrame();
    if (kind === "generic" || kind === "non-affine") delete frame.uniformX;
    if (kind === "gapped") {
      const native = frame.xFor;
      frame.xFor = (i) => (i % 101 === 0 ? null : native(i));
    }
    if (kind === "non-affine") {
      const native = frame.xFor;
      frame.xFor = (i) => native(i) + Math.sin(i / 5);
    }
    f.ready();
    f.cache.draw(frame);
    f.result();
    f.cache.draw(frame);
    const before = f.cache.status().snapshots,
      blits = frame.scope.context.blits.length;
    camera(4, 0);
    f.cache.draw(frame, true);
    assert.equal(f.cache.status().snapshots, before, kind);
    assert.equal(frame.scope.context.blits.length, blits, kind);
    assert.equal(f.cache.pending(), true);
    f.cache.destroy();
  }
});

test("one newly revealed bar stays fully covered by real overscan and reversal reuses the ready bitmap", () => {
  let clock = 0;
  const f = fixture({ now: () => clock }),
    { frame, camera, reads } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  const image = f.result();
  f.cache.draw(frame);
  const before = { ...f.cache.status() },
    oldReads = { ...reads },
    blits = frame.scope.context.blits.length;
  camera(1);
  f.cache.draw(frame, true);
  assert.equal(frame.scope.context.blits.length, blits + 1);
  assert.equal(frame.scope.context.blits.at(-1)[0], image);
  assert.equal(frame.scope.context.clips.length, 0, "real reserved bars cover the whole pane");
  assert.equal(f.cache.status().emergency.paints, before.emergency.paints);
  assert.equal(f.cache.status().snapshots, before.snapshots);
  assert.equal(f.cache.status().dispatched, before.dispatched);
  assert.equal(reads.prefix, oldReads.prefix);
  assert.equal(reads.extrema, oldReads.extrema);
  clock = 20;
  camera(0);
  f.cache.draw(frame, true);
  assert.equal(frame.scope.context.blits.at(-1)[0], image);
  assert.equal(f.cache.status().dispatched, 1);
  assert.equal(image.closed, 0, "coverage loss never discards a hard-compatible ready layer");
  f.cache.destroy();
  assert.equal(image.closed, 1);
});

test("long held pan prefetches at most once per 150ms, then idle draws latest exact", () => {
  let clock = 0;
  const f = fixture({ now: () => clock }),
    { frame, camera, reads } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  const before = { ...f.cache.status() },
    oldReads = { ...reads },
    blits = frame.scope.context.blits.length;
  const sent = [];
  for (let i = 1; i <= 80; i++) {
    clock = i * 10;
    camera(i * 5);
    const dispatched = f.cache.status().dispatched;
    f.cache.draw(frame, true);
    if (f.cache.status().dispatched > dispatched) {
      sent.push(clock);
      f.result();
    }
    assert.equal(
      f.cache.pending(),
      true,
      "refill responses and clipped previews never settle readiness"
    );
  }
  assert.ok(sent.length >= 2 && sent.length <= 6);
  assert.ok(sent.every((time, index) => !index || time - sent[index - 1] >= 150));
  assert.equal(f.cache.status().snapshots - before.snapshots, sent.length);
  assert.equal(reads.prefix - oldReads.prefix, sent.length);
  assert.equal(
    reads.extrema - oldReads.extrema,
    sent.length * 2,
    "core and captured bounds scan only on dispatch"
  );
  assert.equal(
    frame.scope.context.blits.length -
      blits +
      f.cache.status().emergency.paints -
      before.emergency.paints,
    80,
    "every pan frame uses exactly one visible path: safe bitmap or full coarse, never both"
  );
  clock += 10;
  camera(401);
  const pending = f.cache.status().dispatched;
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  assert.equal(f.cache.status().dispatched, pending + 1);
  assert.equal(f.messages.at(-1).key, mtpWorkerIntent(frame).key);
  f.result();
  assert.equal(f.cache.pending(), true);
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  assert.equal(f.timers.size, 0);
  f.cache.destroy();
});

test("reversal chooses the better ready bitmap at actual draw, never from the response callback", () => {
  for (const reversal of [0, 1]) {
    let clock = 0;
    const f = fixture({ now: () => clock }),
      { frame, camera, reads } = partialFrame();
    f.ready();
    f.cache.draw(frame);
    const a = f.result();
    f.cache.draw(frame);
    camera(600); // Outrun even the adaptive reserve, so the reversed ready has better coverage.
    f.cache.draw(frame, true);
    const request = f.messages.at(-1);
    clock = 10;
    camera(reversal);
    f.cache.draw(frame, true);
    const probes = { ...reads },
      b = f.result(request);
    assert.equal(reads.x, probes.x);
    assert.equal(reads.y, probes.y, "receive never queries the SDK");
    assert.equal(a.closed, 0);
    assert.equal(b.closed, 0, "one transition bitmap waits for actual camera validation");
    f.cache.draw(frame, true);
    assert.equal(b.closed, 1);
    assert.equal(a.closed, 0);
    assert.equal(frame.scope.context.blits.at(-1)[0], a);
    assert.equal(f.cache.status().dispatched, 2);
    assert.equal(f.cache.pending(), true);
    f.cache.destroy();
    assert.equal(a.closed, 1);
  }
});

test("a finite coarse zoom remains clipped and visible while requesting a sharper raster", () => {
  const f = fixture({ now: () => 0 }),
    { frame } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  const image = f.result();
  f.cache.draw(frame);
  const nativeX = frame.xFor;
  frame.xFor = (index) => nativeX(index) * 2.5;
  frame.to = frame.from + 424 / 2.5;
  f.cache.draw(frame, true);
  assert.equal(frame.scope.context.blits.at(-1)[0], image);
  assert.deepEqual(frame.scope.context.clips.at(-1), [0, 0, 1000, 400]);
  assert.ok(
    frame.scope.context.transforms.some(
      (entry) => entry[0] === "scale" && Math.abs(entry[1] - 2.5) < 1e-9
    )
  );
  assert.equal(f.cache.status().dispatched, 2);
  assert.equal(f.cache.pending(), true);
  f.result();
  f.cache.draw(frame, true);
  assert.equal(f.cache.pending(), true);
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  f.cache.destroy();
});

test("a fresh held chart with zero coverage starts one bounded first refill instead of waiting for release", () => {
  let clock = 0;
  const f = fixture({ now: () => clock }),
    { frame } = partialFrame();
  f.ready();
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().dispatched, 1);
  assert.equal(f.cache.status().snapshots, 1);
  for (let i = 0; i < 20; i++) {
    clock++;
    f.cache.draw(frame, true);
  }
  assert.equal(f.cache.status().dispatched, 1);
  f.result();
  f.cache.draw(frame, true);
  assert.equal(frame.scope.context.blits.length, 1);
  assert.equal(f.cache.pending(), true);
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  f.cache.destroy();
});

test("transition results close on invalidation and destroy without touching the SDK", () => {
  for (const ending of ["invalidate", "destroy"]) {
    const f = fixture({ now: () => 0 }),
      { frame, camera, reads } = partialFrame();
    f.ready();
    f.cache.draw(frame);
    const a = f.result();
    f.cache.draw(frame);
    camera(120);
    f.cache.draw(frame, true);
    const b = f.result();
    const before = { ...reads };
    if (ending === "invalidate") f.cache.invalidate(true);
    else f.cache.destroy();
    assert.equal(b.closed, 1);
    assert.equal(reads.x, before.x);
    assert.equal(reads.y, before.y);
    if (ending === "invalidate") assert.equal(a.closed, 0);
    f.cache.destroy();
    assert.equal(a.closed, 1);
  }
});

test("a busy refill keeps one cheap latest intent and a live tail remains preview-only until latest exact", () => {
  let clock = 0;
  const f = fixture({ now: () => clock }),
    { frame, camera } = partialFrame();
  f.ready();
  f.cache.draw(frame);
  const initial = f.result();
  f.cache.draw(frame);
  camera(120);
  f.cache.draw(frame, true);
  const job = f.messages.at(-1);
  assert.equal(f.cache.status().dispatched, 2);
  for (let i = 0; i < 60; i++) {
    clock += 5;
    camera(101 + i);
    f.cache.draw(frame, true);
  }
  assert.equal(f.cache.status().snapshots, 2);
  assert.equal(f.cache.status().dispatched, 2);
  frame.model.data.at(-1).close += 3;
  frame.model.update(frame.model.data);
  f.cache.invalidate(true);
  const stale = f.result(job);
  assert.equal(stale.closed, 1);
  assert.equal(initial.closed, 0);
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().dispatched, 3);
  assert.equal(f.messages.at(-1).prefix.length, frame.model.data.length + 1);
  f.result();
  assert.equal(f.cache.pending(), true);
  camera(162);
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  assert.equal(f.messages.at(-1).key, mtpWorkerIntent(frame).key);
  f.result();
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  f.cache.destroy();
});

test("refill clock timer ID zero notifies without dispatch and cancels on clear", () => {
  let clock = 0,
    updates = 0;
  const timers = new Map(),
    cancelled = [];
  const gate = new MtpWorkerRefill(
    {
      now: () => clock,
      delay(action, milliseconds) {
        timers.set(0, { action, milliseconds });
        return 0;
      },
      cancel(id) {
        cancelled.push(id);
        timers.delete(id);
      }
    },
    () => updates++
  );
  assert.equal(gate.allow(true), true);
  gate.sent();
  clock = 20;
  assert.equal(gate.allow(true), false);
  assert.equal(timers.get(0).milliseconds, 130);
  gate.clear();
  assert.deepEqual(cancelled, [0]);
  assert.equal(timers.size, 0);
  assert.equal(gate.allow(true), false);
  clock = 150;
  const timer = timers.get(0);
  timers.delete(0);
  timer.action();
  assert.equal(updates, 1);
  assert.equal(gate.allow(true), true);
  gate.sent();
  clock = 160;
  assert.equal(gate.allow(true), false);
  gate.allow(false);
  assert.equal(timers.size, 0);
});

test("pending refill timers and bitmaps close on hard reset, disable, failure and destroy", () => {
  for (const ending of ["reset", "disable", "error", "destroy"]) {
    let clock = 0;
    const f = fixture({ now: () => clock }),
      { frame, camera } = partialFrame();
    f.ready();
    f.cache.draw(frame);
    f.result();
    f.cache.draw(frame);
    camera(120);
    f.cache.draw(frame, true);
    const image = f.result();
    clock = 10;
    camera(240);
    f.cache.draw(frame, true);
    assert.ok([...f.timers.values()].some((timer) => timer.milliseconds < 5000));
    if (ending === "reset") {
      frame.model.reset(frame.model.data, frame.model.periods);
      f.cache.invalidate(true);
      assert.equal(f.timers.size, 0, "hard invalidation cancels the old coverage timer");
      f.cache.draw(frame, true);
    } else if (ending === "disable") f.cache.invalidate(false);
    else if (ending === "error") f.worker.onerror({});
    else f.cache.destroy();
    assert.equal(image.closed, 1, ending);
    if (ending === "reset")
      assert.ok(
        [...f.timers.values()].every((timer) => timer.milliseconds <= 150),
        "zero current coverage may arm a new bounded refill"
      );
    else assert.equal(f.timers.size, 0, ending);
    f.cache.destroy();
    assert.equal(f.timers.size, 0, ending);
  }
});

test("held hard changes close preview immediately and a different model owner falls back", () => {
  for (const change of [
    (frame) => {
      frame.model.styles.mtp160.width = 8;
    },
    (frame) => {
      frame.model.periods = [4, 6, 640];
    },
    (frame) => {
      frame.scope.horizontalPixelRatio = 2;
    },
    (frame) => {
      frame.scope.bitmapSize.width++;
    },
    (frame) => {
      frame.mode = 2;
    },
    (frame) => {
      frame.model.data.at(-1).close += 3;
      frame.model.reset(frame.model.data, frame.model.periods);
    },
    (frame) => {
      frame.model.reset(
        [...frame.model.data, { timestamp: 999999999, close: 120 }],
        frame.model.periods
      );
    }
  ]) {
    const f = fixture(),
      { frame } = lightweightFrame();
    f.ready();
    f.cache.draw(frame);
    const image = f.result();
    f.cache.draw(frame);
    const before = f.cache.status().snapshots,
      blits = frame.scope.context.blits.length;
    change(frame);
    f.cache.invalidate(true);
    assert.equal(
      image.closed,
      0,
      "actual draw must evaluate hard changes before a retained preview can appear"
    );
    f.cache.draw(frame, true);
    assert.equal(image.closed, 1);
    assert.equal(frame.scope.context.blits.length, blits);
    assert.equal(
      f.cache.status().snapshots,
      before + 1,
      "zero coverage may request one current-data refill; the old hard-invalid bitmap is never painted"
    );
    f.cache.destroy();
  }
  const f = fixture(),
    { frame } = lightweightFrame();
  f.ready();
  f.cache.draw(frame);
  const image = f.result();
  f.cache.draw(frame);
  const replacement = lightweightFrame().frame;
  assert.equal(f.cache.draw(replacement, true), false);
  assert.equal(f.cache.status().reason, "source-owner-changed");
  assert.equal(image.closed, 1);
  assert.equal(f.worker.terminated, 1);
  f.cache.destroy();
});

test("explicit Fit force bypasses held debounce once and ends pending only on exact current blit", () => {
  const f = fixture(),
    { frame, camera } = lightweightFrame();
  f.ready();
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  f.cache.setInteraction(true);
  camera(5);
  f.cache.draw(frame, true);
  const before = f.cache.status().snapshots;
  f.cache.forceRender();
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().snapshots, before + 1);
  assert.equal(f.cache.status().dispatched, 2);
  for (let i = 0; i < 20; i++) f.cache.draw(frame, true);
  assert.equal(f.cache.status().snapshots, before + 1);
  f.result();
  assert.equal(f.cache.pending(), true);
  f.cache.draw(frame, true);
  assert.equal(f.cache.pending(), false);
  camera(6);
  f.cache.draw(frame, true);
  assert.equal(
    f.cache.status().snapshots,
    before + 1,
    "ordinary held deferral resumes after exact Fit"
  );
  f.cache.destroy();
});

test("one forced dispatch cannot authorize another held job when the camera changes before its response", () => {
  const f = fixture(),
    { frame, camera } = lightweightFrame();
  f.ready();
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  f.cache.setInteraction(true);
  camera(5);
  f.cache.forceRender();
  f.cache.draw(frame, true);
  const forced = f.messages.at(-1);
  assert.equal(f.cache.status().dispatched, 2);
  camera(6);
  f.cache.draw(frame, true);
  f.result(forced);
  f.cache.draw(frame, true);
  assert.equal(f.cache.status().snapshots, 2);
  assert.equal(
    f.cache.status().dispatched,
    2,
    "one explicit force grants at most one dispatched job"
  );
  assert.equal(f.cache.pending(), true);
  f.cache.setInteraction(false);
  f.cache.draw(frame);
  assert.equal(f.cache.status().dispatched, 3);
  assert.equal(f.messages.at(-1).key, mtpWorkerIntent(frame).key);
  f.result();
  f.cache.draw(frame);
  assert.equal(
    f.cache.pending(),
    false,
    "latest settled camera completes readiness, without requiring the obsolete forced view"
  );
  f.cache.destroy();
});

test("worker paint exactly matches baseline commands, sampling phase, warmup and styles", () => {
  for (const length of [1000, 5425, 15083]) {
    const frame = frameWith(length, MTP_COMBINED_PERIODS);
    for (const range of [
      [0, length - 1],
      [121.2, length - 71.8],
      [601.4, 950.5]
    ]) {
      [frame.from, frame.to] = range;
      // Non-affine native X and null/nonfinite X gaps must survive unchanged.
      frame.xFor = (i) =>
        i % 101 === 0 ? null : i % 173 === 0 ? NaN : Math.round(i * 0.135 * 1.25) / 1.25 - 2;
      const intent = mtpWorkerIntent(frame);
      assert.ok(intent);
      const expected = context(),
        actual = context();
      frame.model.draw(expected, frame.from, frame.to, frame.xFor, baselineProjection(frame));
      paintMtpWorkerFrame(actual, intent.frame, frame.model.prefix.slice(0, length + 1));
      sameCommands(actual.commands, expected.commands);
      assert.equal(intent.frame.start, Math.max(0, Math.floor(frame.from) - 1));
      assert.equal(intent.frame.end, Math.min(length - 1, Math.ceil(frame.to) + 1));
      assert.equal(intent.frame.horizontalRatio, 1.25);
      assert.equal(intent.frame.verticalRatio, 1.7);
    }
  }
});

test("combined style and fractional DPR remain exact, no simplifier or padded settled range", () => {
  const frame = frameWith(5425);
  frame.model.styleKey = "mtpAll";
  frame.model.styles.mtpAll = { color: "#abcdef", width: 8.25, opacity: 0.31 };
  frame.from = 610.15;
  frame.to = 970.2;
  const intent = mtpWorkerIntent(frame);
  assert.ok(
    intent.frame.styles.every((style) => style.color === "#abcdef" && style.opacity === 0.31)
  );
  assert.equal(intent.frame.x.length, 364);
  const expected = context(),
    actual = context();
  frame.model.draw(expected, frame.from, frame.to, frame.xFor, baselineProjection(frame));
  paintMtpWorkerFrame(actual, intent.frame, frame.model.prefix);
  sameCommands(actual.commands, expected.commands);
});

test("projection and context guards preserve native fallback", () => {
  for (const mode of [0, 2, 3]) assert.ok(mtpWorkerIntent({ ...frameWith(), mode }));
  for (const mode of [1, undefined, 4])
    assert.equal(mtpWorkerIntent({ ...frameWith(), mode }), null);
  const frame = frameWith();
  frame.yFor = (price) => Math.log(price);
  assert.equal(mtpWorkerIntent(frame), null);
  for (const [property, value] of [
    ["filter", "blur(1px)"],
    ["globalCompositeOperation", "copy"],
    ["shadowBlur", 1],
    ["shadowOffsetX", 1],
    ["shadowOffsetY", 1]
  ]) {
    const changed = frameWith();
    changed.scope.context[property] = value;
    assert.equal(mtpWorkerIntent(changed), null, property);
  }
  for (const size of [
    { width: 4097, height: 20 },
    { width: 4096, height: 4096 },
    { width: 0, height: 10 }
  ])
    assert.equal(
      mtpWorkerIntent({ ...frameWith(), scope: { ...frameWith().scope, bitmapSize: size } }),
      null
    );
});

test("startup handshake dispatches immediately and only actual current draw completes pending", () => {
  const f = fixture(),
    frame = frameWith();
  assert.equal(f.messages[0].type, "hello");
  assert.equal(f.cache.pending(), true);
  assert.equal(f.cache.draw(frame), true);
  assert.equal(f.messages.length, 1);
  assert.equal(f.cache.status().snapshots, 0, "startup retains only a cheap intent");
  f.ready();
  assert.equal(f.messages.length, 1, "receive only requests a fresh SDK draw");
  f.cache.draw(frame);
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[1].prefix.length, frame.model.data.length + 1);
  assert.ok(frame.model.prefix.byteLength > 0, "original prefix buffer remains attached");
  const mean = frame.model.data.slice(-640).reduce((sum, bar) => sum + bar.close, 0) / 640;
  assert.ok(Math.abs(frame.model.sma(999, 640) - mean) < 1e-9);
  const image = f.result();
  assert.equal(f.cache.pending(), true, "response alone is not actual draw readiness");
  assert.equal(f.timers.size, 0, "success never waits for deadline");
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), false);
  assert.equal(frame.scope.context.blits[0][0], image);
  const capture = f.messages[1].frame;
  assert.deepEqual(frame.scope.context.blits[0].slice(1), [
    0,
    0,
    capture.width / capture.horizontalRatio,
    capture.height / capture.verticalRatio
  ]);
  assert.deepEqual(frame.scope.context.transforms.at(-1), [
    "translate",
    -capture.padX / capture.horizontalRatio,
    -capture.padY / capture.verticalRatio
  ]);
  f.cache.destroy();
  assert.equal(image.closed, 1);
  assert.equal(f.worker.terminated, 1);
});

test("A/B/C coalesces on main before postMessage and closes stale A", () => {
  const f = fixture(),
    frame = frameWith();
  f.ready();
  f.cache.draw(frame);
  const a = f.messages.at(-1);
  const b = { ...frame, xFor: (i) => i * 0.2 - 3 };
  const c = { ...frame, xFor: (i) => i * 0.3 - 4 };
  f.cache.draw(b);
  f.cache.draw(c);
  assert.equal(f.messages.filter((m) => m.type === "render").length, 1);
  const stale = f.result(a);
  assert.equal(stale.closed, 1);
  assert.equal(f.cache.status().snapshots, 1, "queued B/C and receive perform no full snapshot");
  f.cache.draw(c);
  assert.equal(f.messages.filter((m) => m.type === "render").length, 2);
  const final = f.messages.at(-1);
  assert.equal(final.key, mtpWorkerIntent(c).key);
  assert.equal(final.prefix, undefined, "camera-only jobs reuse the worker's data revision");
  const image = f.result(final);
  f.cache.draw(c);
  assert.equal(c.scope.context.blits.at(-1)[0], image);
  assert.equal(f.cache.status().stale, 1);
  f.cache.destroy();
});

test("stroke shadow is encoded in worker raster and disabled during main bitmap blit", () => {
  const f = fixture(),
    frame = frameWith();
  frame.scope.context.shadowColor = "rgba(20, 30, 40, 0.7)";
  f.ready();
  f.cache.draw(frame);
  const request = f.messages.at(-1);
  assert.equal(request.frame.shadowColor, "rgba(20, 30, 40, 0.7)");
  f.result(request);
  f.cache.draw(frame);
  assert.deepEqual(frame.scope.context.blitStates, [{ shadowColor: "rgba(0, 0, 0, 0)", alpha: 1 }]);
  f.cache.destroy();
});

test("actual draw revalidates resize, DPR, view, modes, styles and revision before blit", () => {
  for (const mutate of [
    (frame) => {
      frame.scope.bitmapSize.width++;
    },
    (frame) => {
      frame.scope.horizontalPixelRatio = 2;
    },
    (frame) => {
      frame.scope.verticalPixelRatio = 2;
    },
    (frame) => {
      frame.from = 10.5;
    },
    (frame) => {
      frame.xFor = (i) => i * 0.2;
    },
    (frame) => {
      frame.yFor = (price) => 170 - price * 2;
    },
    (frame) => {
      frame.mode = 2;
    },
    (frame) => {
      frame.model.styles.mtp160.width = 5;
    },
    (frame) => {
      frame.scope.context.lineJoin = "round";
    },
    (frame) => {
      frame.model.data[500].close += 3;
      frame.model.reset(frame.model.data, frame.model.periods);
    }
  ]) {
    const f = fixture(),
      frame = frameWith();
    f.ready();
    f.cache.draw(frame);
    const image = f.result();
    mutate(frame);
    f.cache.draw(frame);
    assert.equal(image.closed, 1);
    assert.equal(frame.scope.context.blits.length, 0);
    assert.equal(f.cache.pending(), true);
    f.cache.destroy();
  }
});

test("revision updates copy only new active prefix, history reset never reuses old bitmap", () => {
  const f = fixture(),
    frame = frameWith();
  f.ready();
  f.cache.draw(frame);
  const a = f.messages.at(-1),
    originalPrefix = frame.model.prefix;
  frame.model.data.at(-1).close += 3;
  frame.model.update(frame.model.data);
  f.cache.draw(frame);
  const old = f.result(a);
  assert.equal(old.closed, 1);
  f.cache.draw(frame);
  const b = f.messages.at(-1);
  assert.equal(b.prefix.length, frame.model.data.length + 1);
  assert.equal(frame.model.prefix, originalPrefix);
  assert.ok(frame.model.prefix.byteLength > b.prefix.byteLength);
  f.result(b);
  f.cache.draw(frame);
  const oldBlits = frame.scope.context.blits.length;
  frame.model.reset(frame.model.data.slice(0, 700), frame.model.periods);
  f.cache.draw(frame);
  assert.equal(frame.scope.context.blits.length, oldBlits);
  f.cache.destroy();
});

test("camera changed back to dispatched A cancels obsolete queued B", () => {
  const f = fixture(),
    frame = lightweightFrame().frame;
  f.ready();
  f.cache.draw(frame);
  f.cache.draw({ ...frame, from: 100 });
  f.cache.draw(frame);
  f.result();
  f.cache.draw(frame);
  assert.equal(f.messages.filter((m) => m.type === "render").length, 1);
  assert.equal(f.cache.pending(), false);
  f.cache.destroy();
});

test("destroy closes ready bitmap and captured late callbacks cannot update or blit", () => {
  const f = fixture(),
    frame = frameWith();
  f.ready();
  f.cache.draw(frame);
  const callback = f.worker.onmessage,
    request = f.messages.at(-1);
  f.cache.destroy();
  const before = f.updates(),
    late = bitmap();
  callback({ data: { type: "result", id: request.id, key: request.key, bitmap: late } });
  assert.equal(late.closed, 1);
  assert.equal(f.updates(), before);
  assert.equal(f.cache.draw(frame), false);
  assert.equal(f.cache.pending(), false);
  assert.equal(f.timers.size, 0);
});

test("worker errors, messageerror, bad build, postMessage and deadlines fall back once", () => {
  for (const fault of ["error", "messageerror", "build", "post", "startup", "render", "failure"]) {
    const f = fixture(),
      frame = frameWith();
    if (["error", "messageerror", "render", "failure", "post"].includes(fault)) f.ready();
    if (fault === "post")
      f.worker.postMessage = () => {
        throw new Error("clone failure");
      };
    if (!["build", "startup"].includes(fault)) f.cache.draw(frame);
    if (fault === "error") f.worker.onerror({});
    if (fault === "messageerror") f.worker.onmessageerror({});
    if (fault === "build") f.send({ type: "ready", protocol: MTP_WORKER_PROTOCOL, build: "old" });
    if (fault === "startup" || fault === "render") [...f.timers.values()][0].action();
    if (fault === "failure") f.send({ type: "failure", reason: "GPU unavailable" });
    assert.equal(f.cache.status().state, "fallback", fault);
    assert.equal(f.cache.pending(), false, fault);
    assert.equal(f.cache.draw(frame), false, fault);
    assert.equal(f.worker.terminated, 1, fault);
    assert.equal(f.timers.size, 0, fault);
    assert.ok(frame.model.prefix.byteLength > 0, fault);
    f.cache.destroy();
  }
});

test("unsupported current frame discards in-flight bitmap without painting it", () => {
  const f = fixture(),
    frame = frameWith();
  f.ready();
  f.cache.draw(frame);
  const lateCallback = f.worker.onmessage,
    request = f.messages.at(-1);
  assert.equal(f.cache.draw({ ...frame, mode: 1 }), false);
  assert.equal(f.cache.pending(), false);
  assert.equal(f.worker.terminated, 1, "worker stops before native heavy fallback");
  const old = bitmap();
  lateCallback({ data: { type: "result", id: request.id, key: request.key, bitmap: old } });
  assert.equal(old.closed, 1);
  assert.equal(frame.scope.context.blits.length, 0);
  f.cache.destroy();
});

test("disabled or reset source can invalidate pending work without waiting for its response", () => {
  const f = fixture(),
    frame = frameWith();
  f.ready();
  f.cache.draw(frame);
  const a = f.messages.at(-1);
  f.cache.invalidate();
  assert.equal(f.cache.pending(), false);
  const old = f.result(a);
  assert.equal(old.closed, 1);
  frame.model.reset(frame.model.data, frame.model.periods);
  f.cache.invalidate(true);
  assert.equal(f.cache.pending(), true, "active source update waits for its actual draw");
  f.cache.draw(frame);
  assert.equal(f.cache.pending(), true);
  const image = f.result();
  f.cache.draw(frame);
  assert.equal(frame.scope.context.blits.at(-1)[0], image);
  f.cache.invalidate();
  assert.equal(image.closed, 1);
  f.cache.destroy();
});

test("new source arriving after queued intent is captured cannot dispatch its stale prefix", () => {
  const f = fixture(),
    frame = frameWith();
  f.ready();
  f.cache.draw(frame);
  const a = f.messages.at(-1);
  f.cache.draw({ ...frame, from: 200 });
  frame.model.data.at(-1).close += 2;
  frame.model.update(frame.model.data);
  f.result(a);
  assert.equal(f.messages.filter((message) => message.type === "render").length, 1);
  f.cache.draw(frame);
  assert.equal(f.messages.filter((message) => message.type === "render").length, 2);
  assert.equal(f.messages.at(-1).prefix.length, frame.model.data.length + 1);
  f.cache.destroy();
});

test("worker entry verifies build, reuses bounded backing, paints/transfers and closes on transfer failure", () => {
  const outbound = [],
    surfaces = [],
    bitmaps = [],
    allocations = [];
  let throwTransfer = false;
  const workerScope = {
    onmessage: null,
    postMessage(message, transfer) {
      if (throwTransfer && message.type === "result") throw new Error("transfer failed");
      outbound.push({ message, transfer });
    }
  };
  class Canvas {
    actualWidth = 0;
    actualHeight = 0;
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = context();
      surfaces.push(this);
    }
    get width() {
      return this.actualWidth;
    }
    set width(value) {
      this.actualWidth = value;
      this.checkAllocation();
    }
    get height() {
      return this.actualHeight;
    }
    set height(value) {
      this.actualHeight = value;
      this.checkAllocation();
    }
    checkAllocation() {
      allocations.push([this.width, this.height]);
      assert.ok(
        this.width * this.height <= 4 * 1024 * 1024,
        `transient surface ${this.width}x${this.height}`
      );
    }
    getContext() {
      this.context.setTransform = (...values) => {
        this.transform = values;
      };
      return this.context;
    }
    transferToImageBitmap() {
      const image = bitmap();
      bitmaps.push(image);
      return image;
    }
  }
  const code = ts.transpileModule(
    readFileSync(new URL("../src/model/mtp-raster-worker.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
    }
  ).outputText;
  new vm.Script(
    `(function(require,module,exports,globalThis,OffscreenCanvas){${code}\n})`
  ).runInThisContext()(
    (specifier) =>
      specifier.includes("generated/")
        ? { BUILD_ID: "unit" }
        : load(`model/${specifier.split("/").at(-1)}`),
    { exports: {} },
    {},
    workerScope,
    Canvas
  );
  const send = (data) => workerScope.onmessage({ data });
  send({ type: "hello", protocol: MTP_WORKER_PROTOCOL, build: "old" });
  assert.equal(outbound.at(-1).message.type, "failure");
  send({ type: "hello", protocol: MTP_WORKER_PROTOCOL, build: "unit" });
  assert.equal(outbound.at(-1).message.type, "ready");
  const source = frameWith(),
    intent = mtpWorkerIntent(source);
  const render = {
    type: "render",
    id: 1,
    key: intent.key,
    frame: intent.frame,
    prefix: source.model.prefix.slice(0, source.model.data.length + 1)
  };
  send(render);
  assert.equal(outbound.at(-1).message.type, "result");
  assert.equal(outbound.at(-1).transfer[0], bitmaps[0]);
  assert.deepEqual(surfaces[0].transform, [1.25, 0, 0, 1.7, intent.frame.padX, intent.frame.padY]);
  assert.equal(surfaces[0].context.lineCap, source.scope.context.lineCap);
  assert.equal(surfaces[0].context.lineJoin, source.scope.context.lineJoin);
  assert.equal(surfaces[0].context.miterLimit, source.scope.context.miterLimit);
  assert.equal(surfaces[0].context.shadowColor, source.scope.context.shadowColor);
  const expected = context();
  source.model.draw(expected, source.from, source.to, source.xFor, baselineProjection(source));
  sameCommands(surfaces[0].context.commands, expected.commands);
  throwTransfer = true;
  send({ ...render, id: 2, prefix: undefined });
  assert.equal(surfaces.length, 1);
  assert.equal(bitmaps[1].closed, 1);
  assert.equal(outbound.at(-1).message.type, "failure");
  send({ ...render, frame: { ...render.frame, width: 4097 } });
  assert.equal(bitmaps.length, 2, "oversized surface rejected before allocation");
  assert.equal(outbound.at(-1).message.type, "failure");
  throwTransfer = false;
  for (const [width, height] of [
    [1024, 4096],
    [4096, 1024],
    [1024, 4096]
  ]) {
    send({ ...render, frame: { ...render.frame, width, height } });
    assert.equal(outbound.at(-1).message.type, "result");
    assert.equal(surfaces[0].width, width);
    assert.equal(surfaces[0].height, height);
  }
  assert.equal(surfaces.length, 1);
  assert.ok(allocations.some(([width, height]) => width === 1024 && height === 4096));
  assert.ok(allocations.some(([width, height]) => width === 4096 && height === 1024));
  assert.ok(allocations.every(([width, height]) => width * height <= 4 * 1024 * 1024));
});

test("worker module deadline, rejection and destroy prevent late worker creation (including timer ID zero)", async () => {
  const Cache = rasterCacheFor();
  for (const outcome of ["timeout", "destroy", "reject", "success"]) {
    let resolve,
      reject,
      created = 0,
      updates = 0,
      stopped = 0;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timers = new Map();
    const cancelled = [];
    const environment = {
      canvas: () => null,
      loadWorker: () => promise,
      delay(action, milliseconds) {
        assert.equal(milliseconds, 5000);
        timers.set(0, action);
        return 0;
      },
      cancel(id) {
        cancelled.push(id);
        timers.delete(id);
      }
    };
    class Client {
      constructor() {
        created++;
      }
      draw() {
        return true;
      }
      pending() {
        return false;
      }
      destroy() {
        stopped++;
      }
      status() {
        return { state: "ready", pending: false };
      }
    }
    const cache = new Cache(() => updates++, undefined, environment);
    assert.equal(cache.pending(), true);
    assert.equal(cache.draw(frameWith()), true);
    await Promise.resolve(); // The deferred module loader has now received its promise.
    if (outcome === "timeout") timers.get(0)();
    if (outcome === "destroy") cache.destroy();
    if (outcome === "reject") reject(new Error("chunk failed"));
    else resolve({ MtpWorkerRasterCache: Client });
    await new Promise((done) => setImmediate(done));
    assert.equal(timers.size, 0, outcome);
    assert.ok(cancelled.includes(0), `timer ID 0 cancelled on ${outcome}`);
    assert.equal(created, outcome === "success" ? 1 : 0, outcome);
    assert.equal(cache.pending(), false, outcome);
    assert.equal(
      cache.workerStatus().state,
      outcome === "success" ? "ready" : outcome === "destroy" ? "destroyed" : "fallback",
      outcome
    );
    assert.equal(updates, outcome === "destroy" ? 0 : 1, outcome);
    if (outcome === "timeout" || outcome === "reject") {
      assert.equal(
        cache.workerStatus().reason,
        outcome === "timeout" ? "worker-module-deadline" : "worker-module-load-error"
      );
      assert.equal(
        cache.draw({ ...frameWith(), mode: 1 }),
        false,
        "original native fallback is available"
      );
    }
    cache.destroy();
    assert.equal(stopped, outcome === "success" ? 1 : 0);
  }
});

test("LW wrapper reuses its 180ms pointer/wheel tracker and explicit Fit preserves physical pointers", async () => {
  const Cache = rasterCacheFor();
  const timers = new Map(),
    held = [],
    interactions = [];
  let serial = 0,
    forced = 0,
    destroyed = 0;
  class Client {
    draw(_frame, active) {
      held.push(active);
      return true;
    }
    setInteraction(active) {
      interactions.push(active);
    }
    forceRender() {
      forced++;
    }
    destroy() {
      destroyed++;
    }
  }
  const view = new EventTarget(),
    container = new EventTarget();
  container.ownerDocument = { defaultView: view };
  const environment = {
    canvas: () => null,
    loadWorker: async () => ({ MtpWorkerRasterCache: Client }),
    delay(action, milliseconds) {
      const id = serial++;
      timers.set(id, { action, milliseconds });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    }
  };
  const cache = new Cache(() => {}, container, environment);
  await new Promise((done) => setImmediate(done));
  const frame = frameWith();
  const event = (name, values) => Object.assign(new Event(name), values);
  const idle = () => {
    const [id, timer] = [...timers.entries()].find(([, value]) => value.milliseconds === 180);
    timers.delete(id);
    timer.action();
  };
  cache.draw(frame);
  assert.equal(held.at(-1), false, "cold/programmatic draw has no idle wait");
  container.dispatchEvent(event("pointerdown", { pointerId: 1, button: 0 }));
  cache.draw(frame);
  assert.equal(held.at(-1), true);
  view.dispatchEvent(event("pointerup", { pointerId: 1 }));
  cache.draw(frame);
  assert.equal(held.at(-1), true, "release waits for the existing idle timer");
  const firstIdle = [...timers.keys()][0];
  frame.from += 1;
  cache.draw(frame);
  assert.equal(held.at(-1), true);
  assert.equal(
    timers.has(firstIdle),
    false,
    "kinetic camera movement rearms the existing 180ms wait"
  );
  idle();
  frame.from += 1; // Motion can land after timeout but before the SDK's confirming redraw.
  cache.draw(frame);
  assert.equal(
    held.at(-1),
    true,
    "idle callback alone cannot classify continued inertia as programmatic"
  );
  assert.equal([...timers.values()].filter((timer) => timer.milliseconds === 180).length, 1);
  const kineticIdle = [...timers.keys()][0];
  frame.model.data.at(-1).close += 1;
  cache.draw(frame);
  cache.draw(frame);
  assert.equal(
    [...timers.keys()][0],
    kineticIdle,
    "quotes and response redraws with unchanged camera do not extend idle"
  );
  idle();
  cache.draw(frame);
  assert.equal(held.at(-1), false);
  assert.equal(interactions.at(-1), false);
  frame.from += 1;
  cache.draw(frame);
  assert.equal(
    held.at(-1),
    false,
    "camera changes outside an interaction epoch are immediate programmatic work"
  );
  container.dispatchEvent(event("wheel", { deltaX: 0, deltaY: 100 }));
  cache.draw(frame);
  assert.equal(held.at(-1), true);
  cache.forceRender();
  cache.draw(frame);
  assert.equal(held.at(-1), false, "explicit Fit overrides stale wheel debounce");
  assert.equal(forced, 1);
  assert.equal(timers.size, 0);
  container.dispatchEvent(event("pointerdown", { pointerId: 2, button: 0 }));
  cache.forceRender();
  cache.draw(frame);
  assert.equal(held.at(-1), true, "Fit must not clear the physical pointer set");
  assert.equal(forced, 2);
  view.dispatchEvent(event("pointercancel", { pointerId: 2 }));
  idle();
  cache.destroy();
  container.dispatchEvent(event("wheel", { deltaX: 0, deltaY: 100 }));
  assert.equal(timers.size, 0);
  assert.equal(destroyed, 1);
});
