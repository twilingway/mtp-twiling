import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

function fixture(persist = async () => {}, saveView = async () => {}) {
  const writes = [],
    notices = [],
    options = [];
  const load = sourceLoader({
    "i18n/messages.ts": { t: (value) => value },
    "screens/terminal/workspace-annotations.ts": {
      writeWorkspaceAnnotations: async (value) => {
        writes.push(
          structuredClone({ drawings: value.drawings, owner: value.owner, symbol: value.symbol })
        );
        await persist();
      },
      subscribeWorkspaceAnnotations: () => () => {}
    }
  });
  const { TerminalDrawingCreation, drawingCreationState } = load(
    "screens/terminal/drawing-creation-draft.ts"
  );
  const { drawingPreviewState } = load("screens/terminal/drawing-settings-preview.ts");
  const { TerminalEditing } = load("screens/terminal/controller-editing.ts");
  const { TerminalDrawingTools } = load("screens/terminal/controller-drawing-tools.ts");
  const { ChartSettingsCommands } = load("screens/terminal/controller-chart-settings.ts");
  const { addControllerDrawing } = load("screens/terminal/controller-drawing-create.ts");
  const { annotationDefaults } = load("model/drawing-annotation.ts");
  let state = {
    owner: "alice",
    authenticated: true,
    chartRevision: 0,
    activeTool: "text",
    dialog: null,
    preferences: {
      symbol: "ONE",
      instrumentUid: "one",
      timeframe: "1h",
      engine: "lightweight",
      chartSettings: {}
    },
    rows: [],
    drawings: [],
    images: [],
    selectedObject: null,
    preview: null
  };
  const listeners = new Set();
  const update = (patch) => {
    state = drawingCreationState(drawingPreviewState({ ...state, ...patch }));
    listeners.forEach((listener) => listener());
  };
  const controller = {
    sessionKey: () => null,
    saveView,
    getSnapshot: () => state,
    update,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: (message) => notices.push(message),
    setTool: (tool) => {
      controller.editing.cancelGesture();
      update({ activeTool: tool, preview: null, selectedObject: null, contextMenu: null });
    },
    setDrawings: (drawings) => controller.editing.change({ drawings })
  };
  controller.editing = new TerminalEditing({
    getState: () => state,
    getChart: () => null,
    update,
    notify: controller.notify
  });
  controller.addDrawing = (drawing) => addControllerDrawing(controller, drawing);
  const chartSettings = new ChartSettingsCommands(controller, () => true);
  controller.setChartSettings = (patch, valid) =>
    chartSettings.setOrdinary(
      patch,
      async (settings) => {
        options.push(settings);
        update({ preferences: { ...state.preferences, chartSettings: settings } });
      },
      valid
    );
  controller.drawingCreation = new TerminalDrawingCreation({
    getState: () => state,
    update,
    addDrawing: controller.addDrawing,
    isAlive: () => true
  });
  controller.tools = new TerminalDrawingTools(controller);
  const begin = (name = "text", text = "Сохранённая подпись\n第二行") => {
    controller.setTool(name);
    const settings = { ...annotationDefaults(name), text };
    if (name === "table") settings.annotation.table.cells[0][0] = text;
    const drawing = {
      id: crypto.randomUUID(),
      name,
      points: ["note", "callout"].includes(name)
        ? [
            { timestamp: 1700000000000, value: 42 },
            { timestamp: 1700003600000, value: 43 }
          ]
        : [{ timestamp: 1700000000000, value: 42 }],
      settings
    };
    const token = controller.drawingCreation.begin(drawing);
    assert.ok(token);
    return { token, drawing };
  };
  return { controller, begin, update, state: () => state, writes, notices, options, listeners };
}

for (const name of ["text", "note", "pin", "table", "callout", "comment", "signpost"]) {
  test(`${name}: choosing cursor commits content once; undo/redo preserves anchors and content`, async () => {
    const f = fixture(),
      { drawing } = f.begin(name);
    await f.controller.tools.setCursor("crosshair");
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.state().drawings, [drawing]);
    assert.equal(f.state().activeTool, null);
    assert.equal(f.state().drawingCreationDraft, null);
    assert.equal(f.state().dialog, null);
    await f.controller.editing.undo();
    assert.deepEqual(f.state().drawings, []);
    await f.controller.editing.redo();
    assert.deepEqual(f.state().drawings, [drawing]);
  });
}

test("choosing a different drawing tool first commits the current annotation", async () => {
  const f = fixture(),
    { drawing } = f.begin("note");
  await f.controller.tools.choose("rectangle");
  assert.deepEqual(f.state().drawings, [drawing]);
  assert.equal(f.state().activeTool, "rectangle");
  assert.equal(f.writes.length, 1);
});

test("blank new text does not persist an invisible object on cursor selection", async () => {
  const f = fixture();
  f.begin("text", "  \n");
  await f.controller.tools.setCursor("dot");
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.state().drawings, []);
  assert.equal(f.state().activeTool, null);
});

test("explicit cancellation followed by cursor selection writes nothing", async () => {
  const f = fixture(),
    { token } = f.begin();
  f.controller.drawingCreation.cancel(token);
  await f.controller.tools.setCursor("crosshair");
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.state().drawings, []);
});

for (const field of ["owner", "symbol", "timeframe", "engine", "chartRevision"]) {
  test(`a ${field} change during persistence cannot apply the old cursor intent`, async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const f = fixture(() => gate);
    f.begin();
    const pending = f.controller.tools.setCursor("dot");
    await Promise.resolve();
    f.update(
      field === "owner" || field === "chartRevision"
        ? {
            [field]: field === "owner" ? "bob" : 1,
            activeTool: "ellipse",
            drawings: [],
            dialog: null
          }
        : {
            preferences: { ...f.state().preferences, [field]: "changed" },
            activeTool: "ellipse",
            drawings: [],
            dialog: null
          }
    );
    release();
    await pending;
    assert.equal(f.state().activeTool, "ellipse");
    assert.equal(f.options.length, 0);
    assert.deepEqual(f.state().drawings, []);
    assert.equal(f.listeners.size, 0);
  });
}

test("racing Save and cursor selection creates one object and one undo step", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture(() => gate),
    { token, drawing } = f.begin();
  const saved = f.controller.drawingCreation.commit(token, drawing);
  const switched = f.controller.tools.setCursor("crosshair");
  release();
  await Promise.all([saved, switched]);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.state().drawings, [drawing]);
  await f.controller.editing.undo();
  assert.deepEqual(f.state().drawings, []);
});

test("storage failure stays visible, surfaces failure, and does not switch the tool", async () => {
  const f = fixture(async () => {
      throw new Error("Disk unavailable");
    }),
    { drawing } = f.begin();
  await assert.rejects(f.controller.tools.setCursor("dot"), /Disk unavailable/);
  assert.deepEqual(f.state().drawings, [drawing]);
  assert.equal(f.state().activeTool, "text");
  assert.equal(f.options.length, 0);
  assert.ok(f.notices.some((value) => /Disk unavailable/.test(value)));
});

for (const method of ["cursor", "save"]) {
  test(`a new annotation draft survives completion of an older ${method}`, async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const f = fixture(() => gate),
      old = f.begin("text", "Old");
    const pending =
      method === "cursor"
        ? f.controller.tools.setCursor("dot")
        : f.controller.drawingCreation.commit(old.token, old.drawing);
    await Promise.resolve();
    const fresh = f.begin("text", "New");
    release();
    await pending;
    assert.equal(f.state().activeTool, "text");
    assert.equal(f.state().dialog, "annotation-editor");
    assert.equal(f.state().drawingCreationDraft?.token, fresh.token);
    assert.equal(f.state().preview?.id, fresh.drawing.id);
    assert.deepEqual(f.state().drawings, [old.drawing]);
    assert.equal(f.writes.length, 1);
  });
}

test("an import during delayed camera save cannot be overwritten by the old cursor settings", async () => {
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const f = fixture(undefined, () => {
    started();
    return gate;
  });
  f.begin();
  const pending = f.controller.tools.setCursor("dot");
  await entered;
  f.update({ importingBackup: true });
  const imported = { cursor: "crosshair", drawingsLocked: true, drawingsHidden: true };
  f.update({
    importingBackup: false,
    chartRevision: 1,
    preferences: { ...f.state().preferences, chartSettings: { drawingTools: imported } }
  });
  release();
  await pending;
  assert.deepEqual(f.state().preferences.chartSettings.drawingTools, imported);
  assert.equal(f.options.length, 0);
  assert.equal(f.listeners.size, 0);
});
