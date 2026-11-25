import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
function sourceModules(storage) {
  const context = vm.createContext({
    structuredClone,
    crypto,
    Blob,
    console,
    EventTarget,
    Event,
    AbortController,
    AbortSignal,
    DOMException,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout
  });
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    const key = path.relative(sourceRoot, filename).replaceAll(path.sep, "/");
    if (key === "services/storage.ts") return storage;
    if (key === "services/storage-db.ts")
      return new Proxy({}, { get: () => () => assert.fail("unexpected direct IndexedDB access") });
    assert.ok(!key.startsWith("../"));
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) =>
        load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return { load };
}
const drawing = () => ({
  id: "original",
  name: "fibonacciLine",
  title: "Styled",
  lock: true,
  visible: true,
  layer: "front",
  points: [
    { timestamp: 100, value: 100 },
    { timestamp: 200, value: 400 }
  ],
  settings: {
    text: "Label",
    color: "#123456",
    width: 3,
    extendRight: true,
    levelStyles: [{ value: 0.618, enabled: true, color: "#abcdef", text: "Golden" }]
  },
  visibility: { minutes: { enabled: true, from: 1, to: 59 } }
});
const chart = {
  pointToPixel: (point) => ({ x: point.timestamp, y: Math.sqrt(point.value) * 10 }),
  pixelToPoint: (x, y) => ({ timestamp: x, value: (y / 10) ** 2 }),
  plotSize: () => ({ width: 1000, height: 500 })
};
const json = (value) => JSON.parse(JSON.stringify(value));
function fixture({ saveDocument = async () => {} } = {}) {
  let state = {
    owner: "alice",
    preferences: { symbol: "ONE" },
    drawings: [drawing()],
    images: [],
    selectedObject: "original"
  };
  const writes = [],
    notices = [];
  const modules = sourceModules({
    saveAnnotationDocument: async (owner, symbol, items, images) => {
      await saveDocument(owner, symbol, items, images);
      writes.push({ owner, symbol, drawings: json(items), images });
    },
    savePreferences: async () => {}
  });
  const { TerminalEditing } = modules.load("screens/terminal/controller-editing.ts");
  const editing = new TerminalEditing({
    getState: () => state,
    getChart: () => chart,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    notify: (message) => notices.push(message)
  });
  return {
    editing,
    modules,
    writes,
    notices,
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    }
  };
}

test("copy preserves every setting and uses chart pixel projection on nonlinear prices", () => {
  const { load } = sourceModules({}),
    model = load("model/drawing-editing.ts"),
    original = drawing();
  const copy = model.copyDrawing(original, chart, { x: 0, y: -40 });
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.points[0].value, 36);
  assert.equal(copy.points[1].value, 256);
  assert.deepEqual(json({ ...copy, id: original.id, points: original.points }), original);
  copy.settings.levelStyles[0].text = "Changed";
  assert.equal(original.settings.levelStyles[0].text, "Golden");
  assert.equal(
    model.copyDrawing(original, { ...chart, pointToPixel: () => null }, { x: 0, y: -40 }),
    null
  );
});

test("clipboard validates version, shape and unknown secret-bearing fields", () => {
  const model = sourceModules({}).load("model/drawing-editing.ts");
  const text = model.encodeDrawingClipboard(drawing(), "nonce");
  assert.deepEqual(json(model.parseObjectClipboard(text).drawing), drawing());
  for (const value of [
    "<img src=x>",
    "ordinary text",
    "x".repeat(270000),
    JSON.stringify({ ...JSON.parse(text), version: 2 }),
    JSON.stringify({ ...JSON.parse(text), tokenSecret: "private" }),
    JSON.stringify({
      ...JSON.parse(text),
      drawing: { ...drawing(), settings: { token: "private" } }
    }),
    JSON.stringify({
      ...JSON.parse(text),
      drawing: { ...drawing(), points: [{ timestamp: -1, value: 5 }] }
    })
  ]) {
    assert.equal(model.parseObjectClipboard(value), null);
  }
  assert.equal(model.encodeDrawingClipboard({ ...drawing(), token: "private" }, "nonce"), null);
});

test("one drag is one undo from its initial snapshot, cancel leaves no history or storage", async () => {
  const f = fixture(),
    original = json(f.state().drawings);
  const token = f.editing.beginGesture();
  for (let i = 1; i <= 10; i++)
    f.editing.previewGesture(token, {
      drawings: [
        {
          ...drawing(),
          points: [
            { timestamp: 100 + i, value: 100 },
            { timestamp: 200 + i, value: 400 }
          ]
        }
      ]
    });
  assert.equal(f.writes.length, 0);
  await f.editing.finishGesture(token);
  assert.equal(f.writes.length, 1);
  await f.editing.undo();
  assert.deepEqual(json(f.state().drawings), original);
  await f.editing.undo();
  assert.equal(f.writes.length, 2);
  await f.editing.redo();
  assert.equal(f.state().drawings[0].points[0].timestamp, 110);
  const before = json(f.state().drawings),
    count = f.writes.length;
  const canceled = f.editing.beginGesture();
  f.editing.previewGesture(canceled, { drawings: [] });
  f.editing.cancelGesture();
  await f.editing.finishGesture(canceled);
  assert.deepEqual(json(f.state().drawings), before);
  assert.equal(f.writes.length, count);
});

test("history scopes symbols, retains Blob references and resets redo after new operation", async () => {
  const f = fixture(),
    original = json(f.state().drawings);
  await f.editing.clone(drawing());
  const onOne = f.state().drawings;
  f.update({ preferences: { symbol: "TWO" }, drawings: [], selectedObject: null });
  await f.editing.undo();
  assert.equal(f.state().drawings.length, 0);
  f.update({ preferences: { symbol: "ONE" }, drawings: onOne });
  await f.editing.undo();
  assert.deepEqual(json(f.state().drawings), original);
  await f.editing.change({ drawings: [] });
  await f.editing.redo();
  assert.equal(f.state().drawings.length, 0);
  const blob = new Blob(["binary"], { type: "image/png" });
  const image = {
    id: "image",
    syncId: "old-sync",
    owner: "alice",
    symbol: "ONE",
    name: "image",
    blob,
    point: { timestamp: 30, value: 100 },
    width: 200,
    lock: true,
    visible: false,
    zOrder: 4
  };
  await f.editing.setImages([image]);
  await f.editing.clone(image);
  const copied = f.state().images[1];
  assert.equal(copied.blob, blob);
  assert.notEqual(copied.syncId, image.syncId);
  assert.notEqual(copied.id, image.id);
  assert.equal(copied.lock, true);
  await f.editing.undo();
  assert.equal(f.state().images.length, 1);
  await f.editing.redo();
  assert.equal(f.state().images[1].blob, blob);
});

test("cross-symbol drawing and image paste use normalized geometry, fresh IDs, and new scope", async () => {
  const f = fixture(),
    text = f.editing.copySelected();
  assert.equal(f.editing.acceptsClipboard(text), true);
  f.update({ preferences: { symbol: "TWO" }, drawings: [], selectedObject: null });
  await f.editing.paste(text);
  const pasted = f.state().drawings[0];
  assert.notEqual(pasted.id, "original");
  assert.deepEqual(json(pasted.settings), drawing().settings);
  const blob = new Blob(["private pixels"], { type: "image/png" });
  const image = {
    id: "image",
    syncId: "sync",
    owner: "alice",
    symbol: "TWO",
    blob,
    name: "private.png",
    width: 200,
    point: { timestamp: 200, value: 400 }
  };
  await f.editing.setImages([image]);
  f.update({ selectedObject: image.id });
  const imageText = f.editing.copySelected();
  assert.equal(imageText.includes("private"), false);
  assert.equal(imageText.includes("alice"), false);
  f.update({ preferences: { symbol: "THREE" }, drawings: [], images: [], selectedObject: null });
  await f.editing.paste(imageText);
  assert.equal(f.state().images[0].owner, "alice");
  assert.equal(f.state().images[0].symbol, "THREE");
  assert.equal(f.state().images[0].blob, blob);
  f.editing.reset();
  assert.equal(f.editing.acceptsClipboard(text), false);
  assert.equal(f.editing.acceptsClipboard(imageText), false);
  assert.equal(await f.editing.paste(imageText), false);
  const count = f.writes.length;
  await f.editing.undo();
  assert.equal(f.writes.length, count);
});

test("history has no arbitrary command cap", () => {
  const model = sourceModules({}).load("model/drawing-editing.ts"),
    history = new model.DrawingUndoHistory();
  let previous = { owner: "alice", symbol: "ONE", drawings: [], images: [], selectedObject: null };
  for (let i = 0; i < 1200; i++) {
    const next = { ...previous, drawings: [{ ...drawing(), title: String(i) }] };
    history.record(previous, next);
    previous = next;
  }
  for (let i = 0; i < 1200; i++) assert.ok(history.undo(previous));
  assert.equal(history.undo(previous), null);
});

test("commands derived from a live drag cannot commit its provisional coordinates", async () => {
  const f = fixture();
  const clipboard = f.editing.copySelected();
  const token = f.editing.beginGesture();
  const moved = {
    ...drawing(),
    points: [
      { timestamp: 999, value: 100 },
      { timestamp: 1099, value: 400 }
    ]
  };
  f.editing.previewGesture(token, { drawings: [moved] });
  await f.editing.change({ drawings: [{ ...moved, title: "Menu edit from preview" }] });
  assert.deepEqual(json(f.state().drawings), [drawing()]);
  assert.equal(f.writes.length, 0);
  const second = f.editing.beginGesture();
  f.editing.previewGesture(second, { drawings: [moved] });
  await f.editing.paste(clipboard);
  assert.deepEqual(json(f.state().drawings[0]), drawing());
  assert.equal(f.state().drawings.length, 2);
  await f.editing.undo();
  assert.deepEqual(json(f.state().drawings), [drawing()]);
});

test("owner change atomically clears restored gesture objects and their clipboard/history", async () => {
  const f = fixture(),
    { TerminalController } = f.modules.load("screens/terminal/controller.ts");
  const controller = new TerminalController();
  controller.update({
    owner: "alice",
    drawings: [drawing()],
    images: [],
    selectedObject: "original"
  });
  const text = controller.editing.copySelected();
  const token = controller.editing.beginGesture();
  controller.editing.previewGesture(token, { drawings: [{ ...drawing(), title: "Provisional" }] });
  controller.update({ drawings: [], images: [] }); // Session activation clears the chart first.
  controller.update({
    owner: "bob",
    name: "Bob",
    preferences: { ...controller.getSnapshot().preferences, symbol: "TWO" }
  });
  assert.equal(controller.getSnapshot().owner, "bob");
  assert.equal(controller.getSnapshot().drawings.length, 0);
  assert.equal(controller.getSnapshot().images.length, 0);
  assert.equal(controller.getSnapshot().selectedObject, null);
  assert.equal(controller.editing.acceptsClipboard(text), false);
  await controller.undoDrawings();
  assert.equal(controller.getSnapshot().drawings.length, 0);
});

test("symbol change waits for durable annotation writes before switching and loading", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ saveDocument: async () => gate });
  const { TerminalController } = f.modules.load("screens/terminal/controller.ts"),
    controller = new TerminalController();
  const pending = controller.setDrawings([drawing()]);
  const switching = controller.setPreferences({ symbol: "TWO" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.getSnapshot().preferences.symbol, "GAZP");
  assert.equal(f.writes.length, 0);
  release();
  await pending;
  await switching;
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].symbol, "GAZP");
  assert.equal(controller.getSnapshot().preferences.symbol, "TWO");
});

test("undo first cancels an unfinished drawing without undoing the previous completed object", async () => {
  const f = fixture(),
    { TerminalController } = f.modules.load("screens/terminal/controller.ts"),
    controller = new TerminalController();
  await controller.setDrawings([drawing()]);
  controller.setTool("segment");
  controller.setPreview({ id: "preview", name: "segment", points: [{ timestamp: 1, value: 1 }] });
  await controller.undoDrawings();
  assert.equal(controller.getSnapshot().drawings.length, 1);
  assert.equal(controller.getSnapshot().activeTool, null);
  assert.equal(controller.getSnapshot().preview, null);
  await controller.undoDrawings();
  assert.equal(controller.getSnapshot().drawings.length, 0);
});

test("failed document writes stay visible across other scopes until full same-scope resync", async () => {
  let fail = true;
  const saved = new Map();
  const f = fixture({
    saveDocument: async (owner, symbol, drawings, images) => {
      if (fail) {
        fail = false;
        throw new Error("disk full");
      }
      saved.set(`${owner}:${symbol}`, { drawings, images });
    }
  });
  const image = {
    id: "deleted",
    owner: "alice",
    symbol: "ONE",
    name: "pic",
    blob: new Blob(["pic"]),
    width: 200,
    point: { timestamp: 10, value: 100 }
  };
  f.update({ images: [image] });
  await assert.rejects(f.editing.setImages([]));
  await assert.rejects(f.editing.flush());
  f.update({ preferences: { symbol: "TWO" }, drawings: [], images: [] });
  await f.editing.change({ drawings: [drawing()] });
  await assert.rejects(f.editing.flush());
  f.update({ preferences: { symbol: "ONE" }, drawings: [drawing()], images: [] });
  await f.editing.change({ drawings: [{ ...drawing(), title: "Resync" }] });
  await f.editing.flush();
  assert.equal(saved.get("alice:ONE").images.length, 0);
  assert.equal(f.notices.length, 1);
});
