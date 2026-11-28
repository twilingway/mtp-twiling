import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({ "i18n/messages.ts": { t: (value) => value } });
const { drawingGeometry, hitDrawing, paintDrawings } = load("model/drawing-model.ts");
const { isDrawing, validateBackup } = load("model/backup-format.ts");
const { encodeDrawingClipboard, parseObjectClipboard, DrawingUndoHistory, copyDrawing } = load(
  "model/drawing-editing.ts"
);
const { assertReadableDrivePayload } = load("services/drive/reader-guard.ts");
const { prepareDriveBackup, restoreDriveBackup } = load("services/drive/backup.ts");
const { drawingPriceTargets } = load("model/drawing-price-labels.ts");
const { DrawingStrokeSampler } = load("model/drawing-stroke-sampler.ts");
const { preservePolylineClosure } = load("model/drawing-anchor-edit.ts");
const { createDrawingInput } = load("screens/terminal/chart-drawing-touch.ts");
const { TOOLBAR_GROUPS, rememberedToolbarTool } = load("screens/terminal/toolbar-registry.ts");
const counts = {
  brush: 2,
  highlighter: 2,
  arrowPointer: 2,
  arrow: 2,
  arrowUp: 1,
  arrowDown: 1,
  rotatedRectangle: 3,
  path: 2,
  circle: 2,
  ellipse: 2,
  polyline: 2,
  triangle: 3,
  arc: 3,
  quadraticCurve: 3,
  cubicCurve: 4
};
const project = ({ timestamp, value }) => ({ x: timestamp, y: value });
const anchors = [
  { timestamp: 50, value: 50 },
  { timestamp: 150, value: 50 },
  { timestamp: 100, value: 120 },
  { timestamp: 130, value: 130 }
];
const drawing = (name, points = anchors.slice(0, counts[name])) => ({
  id: name,
  name,
  points,
  settings: {
    text: "Figure",
    textColor: "#3355aa",
    textAlign: "center",
    textVertical: "center",
    fill: true,
    opacity: 0.4,
    width: 3,
    lineStyle: "dashed"
  }
});
const backup = (items) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  drawings: [{ symbol: "SBER", items }],
  images: [],
  history: []
});

test("every shape is enabled and survives backup, Drive, clipboard, clone and undo", async () => {
  const enabled = TOOLBAR_GROUPS.find((group) => group.id === "shapes")
    .sections.flatMap((section) => section.items)
    .map((item) => item.tool);
  assert.equal(enabled.length, 16);
  assert.ok(enabled.every(Boolean));
  const allIds = TOOLBAR_GROUPS.flatMap((group) =>
    group.sections.flatMap((section) => section.items)
  ).map((item) => item.id);
  assert.equal(
    new Set(allIds).size,
    allIds.length,
    "drawing arrow and cursor arrow have distinct favourite IDs"
  );
  assert.equal(
    rememberedToolbarTool(
      TOOLBAR_GROUPS.find((group) => group.id === "shapes"),
      { shapes: "arrow" }
    ).tool,
    "arrow"
  );
  for (const name of Object.keys(counts)) {
    const item = drawing(name);
    assert.equal(isDrawing(item), true, name);
    assert.deepEqual(validateBackup(backup([item])).drawings[0].items[0], item);
    const { payload } = await prepareDriveBackup(backup([item]));
    const remote = assertReadableDrivePayload(JSON.parse(await payload.text()));
    assert.deepEqual(remote.drawings[0].items[0], item);
    assert.deepEqual((await restoreDriveBackup(payload, [])).drawings[0].items[0], item);
    const pasted = parseObjectClipboard(encodeDrawingClipboard(item, "fixture"));
    assert.equal(pasted.drawing.name, name);
    assert.deepEqual(pasted.drawing.points, item.points);
    assert.deepEqual(pasted.drawing.settings, item.settings);
    const clone = copyDrawing(
      item,
      { pointToPixel: project, pixelToPoint: (timestamp, value) => ({ timestamp, value }) },
      { x: 8, y: 10 }
    );
    assert.notEqual(clone.id, item.id);
    assert.equal(clone.points[0].timestamp, 58);
    const history = new DrawingUndoHistory(),
      scope = { owner: "owner", symbol: "SBER" };
    const before = { ...scope, drawings: [item], images: [], selectedObject: item.id };
    assert.equal(history.record(before, { ...before, drawings: [clone] }), true);
    assert.deepEqual(history.undo(scope).drawings, [item]);
    assert.deepEqual(history.redo(scope).drawings, [clone]);
    const wrong = { ...item, points: item.points.slice(0, -1) };
    assert.equal(isDrawing(wrong), false, name);
  }
  const oversized = drawing(
    "brush",
    Array.from({ length: 2049 }, () => anchors[0])
  );
  assert.equal(isDrawing(oversized), false);
  assert.equal(
    isDrawing({ ...drawing("circle"), points: [{ timestamp: 1, value: NaN }, anchors[1]] }),
    false
  );
});

test("circle remains round after nonlinear anchor projection; ellipse follows its bounding corners", () => {
  const circle = drawingGeometry(
    drawing("circle"),
    (point) => ({ x: point.timestamp * 2, y: point.value * 3 }),
    500,
    500
  ).shape;
  assert.equal(circle.bounds.right - circle.bounds.left, circle.bounds.bottom - circle.bounds.top);
  const ellipse = drawingGeometry(
    drawing("ellipse", [anchors[0], { timestamp: 150, value: 100 }]),
    project,
    500,
    500
  ).shape;
  assert.equal(ellipse.bounds.right - ellipse.bounds.left, 100);
  assert.ok(Math.abs(ellipse.bounds.bottom - ellipse.bounds.top - 50) < 0.1);
});

test("rotated rectangle projects its width onto the base normal and hits only its actual interior", () => {
  const item = drawing("rotatedRectangle", [
    { timestamp: 50, value: 50 },
    { timestamp: 150, value: 150 },
    { timestamp: 20, value: 80 }
  ]);
  const shape = drawingGeometry(item, project, 500, 500).shape;
  assert.deepEqual(
    shape.paths[0].points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    [
      { x: 50, y: 50 },
      { x: 150, y: 150 },
      { x: 120, y: 180 },
      { x: 20, y: 80 }
    ]
  );
  assert.equal(hitDrawing([item], { x: 85, y: 115 }, project, 500, 500).handle, -1);
  assert.equal(hitDrawing([item], { x: 140, y: 80 }, project, 500, 500), null);
});

test("arc goes through its third anchor, has a straight collinear fallback; Beziers bend toward their controls", () => {
  const arc = drawingGeometry(
    drawing("arc", [anchors[0], anchors[1], { timestamp: 100, value: 100 }]),
    project,
    500,
    500
  );
  assert.ok(arc.shape.paths[0].points.some((p) => Math.hypot(p.x - 100, p.y - 100) < 2));
  assert.ok(
    hitDrawing(
      [drawing("arc", [anchors[0], anchors[1], { timestamp: 100, value: 100 }])],
      { x: 100, y: 100 },
      project,
      500,
      500
    )
  );
  const flat = drawingGeometry(
    drawing("arc", [anchors[0], anchors[1], { timestamp: 100, value: 50 }]),
    project,
    500,
    500
  );
  assert.equal(flat.lines.length, 1);
  for (const name of ["quadraticCurve", "cubicCurve"]) {
    const g = drawingGeometry(drawing(name), project, 500, 500);
    assert.deepEqual(g.shape.paths[0].points[0], project(anchors[0]));
    assert.deepEqual(g.shape.paths[0].points.at(-1), project(anchors[1]));
    assert.ok(g.shape.bounds.bottom > 80);
    assert.ok(g.lines.length <= 512);
  }
});

test("arrow kinds have distinct geometry and all tools paint configured captions", () => {
  const pointer = drawingGeometry(drawing("arrowPointer"), project, 500, 500);
  const arrow = drawingGeometry(drawing("arrow"), project, 500, 500);
  assert.equal(pointer.shape.paths[0].closed, true);
  assert.equal(arrow.shape.paths.length, 2);
  assert.equal(arrow.shape.paths[0].closed, false);
  assert.equal(drawingGeometry(drawing("path"), project, 500, 500).shape.paths.length, 2);
  for (const name of Object.keys(counts)) {
    const texts = [],
      fills = [];
    const ctx = new Proxy(
      {
        measureText: () => ({ width: 30 }),
        fillText: (text) => texts.push(text),
        fill: () => fills.push(true)
      },
      {
        get: (target, key) => target[key] ?? (() => {}),
        set: (target, key, value) => {
          target[key] = value;
          return true;
        }
      }
    );
    paintDrawings(ctx, [drawing(name)], project, 500, 500, name, 13);
    assert.deepEqual(texts, ["Figure"], name);
    if (
      [
        "circle",
        "ellipse",
        "triangle",
        "rotatedRectangle",
        "arrowPointer",
        "arrowUp",
        "arrowDown"
      ].includes(name)
    )
      assert.ok(fills.length, name);
  }
});

function inputFixture(name) {
  const state = { activeTool: name, preferences: { chartSettings: {} } },
    drawings = [],
    captures = new Set();
  let preview;
  const input = createDrawingInput(
    {
      getSnapshot: () => state,
      setPreview: (value) => {
        preview = value;
      },
      addDrawing: (item) => drawings.push(item),
      notify: (value) => assert.fail(value)
    },
    ({ x, y }) => ({ timestamp: x, value: y })
  );
  const element = {
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id)
  };
  const event = (pointerType = "mouse", pointerId = 1) => ({
    currentTarget: element,
    pointerType,
    pointerId,
    preventDefault() {},
    stopPropagation() {}
  });
  return { input, event, drawings, captures, preview: () => preview };
}

test("freehand sampling is bounded, preserves exact endpoints and leaves its body draggable", () => {
  const sampler = new DrawingStrokeSampler();
  for (let i = 0; i < 10000; i++)
    sampler.add({ timestamp: i * 2, value: i % 100 }, { x: i * 2, y: i % 100 });
  sampler.add({ timestamp: 20001, value: 99 }, { x: 20001, y: 99 }, true);
  assert.ok(sampler.points().length <= 2048);
  assert.equal(sampler.points()[0].timestamp, 0);
  assert.equal(sampler.points().at(-1).timestamp, 20001);
  const item = drawing("brush", [
    { timestamp: 10, value: 50 },
    { timestamp: 80, value: 50 },
    { timestamp: 150, value: 50 }
  ]);
  assert.equal(hitDrawing([item], { x: 80, y: 50 }, project, 500, 500).handle, -1);
  assert.equal(drawingPriceTargets([], item).length, 2);
  const f = inputFixture("brush");
  f.input.down(f.event(), { x: 10, y: 50 });
  f.input.move(f.event(), { x: 100, y: 60 });
  assert.equal(f.input.up(f.event("mouse", 2), { x: 150, y: 70 }), false);
  f.input.up(f.event(), { x: 151, y: 71 });
  assert.equal(f.drawings.length, 1);
  assert.deepEqual(f.drawings[0].points.at(-1), { timestamp: 151, value: 71 });
  assert.equal(f.captures.size, 0);
  f.input.down(f.event(), { x: 10, y: 10 });
  f.input.cancel();
  assert.equal(f.preview(), null);
  assert.equal(f.captures.size, 0);
});

test("path completion excludes the hover point, polyline closes on its first vertex; multistep tools commit once", () => {
  const f = inputFixture("path");
  f.input.down(f.event(), { x: 20, y: 20 });
  assert.equal(f.input.finish(), false);
  f.input.down(f.event(), { x: 100, y: 100 });
  f.input.move(f.event(), { x: 200, y: 200 });
  assert.equal(f.input.finish(), true);
  assert.equal(f.drawings[0].points.length, 2);
  assert.equal(f.input.finish(), false);
  const closed = inputFixture("polyline");
  for (const p of [
    { x: 20, y: 20 },
    { x: 100, y: 20 },
    { x: 100, y: 100 },
    { x: 21, y: 21 }
  ])
    closed.input.down(closed.event("touch"), p);
  assert.deepEqual(closed.drawings[0].points[0], closed.drawings[0].points.at(-1));
  const original = closed.drawings[0].points;
  const edited = original.map((point, index) =>
    index === 0 ? { ...point, timestamp: 30 } : point
  );
  const moved = preservePolylineClosure("polyline", original, edited, 0);
  assert.deepEqual(moved[0], moved.at(-1));
  assert.equal(original[0].timestamp, 20);
  assert.equal(drawingGeometry(closed.drawings[0], project, 500, 500).shape.paths[0].closed, true);
  for (const [name, count] of Object.entries(counts).filter(
    ([name]) => !["brush", "highlighter", "path", "polyline"].includes(name)
  )) {
    const g = inputFixture(name);
    for (const point of anchors.slice(0, count)) g.input.down(g.event(), project(point));
    assert.equal(g.drawings.length, 1, name);
    assert.equal(g.drawings[0].points.length, count, name);
  }
});
