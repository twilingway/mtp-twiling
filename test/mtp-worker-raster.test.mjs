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

function context() {
  const commands = [],
    blits = [],
    blitStates = [];
  return {
    commands,
    blits,
    blitStates,
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
    }
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
function fixture() {
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
  f.ready();
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
  assert.deepEqual(frame.scope.context.blits[0].slice(1), [0, 0, 200, 100]);
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
    frame = frameWith();
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
        : load("model/mtp-worker-protocol.js"),
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
  assert.deepEqual(surfaces[0].transform, [1.25, 0, 0, 1.7, 0, 0]);
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
  const code = ts.transpileModule(
    readFileSync(new URL("../src/model/mtp-raster-cache.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
    }
  ).outputText;
  const module = { exports: {} };
  new vm.Script(
    `(function(module,exports,__MTP_RASTER_DEV__,location){${code}\n})`
  ).runInThisContext()(module, module.exports, true, { search: "?mtpRaster=worker" });
  const Cache = module.exports.MtpRasterCache;
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
