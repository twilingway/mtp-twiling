import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
const load = sourceLoader({ "i18n/messages.ts": { t: (value) => value } });
const { TerminalDrawingCreation, drawingCreationState } = load(
  "screens/terminal/drawing-creation-draft.ts"
);
const { createDrawingInput } = load("screens/terminal/chart-drawing-touch.ts");
const { dragChartDrawing, annotationScreenSettings } = load(
  "screens/terminal/chart-drawing-drag.ts"
);
const { annotationDefaults } = load("model/drawing-annotation.ts");
const { drawingGeometry } = load("model/drawing-model.ts");
const { resizeAnnotationTable, updateAnnotationCell } = load(
  "screens/terminal/drawings/annotation-editor-model.ts"
);
const json = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  let state = {
    owner: "alice",
    authenticated: true,
    chartRevision: 0,
    activeTool: "text",
    dialog: null,
    preferences: {
      symbol: "ONE",
      instrumentUid: "one",
      timeframe: "1m",
      engine: "kline",
      chartSettings: {}
    },
    rows: [],
    drawings: [],
    images: []
  };
  const writes = [],
    history = [];
  const update = (patch) => {
    state = drawingCreationState({ ...state, ...patch });
  };
  const creation = new TerminalDrawingCreation({
    getState: () => state,
    update,
    isAlive: () => true,
    addDrawing: async (drawing) => {
      history.push(state.drawings);
      update({ drawings: [...state.drawings, drawing] });
      writes.push(drawing);
    }
  });
  const drawing = {
    id: "new",
    name: "text",
    points: [{ timestamp: 1700000000000, value: 42 }],
    settings: { text: "Hello" }
  };
  return { creation, drawing, update, state: () => state, writes, history };
}
test("creation previews stay out of portable drawings; first Save inserts once and cancellation writes zero", async () => {
  const f = fixture(),
    original = f.state().drawings,
    token = f.creation.begin(f.drawing);
  assert.ok(token);
  const candidate = { ...f.drawing, settings: { text: "One\nTwo", annotation: { bold: true } } };
  assert.equal(f.creation.preview(token, candidate), true);
  assert.equal(f.state().drawings, original);
  assert.equal(f.state().preview.settings.text, "One\nTwo");
  assert.equal(f.writes.length, 0);
  assert.equal(await f.creation.commit(token, candidate), true);
  assert.equal(await f.creation.commit(token, candidate), false);
  assert.equal(f.writes.length, 1);
  assert.equal(f.history.length, 1);
  assert.deepEqual(json(f.history[0]), []);
  assert.equal(f.state().drawingCreationDraft, null);
  assert.equal(f.state().dialog, null);
  const cancel = fixture();
  cancel.creation.cancel(cancel.creation.begin(cancel.drawing));
  assert.equal(cancel.writes.length, 0);
  assert.deepEqual(cancel.state().drawings, []);
});
test("every document/chart scope change invalidates creation without any write", async () => {
  for (const patch of [
    (s) => ({ owner: "bob" }),
    (s) => ({ activeTool: "note" }),
    (s) => ({ chartRevision: 1 }),
    (s) => ({ importingBackup: true }),
    (s) => ({ dialog: null }),
    ...["symbol", "instrumentUid", "timeframe", "engine"].map((key) => (s) => ({
      preferences: { ...s.preferences, [key]: "changed" }
    }))
  ]) {
    const f = fixture(),
      token = f.creation.begin(f.drawing);
    f.update(patch(f.state()));
    assert.equal(f.state().drawingCreationDraft, null);
    assert.equal(f.state().preview, null);
    assert.equal(await f.creation.commit(token, f.drawing), false);
    assert.equal(f.writes.length, 0);
  }
});
test("empty text can be edited but cannot be saved as invisible creation", async () => {
  const f = fixture(),
    empty = { ...f.drawing, settings: { text: "  \n" } },
    token = f.creation.begin(empty);
  assert.ok(token);
  assert.equal(await f.creation.commit(token, empty), false);
  assert.equal(f.writes.length, 0);
});

test("placement cancellation on window blur preserves the active editor preview, while a scope change clears it", () => {
  const f = fixture(),
    token = f.creation.begin(f.drawing);
  const preview = f.state().preview;
  const input = createDrawingInput(
    { getSnapshot: f.state, setPreview: (value) => f.update({ preview: value }) },
    () => null
  );
  input.cancel();
  assert.equal(f.state().preview, preview);
  assert.equal(f.state().drawingCreationDraft.token, token);
  assert.equal(f.writes.length, 0);
  f.update({ preferences: { ...f.state().preferences, symbol: "OTHER" } });
  input.cancel();
  assert.equal(f.state().preview, null);
  assert.equal(f.state().drawingCreationDraft, null);
  assert.equal(f.writes.length, 0);
});
test("structured table resize preserves surviving values and enforces cell/whole table text budget", () => {
  const initial = {
    cells: [
      ["A", "B"],
      ["C", "D"]
    ],
    columnWidths: [80, 100],
    rowHeights: [24, 36]
  };
  const enlarged = resizeAnnotationTable(initial, 3, 3);
  assert.deepEqual(json(enlarged.cells), [
    ["A", "B", ""],
    ["C", "D", ""],
    ["", "", ""]
  ]);
  assert.deepEqual(json(resizeAnnotationTable(enlarged, 1, 1)), {
    cells: [["A"]],
    columnWidths: [80],
    rowHeights: [24]
  });
  assert.equal(updateAnnotationCell(initial, 0, 0, "x".repeat(3000)).cells[0][0].length, 2000);
  const full = {
    cells: [
      Array.from({ length: 10 }, () => "x".repeat(2000)),
      ["", "", "", "", "", "", "", "", "", ""]
    ]
  };
  assert.equal(updateAnnotationCell(full, 1, 0, "ignored").cells[1][0], "");
});
test("single click signpost opens unsaved editor with one price anchor and vertical screen offset; flag commits directly", () => {
  for (const tool of ["signpost", "flag"]) {
    const created = [],
      drafts = [],
      state = { activeTool: tool, preferences: { chartSettings: {} } };
    const controller = {
      getSnapshot: () => state,
      chart: { plotSize: () => ({ width: 800, height: 400 }) },
      setPreview() {},
      drawingCreation: { begin: (drawing) => drafts.push(drawing) },
      addDrawing: (drawing) => created.push(drawing),
      notify: assert.fail
    };
    const input = createDrawingInput(controller, ({ x, y }) => ({ timestamp: x, value: y }));
    input.down(
      { pointerId: 1, pointerType: "mouse", preventDefault() {}, stopPropagation() {} },
      { x: 200, y: 100 }
    );
    const drawing = (tool === "flag" ? created : drafts)[0];
    assert.equal(drawing.points.length, 1);
    assert.equal(created.length, tool === "flag" ? 1 : 0);
    if (tool === "signpost") assert.ok(drawing.settings.annotation.offsetY < 0);
    else assert.equal(drawing.settings.annotation.screenX, 0.25);
  }
});

test("table frame/divider drags preserve data anchors, enforce cell sizes, and screen dragging tracks pixels", () => {
  const chart = {
    plotSize: () => ({ width: 1000, height: 600 }),
    pointToPixel: ({ timestamp, value }) => ({ x: timestamp, y: value }),
    pixelToPoint: (x, y) => ({ timestamp: x, value: y })
  };
  const original = {
    id: "table",
    name: "table",
    points: [{ timestamp: 100, value: 200 }],
    settings: annotationDefaults("table")
  };
  const active = (handle, drawing = original) => ({
    original: drawing,
    handle,
    start: { x: 0, y: 0 },
    id: drawing.id,
    pixels: [{ x: 100, y: 200 }],
    clone: false,
    cloneId: null
  });
  const resized = dragChartDrawing(active(1), { x: 80, y: 40 }, chart, () => null, null);
  assert.equal(resized.settings.annotation.width, 440);
  assert.equal(resized.settings.annotation.height, 142);
  assert.equal(resized.points, original.points);
  const columns = dragChartDrawing(active(100), { x: 1000, y: 0 }, chart, () => null, null);
  assert.deepEqual(json(columns.settings.annotation.table.columnWidths), [216, 24, 120]);
  const rows = dragChartDrawing(active(200), { x: 0, y: 1000 }, chart, () => null, null);
  assert.deepEqual(json(rows.settings.annotation.table.rowHeights), [52, 16, 34]);
  const anchored = {
    ...original,
    settings: {
      ...original.settings,
      annotation: {
        ...original.settings.annotation,
        screenAnchored: true,
        screenX: 0.5,
        screenY: 0.5
      }
    }
  };
  const moved = dragChartDrawing(active(-1, anchored), { x: 64, y: 49.8 }, chart, () => null, null);
  assert.equal(moved.settings.annotation.screenX, 0.6);
  assert.equal(moved.settings.annotation.screenY, 0.6);
  assert.equal(moved.points, anchored.points);
  const settings = annotationScreenSettings(original, chart);
  const layout = drawingGeometry(
    {
      ...original,
      settings: {
        ...original.settings,
        annotation: { ...original.settings.annotation, ...settings, screenAnchored: true }
      }
    },
    chart.pointToPixel,
    1000,
    600
  ).annotation;
  assert.equal(layout.body.left, 100);
  assert.equal(layout.body.top, 200);
});

test("signpost label handle changes only screen offset and its anchor drag preserves offset", () => {
  const chart = {
    plotSize: () => ({ width: 1000, height: 600 }),
    pointToPixel: ({ timestamp, value }) => ({ x: timestamp, y: value }),
    pixelToPoint: (x, y) => ({ timestamp: x, value: y })
  };
  const original = {
    id: "sign",
    name: "signpost",
    points: [{ timestamp: 100, value: 200 }],
    settings: annotationDefaults("signpost")
  };
  const active = {
    original,
    handle: 1,
    start: { x: 0, y: 0 },
    id: original.id,
    pixels: [{ x: 100, y: 200 }],
    clone: false,
    cloneId: null
  };
  const moved = dragChartDrawing(active, { x: 20, y: -30 }, chart, () => null, null);
  assert.equal(moved.settings.annotation.offsetX, 20);
  assert.equal(moved.settings.annotation.offsetY, -90);
  assert.equal(moved.points, original.points);
  const anchored = dragChartDrawing(
    { ...active, handle: 0 },
    { x: 20, y: -30 },
    chart,
    ({ x, y }) => ({ timestamp: x, value: y }),
    null
  );
  assert.deepEqual(json(anchored.points), [{ timestamp: 120, value: 170 }]);
  assert.equal(anchored.settings.annotation.offsetY, -60);
});
