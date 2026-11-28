import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({ "i18n/messages.ts": { t: (value) => value } });
const { drawingGeometry, hitDrawing, paintDrawings } = load("model/drawing-model.ts");
const { drawingSupportsFill } = load("model/drawing-tool-policy.ts");
const { editDrawingAnchors } = load("model/drawing-anchor-edit.ts");
const { createDrawingInput } = load("screens/terminal/chart-drawing-touch.ts");
const { isDrawing, validateBackup } = load("model/backup-format.ts");
const { encodeDrawingClipboard, parseObjectClipboard, DrawingUndoHistory } = load(
  "model/drawing-editing.ts"
);
const project = ({ timestamp, value }) => ({ x: timestamp, y: value });
const projection = {
  pointToPixel: project,
  pixelToPoint: (timestamp, value) => ({ timestamp, value })
};
const reference = [
  { timestamp: 0, value: 313 },
  { timestamp: 149, value: 49 },
  { timestamp: 405, value: 369 }
];
const drawing = (settings = {}, points = reference) => ({
  id: "arc-fixture",
  name: "arc",
  points,
  settings: { color: "#e040fb", fill: true, opacity: 0.35, lineOpacity: 0.8, ...settings }
});
const geometry = (item, projector = project) => drawingGeometry(item, projector, 2000, 2000);
const near = (actual, expected) => {
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6);
};

test("reference Arc stretches a 60-degree ellipse segment with a control on the chord normal", () => {
  const item = drawing(),
    before = structuredClone(item),
    result = geometry(item),
    shape = result.shape,
    path = shape.paths[0];
  near(path.points[0], project(reference[0]));
  near(path.points.at(-1), project(reference[1]));
  near(path.points[(path.points.length - 1) / 2], result.points[2]);
  const midpoint = { x: 74.5, y: 181 };
  assert.ok(Math.hypot(reference[2].timestamp - midpoint.x, reference[2].value - midpoint.y) > 370);
  assert.ok(Math.hypot(reference[0].timestamp - midpoint.x, reference[0].value - midpoint.y) < 160);
  assert.equal(path.closed, false);
  assert.equal(path.fillClosed, true);
  assert.equal(shape.lines.length, path.points.length - 1, "no synthetic chord hit segment");
  assert.ok(shape.lines.length <= 512);
  assert.deepEqual(item, before, "rendering never rewrites stored anchors or settings");
  const normalFixture = [
    { timestamp: 0, value: 0 },
    { timestamp: 200, value: 0 },
    { timestamp: 350, value: 80 }
  ];
  const constrained = geometry(drawing({}, normalFixture));
  near(constrained.points[2], { x: 100, y: 80 });
  const samples = constrained.shape.paths[0].points,
    quarter = samples[(samples.length - 1) / 4];
  near(quarter, { x: 48.23619097949585, y: 59.653352397580036 });
  assert.ok(quarter.x > 45, "a half-ellipse would put its quarter near x=29.3");
});

test("Arc reprojects its visible control onto the normal after axis zoom without rewriting stored data", () => {
  const item = drawing(),
    before = structuredClone(item);
  for (const transform of [
    ({ x, y }) => ({ x: x * 3 + 1e8, y: y * 2 - 5e7 }),
    ({ x, y }) => ({ x: x / 5, y: y / 7 })
  ]) {
    const changed = geometry(item, (point) => transform(project(point))),
      [a, b, control] = changed.points,
      stored = transform(project(reference[2])),
      middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      tangent = { x: b.x - a.x, y: b.y - a.y };
    near(changed.shape.paths[0].points[(changed.shape.paths[0].points.length - 1) / 2], control);
    assert.ok(
      Math.abs((control.x - middle.x) * tangent.x + (control.y - middle.y) * tangent.y) < 1e-4
    );
    assert.ok(
      Math.abs((stored.x - control.x) * -tangent.y + (stored.y - control.y) * tangent.x) < 1e-4
    );
    assert.ok(changed.lines.length <= 512);
  }
  assert.deepEqual(item, before);
});

test("Arc control dragging ignores tangential movement and endpoint edits preserve signed screen height", () => {
  const original = [
    { timestamp: 0, value: 0 },
    { timestamp: 200, value: 0 },
    { timestamp: 100, value: 80 }
  ];
  const tangential = editDrawingAnchors(
    "arc",
    original,
    [original[0], original[1], { timestamp: 450, value: 80 }],
    2,
    projection
  );
  assert.deepEqual(tangential, original);
  const higher = editDrawingAnchors(
    "arc",
    original,
    [original[0], original[1], { timestamp: 450, value: 180 }],
    2,
    projection
  );
  assert.deepEqual(higher[2], { timestamp: 100, value: 180 });
  const endpoint = editDrawingAnchors(
    "arc",
    original,
    [{ timestamp: 0, value: 100 }, original[1], original[2]],
    0,
    projection
  );
  near(project(endpoint[2]), { x: 100 + 80 / Math.sqrt(5), y: 50 + 160 / Math.sqrt(5) });
  const reversed = editDrawingAnchors(
    "arc",
    original,
    [original[0], { timestamp: 0, value: 200 }, original[2]],
    1,
    projection
  );
  near(project(reversed[2]), { x: -80, y: 100 });
  const translated = original.map((p) => ({ timestamp: p.timestamp + 30, value: p.value + 50 }));
  assert.deepEqual(editDrawingAnchors("arc", original, translated, -1, projection), translated);
  const unavailable = { ...projection, pixelToPoint: () => null };
  assert.deepEqual(editDrawingAnchors("arc", original, translated, 2, unavailable), translated);
});

test("Arc creation and preview commit the constrained control instead of the tangential pointer", () => {
  const state = { activeTool: "arc", preferences: { chartSettings: {} } },
    drawings = [];
  let preview;
  const input = createDrawingInput(
    {
      chart: projection,
      getSnapshot: () => state,
      setPreview: (value) => {
        preview = value;
      },
      addDrawing: (item) => drawings.push(item),
      notify: (message) => assert.fail(message)
    },
    ({ x, y }) => ({ timestamp: x, value: y })
  );
  const event = { pointerType: "mouse", pointerId: 1, preventDefault() {}, stopPropagation() {} };
  input.down(event, { x: 0, y: 0 });
  input.down(event, { x: 200, y: 0 });
  input.move(event, { x: 400, y: 80 });
  assert.deepEqual(preview.points[2], { timestamp: 100, value: 80 });
  input.down(event, { x: 400, y: 80 });
  assert.equal(drawings.length, 1);
  assert.deepEqual(drawings[0].points[2], { timestamp: 100, value: 80 });
});

test("collinear, coincident and unfinished Arc anchors produce a finite unfilled segment", () => {
  for (const points of [
    [reference[0], reference[1]],
    [
      { timestamp: 10, value: 10 },
      { timestamp: 30, value: 30 },
      { timestamp: 90, value: 90 }
    ],
    [
      { timestamp: 10, value: 10 },
      { timestamp: 10, value: 10 },
      { timestamp: 90, value: 90 }
    ],
    [
      { timestamp: 10, value: 10 },
      { timestamp: 30, value: 10 },
      { timestamp: 20, value: 10 + 1e-9 }
    ]
  ]) {
    const shape = geometry(drawing({}, points)).shape;
    assert.equal(shape.lines.length, 1);
    assert.equal(shape.paths[0].fillClosed, undefined);
    assert.ok(shape.paths[0].points.every((point) => Number.isFinite(point.x + point.y)));
  }
});

test("Arc interior is selectable only when its chord-bounded fill is visible", () => {
  const interior = { x: 239.75, y: 275 },
    chordMiddle = { x: 74.5, y: 181 };
  assert.deepEqual(hitDrawing([drawing()], interior, project, 2000, 2000), {
    id: "arc-fixture",
    handle: -1
  });
  for (const settings of [{ fill: false }, { opacity: 0 }]) {
    assert.equal(hitDrawing([drawing(settings)], interior, project, 2000, 2000), null);
    assert.equal(hitDrawing([drawing(settings)], chordMiddle, project, 2000, 2000), null);
  }
  assert.equal(hitDrawing([drawing()], { x: -100, y: 300 }, project, 2000, 2000), null);
  reference.forEach((point, handle) => {
    assert.equal(hitDrawing([drawing()], project(point), project, 2000, 2000).handle, handle);
  });
  const outline = geometry(drawing()).shape.paths[0].points[70];
  assert.equal(hitDrawing([drawing({ fill: false })], outline, project, 2000, 2000).handle, -1);
});

function painted(settings) {
  const commands = [],
    ctx = new Proxy(
      { measureText: () => ({ width: 20 }) },
      {
        get: (target, key) =>
          target[key] ??
          ((...args) =>
            commands.push({
              method: key,
              args,
              alpha: target.globalAlpha,
              fill: target.fillStyle,
              stroke: target.strokeStyle
            })),
        set: (target, key, value) => {
          target[key] = value;
          return true;
        }
      }
    );
  paintDrawings(ctx, [drawing(settings)], project, 2000, 2000, null);
  return commands;
}

test("Arc exposes existing fill settings and paints chord-bounded background with an open stroke", () => {
  assert.equal(drawingSupportsFill("arc"), true);
  assert.equal(drawingSupportsFill("quadraticCurve"), false);
  const commands = painted({ text: "Arc caption" }),
    fill = commands.find((command) => command.method === "fill"),
    stroke = commands.find((command) => command.method === "stroke");
  assert.equal(fill.fill, "#e040fb");
  assert.equal(fill.alpha, 0.35);
  assert.equal(stroke.stroke, "#e040fb");
  assert.equal(stroke.alpha, 0.8);
  assert.equal(commands.filter((command) => command.method === "closePath").length, 0);
  assert.ok(commands.indexOf(fill) < commands.indexOf(stroke));
  assert.ok(
    commands.some((command) => command.method === "fillText" && command.args[0] === "Arc caption")
  );
  assert.equal(
    painted({ fill: false }).some((command) => command.method === "fill"),
    false
  );
  assert.equal(painted({ opacity: 0 }).find((command) => command.method === "fill").alpha, 0);
});

test("legacy Arc records preserve anchors, text and style across backup, clipboard and undo", () => {
  const legacy = drawing({ text: "Saved", width: 3 }),
    copy = structuredClone(legacy);
  assert.equal(isDrawing(legacy), true);
  const backup = validateBackup({
    application: "personal-terminal",
    schemaVersion: 1,
    drawings: [{ symbol: "SBER", items: [legacy] }],
    images: [],
    history: []
  });
  assert.deepEqual(backup.drawings[0].items[0], legacy);
  const pasted = parseObjectClipboard(encodeDrawingClipboard(legacy, "arc-roundtrip")).drawing;
  assert.deepEqual(pasted, legacy);
  const history = new DrawingUndoHistory(),
    scope = { owner: "fixture", symbol: "SBER" },
    before = { ...scope, drawings: [legacy], images: [], selectedObject: legacy.id },
    moved = { ...legacy, points: legacy.points.map((p) => ({ ...p, value: p.value + 10 })) };
  history.record(before, { ...before, drawings: [moved] });
  assert.deepEqual(history.undo(scope).drawings, [legacy]);
  assert.deepEqual(history.redo(scope).drawings, [moved]);
  geometry(pasted);
  assert.deepEqual(legacy, copy);
});
