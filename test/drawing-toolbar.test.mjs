import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const json = (value) => JSON.parse(JSON.stringify(value));

// Execute current production models and commands; never open browser storage.
function sourceModules() {
  const context = vm.createContext({ structuredClone, crypto, Blob, console });
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    const key = path.relative(sourceRoot, filename).replaceAll(path.sep, "/");
    assert.ok(!key.startsWith("../") && !path.isAbsolute(key));
    if (key.startsWith("services/"))
      return new Proxy({}, { get: () => () => assert.fail("unexpected service access") });
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) => {
        assert.ok(specifier.startsWith("."));
        return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)));
      },
      module,
      module.exports
    );
    return module.exports;
  }
  return { load };
}

const modules = sourceModules();
const { snapDrawingPoint } = modules.load("model/drawing-magnet.ts");
const { drawingToolbarSettings, isDrawingToolbarSettings } = modules.load(
  "model/drawing-toolbar.ts"
);
const { TerminalDrawingTools } = modules.load("screens/terminal/controller-drawing-tools.ts");
const { validateBackup } = modules.load("model/backup-format.ts");
const flags = (patch = {}) => ({
  ma: false,
  ema: false,
  volume: false,
  mtp160: false,
  mtp440: false,
  mtp640: false,
  ...patch
});
const bar = (timestamp, close = 100) => ({
  timestamp,
  open: close - 2,
  high: close + 7,
  low: close - 9,
  close,
  volume: 10
});
const project = ({ timestamp, value }) => ({ x: timestamp / 100, y: Math.log(value) * 100 });
const closeEnough = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);

test("weak magnet respects screen distance; strong picks projected OHLC on the nearest real bar", () => {
  const data = [bar(100, 40), bar(200, 80), bar(8000, 200), bar(8100, 400)];
  // Independent linear reference covers both sides of market gaps and range edges.
  for (const timestamp of [0, 125, 198, 3999, 5001, 8055, 10000]) {
    const raw = { timestamp, value: 155 };
    const pixel = project(raw);
    const nearest = data.reduce((best, item) =>
      Math.abs(item.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? item : best
    );
    const candidates = [nearest.open, nearest.high, nearest.low, nearest.close];
    const expectedValue = candidates.reduce((best, value) => {
      const distance = (candidate) => {
        const p = project({ timestamp: nearest.timestamp, value: candidate });
        return Math.hypot(p.x - pixel.x, p.y - pixel.y);
      };
      return distance(value) < distance(best) ? value : best;
    });
    assert.deepEqual(json(snapDrawingPoint(raw, pixel, data, project, "strong")), {
      timestamp: nearest.timestamp,
      value: expectedValue
    });
  }
  const raw = { timestamp: 100, value: 45 };
  const anchor = project({ timestamp: 100, value: 47 });
  assert.equal(
    snapDrawingPoint(raw, { x: anchor.x, y: anchor.y + 10.01 }, [data[0]], project, "weak"),
    raw
  );
  assert.deepEqual(
    json(snapDrawingPoint(raw, { x: anchor.x, y: anchor.y + 10 }, [data[0]], project, "weak")),
    {
      timestamp: 100,
      value: 47
    }
  );
  assert.notEqual(
    snapDrawingPoint(raw, { x: anchor.x, y: anchor.y + 100 }, [data[0]], project, "strong"),
    raw
  );
});

test("off, empty history and unusable projection preserve the original point", () => {
  const raw = { timestamp: 100, value: 95 },
    pixel = { x: 1, y: 1 };
  const failProject = () => assert.fail("off/empty magnet must not project");
  assert.equal(snapDrawingPoint(raw, pixel, [bar(100)], failProject, "off"), raw);
  assert.equal(snapDrawingPoint(raw, pixel, [], failProject, "strong"), raw);
  for (const mapped of [null, { x: NaN, y: 1 }, { x: 1, y: Infinity }])
    assert.equal(
      snapDrawingPoint(raw, pixel, [bar(100)], () => mapped, "strong"),
      raw
    );
  // A broken candidate must not prevent snapping to another valid candidate.
  assert.equal(
    snapDrawingPoint(
      raw,
      pixel,
      [bar(100)],
      (point) => (point.value === 100 ? pixel : null),
      "strong"
    ).value,
    100
  );
});

const history = Array.from({ length: 670 }, (_, index) =>
  bar(index * 60000, 300 + index * 0.9 + Math.sin(index / 7) * 23)
);
function expectedSma(data, index, period) {
  return (
    data.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period
  );
}
function expectedEma(data, index) {
  let value = data.slice(0, 50).reduce((sum, item) => sum + item.close, 0) / 50;
  for (let i = 50; i <= index; i++) value += (data[i].close - value) * (2 / 51);
  return value;
}

test("enabled SMA, EMA and each MTP family snap to independently calculated values", () => {
  const index = 660;
  const cases = [
    ["ma", expectedSma(history, index, 20)],
    ["ema", expectedEma(history, index)],
    ["mtp160", expectedSma(history, index, 160)],
    ["mtp440", expectedSma(history, index, 440)],
    ["mtp640", expectedSma(history, index, 640)]
  ];
  for (const [key, expected] of cases) {
    const raw = { timestamp: history[index].timestamp, value: expected + 0.01 };
    const pixel = project({ ...raw, value: expected });
    const result = snapDrawingPoint(raw, pixel, history, project, "weak", flags({ [key]: true }));
    assert.equal(result.timestamp, raw.timestamp, key);
    closeEnough(result.value, expected);
    // Restrict projection to the expected line to prove disabled indicators aren't candidates.
    const onlyExpected = (point) => (Math.abs(point.value - expected) < 1e-9 ? pixel : null);
    assert.equal(snapDrawingPoint(raw, pixel, history, onlyExpected, "strong", flags()), raw, key);
  }
});

test("indicator warm-up never invents early SMA, EMA or MTP values", () => {
  for (const [key, period] of [
    ["ma", 20],
    ["ema", 50],
    ["mtp160", 4],
    ["mtp440", 164],
    ["mtp640", 446]
  ]) {
    const index = period - 2,
      data = history.slice(0, index + 1);
    const raw = { timestamp: data[index].timestamp, value: 1 },
      pixel = { x: 0, y: 0 };
    const ohlc = new Set([data[index].open, data[index].high, data[index].low, data[index].close]);
    assert.equal(
      snapDrawingPoint(
        raw,
        pixel,
        data,
        (point) => (ohlc.has(point.value) ? null : pixel),
        "strong",
        flags({ [key]: true })
      ),
      raw,
      key
    );
    const ready = history.slice(0, period),
      expected = expectedSma(ready, period - 1, period);
    const readyRaw = { timestamp: ready.at(-1).timestamp, value: 1 };
    const result = snapDrawingPoint(
      readyRaw,
      pixel,
      ready,
      (point) => (Math.abs(point.value - expected) < 1e-9 ? pixel : null),
      "strong",
      flags({ [key]: true })
    );
    closeEnough(result.value, expected);
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture({
  drawingTools = {},
  flush = async () => {},
  saveSettings = async () => {}
} = {}) {
  let state = {
    owner: "alice",
    activeTool: null,
    selectedObject: "one",
    preferences: {
      symbol: "ONE",
      instrumentUid: "uid-one",
      chartSettings: { drawingTools },
      indicators: flags({ ma: true, volume: true })
    },
    rows: [
      { symbol: "ONE", uid: "uid-one" },
      { symbol: "ONE", uid: "uid-two" }
    ],
    drawings: [
      { id: "one", visible: false, lock: false },
      { id: "two", visible: true, lock: false }
    ],
    images: [{ id: "image", visible: false, lock: false, blob: new Blob(["image"]) }]
  };
  const changes = [],
    settingsWrites = [],
    preferenceWrites = [];
  let cancellations = 0;
  const controller = {
    getSnapshot: () => state,
    setDialog: (dialog) => {
      state = { ...state, dialog };
    },
    setTool: (tool) => {
      state = { ...state, activeTool: tool };
    },
    setChartSettings: async (patch) => {
      const owner = state.owner;
      await saveSettings(patch, owner);
      settingsWrites.push({ owner, patch: json(patch) });
      if (state.owner === owner)
        state = {
          ...state,
          preferences: {
            ...state.preferences,
            chartSettings: { ...state.preferences.chartSettings, ...patch }
          }
        };
    },
    setPreferences: async (patch) => {
      preferenceWrites.push(json(patch));
      state = { ...state, preferences: { ...state.preferences, ...patch } };
    },
    editing: {
      cancelGesture: () => {
        cancellations++;
      },
      flush: () => flush(),
      change: async (patch) => {
        changes.push(patch);
        state = { ...state, ...patch };
      }
    }
  };
  return {
    tools: new TerminalDrawingTools(controller),
    controller,
    changes,
    settingsWrites,
    preferenceWrites,
    state: () => state,
    options: () => drawingToolbarSettings(state.preferences.chartSettings),
    update: (patch) => {
      state = { ...state, ...patch };
    },
    cancellations: () => cancellations
  };
}

test("global hide and lock select distinct target modes without rewriting individual objects", async () => {
  const f = fixture(),
    drawings = f.state().drawings,
    images = f.state().images;
  const original = json(drawings),
    image = images[0];
  for (const [method, first, second, targetKey] of [
    ["toggleHide", "drawingsHidden", "indicatorsHidden", "hideTarget"],
    ["toggleLock", "drawingsLocked", "indicatorsLocked", "lockTarget"]
  ]) {
    for (const target of ["drawings", "indicators", "all"]) {
      await f.tools[method](target);
      assert.equal(f.options()[targetKey], target);
      assert.equal(f.options()[first], target !== "indicators");
      assert.equal(f.options()[second], target !== "drawings");
      await f.tools[method]();
      assert.equal(f.options()[first], false);
      assert.equal(f.options()[second], false);
    }
  }
  assert.equal(f.state().drawings, drawings);
  assert.equal(f.state().images, images);
  assert.equal(f.state().images[0], image);
  assert.deepEqual(json(drawings), original);
  assert.deepEqual(f.changes, []);
  assert.ok(f.cancellations() > 0);
});

test("cursor, last tool per group, favorites and magnet strength survive subsequent choices", async () => {
  const f = fixture();
  await f.tools.choose("rayLine");
  await f.tools.choose("fibonacciExtension");
  await f.tools.setCursor("dot");
  assert.equal(f.state().activeTool, null);
  assert.equal(f.options().cursor, "dot");
  await f.tools.choose("segment");
  assert.equal(f.options().cursor, "crosshair");
  assert.deepEqual(json(f.options().lastTools), {
    lines: "segment",
    fib: "fibonacciExtension",
    cursors: "dot"
  });
  await f.tools.toggleFavorite("rayLine");
  await f.tools.toggleFavorite("fibonacciExtension");
  await f.tools.toggleFavorite("rayLine");
  assert.deepEqual(json(f.options().favorites), ["fibonacciExtension"]);
  await f.tools.setOptions({ magnet: "strong" });
  await f.tools.toggleMagnet();
  assert.equal(f.options().magnet, "off");
  assert.equal(f.options().magnetStrength, "strong");
  await f.tools.toggleMagnet();
  assert.equal(f.options().magnet, "strong");
  await f.tools.setOptions({ magnet: "weak" });
  await f.tools.toggleMagnet();
  await f.tools.toggleMagnet();
  assert.equal(f.options().magnet, "weak");
});

test("rapid settings patches merge at execution and queued work cannot write another profile", async () => {
  const gate = deferred();
  let first = true;
  const f = fixture({
    saveSettings: async () => {
      if (first) {
        first = false;
        await gate.promise;
      }
    }
  });
  const a = f.tools.setOptions({ snapIndicators: true });
  const b = f.tools.setOptions({ stayInDrawingMode: true });
  const c = f.tools.setOptions({ deleteLocked: true });
  await Promise.resolve();
  gate.resolve();
  await Promise.all([a, b, c]);
  assert.equal(f.options().snapIndicators, true);
  assert.equal(f.options().stayInDrawingMode, true);
  assert.equal(f.options().deleteLocked, true);

  const secondGate = deferred();
  const g = fixture({ saveSettings: () => secondGate.promise });
  const started = g.tools.setOptions({ magnet: "strong" });
  const queued = g.tools.setOptions({ drawingsHidden: true });
  const queuedCursor = g.tools.setCursor("eraser");
  await Promise.resolve();
  g.update({ owner: "bob", preferences: { ...g.state().preferences, chartSettings: {} } });
  secondGate.resolve();
  await Promise.all([started, queued, queuedCursor]);
  assert.deepEqual(
    g.settingsWrites.map((write) => write.owner),
    ["alice"]
  );
  assert.deepEqual(json(g.state().preferences.chartSettings), {});
});

test("two rapid magnet toggles return to off after the queued writes complete", async () => {
  const gate = deferred();
  let first = true;
  const f = fixture({
    saveSettings: async () => {
      if (first) {
        first = false;
        await gate.promise;
      }
    }
  });
  const a = f.tools.toggleMagnet();
  const b = f.tools.toggleMagnet();
  await Promise.resolve();
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(f.options().magnet, "off");
});

test("a locked-delete confirmation belongs to its captured instrument scope", async () => {
  const f = fixture();
  f.state().drawings[0].lock = true;
  const scope = f.tools.scopeKey();
  assert.equal(await f.tools.remove("all", false, scope), false);
  f.update({ preferences: { ...f.state().preferences, instrumentUid: "uid-two" } });
  const before = f.state();
  const cancellations = f.cancellations();
  assert.equal(await f.tools.remove("all", true, scope), true);
  assert.equal(f.state(), before);
  assert.equal(f.cancellations(), cancellations);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.preferenceWrites, []);
});

test("remove drawings and images is one undoable change and leaves indicators intact", async () => {
  const f = fixture(),
    indicators = f.state().preferences.indicators;
  assert.equal(await f.tools.remove("drawings"), true);
  assert.deepEqual(json(f.changes), [{ drawings: [], images: [], selectedObject: null }]);
  assert.equal(f.state().preferences.indicators, indicators);
  assert.equal(f.preferenceWrites.length, 0);
});

test("locked drawing, image or global lock requires confirmation; force and deleteLocked authorize it", async () => {
  for (const kind of ["drawing", "image", "global"]) {
    const f = fixture({ drawingTools: { drawingsLocked: kind === "global" } });
    if (kind === "drawing") f.state().drawings[0].lock = true;
    if (kind === "image") f.state().images[0].lock = true;
    const before = f.state();
    assert.equal(await f.tools.remove("all"), false, kind);
    assert.equal(f.state(), before);
    assert.deepEqual(f.changes, []);
    assert.deepEqual(f.preferenceWrites, []);
    assert.equal(await f.tools.remove("all", true), true);
    assert.equal(f.state().drawings.length + f.state().images.length, 0);
    assert.ok(Object.values(f.state().preferences.indicators).every((value) => value === false));
  }
  const f = fixture({ drawingTools: { drawingsLocked: true, deleteLocked: true } });
  f.state().images[0].lock = true;
  assert.equal(await f.tools.remove("drawings"), true);
  assert.equal(f.state().drawings.length + f.state().images.length, 0);
});

test("indicator deletion disables every flag and records removal without touching locked drawings", async () => {
  const f = fixture({ drawingTools: { drawingsLocked: true, indicatorsLocked: true } });
  const drawings = f.state().drawings,
    images = f.state().images;
  assert.equal(await f.tools.remove("indicators"), false);
  assert.equal(f.state().drawings, drawings);
  assert.equal(f.state().images, images);
  assert.equal(await f.tools.remove("indicators", true), true);
  assert.deepEqual(json(f.state().preferences.indicators), flags());
  assert.deepEqual(
    [...f.state().preferences.chartSettings.removedIndicators].sort(),
    Object.keys(flags()).sort()
  );
  assert.equal(f.state().drawings, drawings);
  assert.equal(f.state().images, images);
  assert.deepEqual(f.changes, []);
});

test("rapid boolean toggles execute against the latest persisted state", async () => {
  for (const key of ["stayInDrawingMode", "snapIndicators", "deleteLocked"]) {
    const f = fixture();
    await Promise.all([f.tools.toggleOption(key), f.tools.toggleOption(key)]);
    assert.equal(f.options()[key], false, key);
  }
});

test("single locked deletion requests confirmation and rejects a stale confirmation", async () => {
  const f = fixture();
  f.state().drawings[0].lock = true;
  await f.tools.deleteObject("one");
  const pending = f.tools.pendingDeletion;
  assert.equal(pending.kind, "object");
  assert.equal(f.state().dialog, "delete-object");
  assert.equal(f.state().drawings.length, 2);
  assert.deepEqual(f.changes, []);
  f.update({ preferences: { ...f.state().preferences, instrumentUid: "uid-two" } });
  await f.tools.deleteObject("one", true, pending.scope);
  assert.deepEqual(f.changes, []);
  f.update({ preferences: { ...f.state().preferences, instrumentUid: "uid-one" } });
  await f.tools.deleteObject("one", true, pending.scope);
  assert.equal(f.state().drawings.length, 1);
  assert.equal(f.changes.length, 1);
});

test("a pending flush cannot delete after owner, symbol or same-symbol instrument changes", async () => {
  for (const scope of ["owner", "symbol", "uid"]) {
    const gate = deferred(),
      f = fixture({ flush: () => gate.promise });
    const pending = f.tools.remove("all", true);
    if (scope === "owner") f.update({ owner: "bob" });
    else
      f.update({
        preferences: {
          ...f.state().preferences,
          ...(scope === "symbol" ? { symbol: "TWO" } : { instrumentUid: "uid-two" })
        }
      });
    const afterSwitch = f.state();
    gate.resolve();
    await pending;
    assert.equal(f.state(), afterSwitch, scope);
    assert.deepEqual(f.changes, [], scope);
    assert.deepEqual(f.preferenceWrites, [], scope);
  }
});

const backup = (drawingTools) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  drawings: [],
  images: [],
  layout: { chartSettings: { drawingTools, removedIndicators: ["ma", "volume"] } }
});
test("backup accepts all toolbar settings and rejects malformed, unknown, hostile and oversized values", () => {
  const valid = {
    cursor: "demonstration",
    magnet: "off",
    magnetStrength: "strong",
    snapIndicators: true,
    stayInDrawingMode: true,
    drawingsHidden: true,
    indicatorsHidden: false,
    drawingsLocked: true,
    indicatorsLocked: false,
    hideTarget: "indicators",
    lockTarget: "drawings",
    deleteLocked: false,
    lastTools: { lines: "rayLine", fib: "fibonacciExtension", cursors: "arrow" },
    favorites: ["segment", "fibonacciLine"]
  };
  const document = backup(valid);
  assert.equal(validateBackup(document), document);
  assert.equal(isDrawingToolbarSettings(valid), true);
  assert.equal(isDrawingToolbarSettings({}), true);
  for (const invalid of [
    null,
    [],
    true,
    { cursor: "pointer" },
    { magnet: "medium" },
    { magnetStrength: "off" },
    { hideTarget: "images" },
    { lockTarget: 1 },
    { drawingsLocked: "true" },
    { snapIndicators: 1 },
    { favorites: "segment" },
    { lastTools: [] },
    { unknown: true },
    { token: "not-a-secret" },
    { favorites: ["../segment"] },
    { lastTools: { lines: "constructor" } },
    { favorites: ["__proto__"] },
    { favorites: Array(101).fill("segment") },
    {
      lastTools: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`group${i}`, "segment"]))
    },
    { favorites: ["x".repeat(101)] },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    JSON.parse('{"lastTools":{"__proto__":"segment"}}'),
    JSON.parse('{"lastTools":{"prototype":"segment"}}')
  ]) {
    assert.equal(isDrawingToolbarSettings(invalid), false, JSON.stringify(invalid));
    assert.throws(() => validateBackup(backup(invalid)), JSON.stringify(invalid));
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() =>
    validateBackup({
      ...document,
      layout: { chartSettings: { drawingTools: valid, removedIndicators: ["madeUp"] } }
    })
  );
});
