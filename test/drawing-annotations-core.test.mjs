import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { annotationLayout } = load("model/drawing-annotation-layout.ts");
const { annotationDefaults, isDrawingAnnotationSettings, ANNOTATION_TOOLS } = load(
  "model/drawing-annotation.ts"
);
const { drawingGeometry, drawingStyle, hitDrawing } = load("model/drawing-model.ts");
const { isDrawing, validateBackup } = load("model/backup-format.ts");
const { drawingPointCount } = load("model/drawing-tool-policy.ts");
const { encodeDrawingClipboard, parseObjectClipboard, copyDrawing, DrawingUndoHistory } = load(
  "model/drawing-editing.ts"
);
const { sanitizeDriveBackup } = load("services/drive/backup.ts");
const point = (timestamp, value) => ({ timestamp, value });
const project = ({ timestamp: x, value: y }) => ({ x, y });
const drawing = (name, settings = {}, points) => ({
  id: `test-${name}`,
  name,
  points:
    points ??
    (drawingPointCount(name) === 1 ? [point(100, 150)] : [point(100, 150), point(280, 80)]),
  settings: { ...annotationDefaults(name), ...settings }
});
const portable = (items) => ({
  application: "personal-terminal",
  schemaVersion: 2,
  drawings: [{ symbol: "GAZP", items }],
  images: []
});

test("all ten annotations validate with exact anchor counts and preserve old tools", () => {
  for (const name of ANNOTATION_TOOLS) {
    const item = drawing(name);
    assert.equal(isDrawing(item), true, name);
    assert.equal(isDrawing({ ...item, points: [...item.points, point(30, 50)] }), false, name);
  }
  assert.equal(isDrawing(drawing("segment")), true);
  assert.equal(isDrawing({ ...drawing("text"), name: "future-unknown" }), false);
  assert.equal(annotationDefaults("flag").annotation.screenAnchored, undefined);
  assert.deepEqual(annotationDefaults("table").annotation.table.cells, [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ]);
});

test("nested annotation settings reject malformed, unsafe, oversized and ragged input", () => {
  for (const invalid of [
    { width: 23 },
    { height: 1201 },
    { offsetX: Infinity },
    { screenX: -0.1 },
    { borderWidth: 6 },
    { backgroundColor: "url(secret)" },
    { bold: 1 },
    { borderStyle: "invalid" },
    { secret: "not portable" },
    { table: { cells: [] } },
    { table: { cells: [["a"], ["a", "b"]] } },
    { table: { cells: [["x".repeat(2001)]] } },
    { table: { cells: Array.from({ length: 21 }, () => [""]) } },
    { table: { cells: [[""]], columnWidths: [50, 50] } },
    { table: { cells: [["", ""]], columnWidths: [900, 900] } },
    { table: { cells: [[""]], rowHeights: [15] } },
    JSON.parse('{"__proto__":{}}')
  ])
    assert.equal(isDrawingAnnotationSettings(invalid), false, JSON.stringify(invalid));
  const getter = Object.defineProperty({}, "bold", {
    get() {
      assert.fail("getter executed");
    },
    enumerable: true
  });
  assert.equal(isDrawingAnnotationSettings(getter), false);
  assert.equal(isDrawing(drawing("text", { text: "x".repeat(10001) })), false);
  assert.equal(isDrawing(drawing("priceNote", { text: "" })), true);
});

test("multiline measured layout and picking share the actual text box", () => {
  const item = drawing("text", { text: "AAA\nBB", fontSize: 14, annotation: { bold: true } });
  const measureText = (text) => text.length * 20;
  const geometry = drawingGeometry(item, project, 800, 600, { measureText });
  assert.equal(geometry.annotation.body.right - geometry.annotation.body.left, 72);
  assert.equal(geometry.annotation.text.length, 2);
  assert.equal(geometry.annotation.font.bold, true);
  assert.deepEqual(hitDrawing([item], { x: 160, y: 175 }, project, 800, 600, 5, { measureText }), {
    id: item.id,
    handle: -1
  });
  assert.equal(hitDrawing([item], { x: 190, y: 175 }, project, 800, 600, 5, { measureText }), null);
  assert.equal(
    drawingStyle(drawing("note", { annotation: { bold: true } })).annotation.backgroundColor,
    "#ffffff"
  );
});

test("pin body expands only on selection or hover; flag never emits text", () => {
  const pin = drawing("pin", { text: "Visible on hover" });
  const collapsed = annotationLayout(pin, pin.points.map(project), 800, 600);
  assert.equal(collapsed.body, null);
  assert.equal(collapsed.text.length, 0);
  for (const option of [{ selected: true }, { hovered: true }]) {
    const expanded = annotationLayout(pin, pin.points.map(project), 800, 600, option);
    assert.ok(expanded.body);
    assert.equal(expanded.text[0].text, "Visible on hover");
  }
  const flag = drawing("flag", { text: "Must not render" });
  assert.equal(annotationLayout(flag, flag.points.map(project), 800, 600).text.length, 0);
});

test("own price is formatted independently of current candles and caption", () => {
  const formatPrice = (value) => value.toFixed(3);
  const note = drawing("priceNote", { text: "Entry" }, [point(100, 12.3456), point(280, 80)]);
  const layout = annotationLayout(note, note.points.map(project), 800, 600, { formatPrice });
  assert.equal(layout.price.font.size, 12);
  assert.equal(layout.price.text[0].text, "12.346");
  assert.equal(layout.text[0].text, "Entry");
  assert.equal(layout.font.size, 14);
  const multiline = drawing("priceNote", { text: "first\nsecond" }, note.points);
  const multilineLayout = drawingGeometry(multiline, project, 800, 600, {
    formatPrice,
    measureText: (text) => text.length * 10
  }).annotation;
  assert.deepEqual(
    multilineLayout.text.map((line) => line.text),
    ["first", "second"]
  );
  assert.ok(multilineLayout.text[1].y > multilineLayout.text[0].y);
  assert.equal(multilineLayout.price.text[0].text, "12.346");
  const label = drawing("priceLabel", { text: "ignored" }, [point(100, 45.6789)]);
  const labelLayout = drawingGeometry(label, project, 800, 600, { formatPrice }).annotation;
  assert.equal(labelLayout.text[0].text, "45.679");
  assert.equal(labelLayout.font.bold, true);
});

test("price note picking follows each caption's measured glyph width", () => {
  const measureText = (text) => text.length * 10;
  const wide = drawing("priceNote", { text: "hi", annotation: { width: 1600 } });
  const caption = drawingGeometry(wide, project, 2000, 1000, { measureText }).annotation.text[0];
  assert.equal(caption.maxWidth, 20);
  assert.equal(
    hitDrawing([wide], { x: 800, y: caption.y + 5 }, project, 2000, 1000, 4, { measureText }),
    null
  );
  assert.deepEqual(
    hitDrawing([wide], { x: caption.x + 5, y: caption.y + 5 }, project, 2000, 1000, 4, {
      measureText
    }),
    { id: wide.id, handle: -1 }
  );
  const wrapped = drawing("priceNote", {
    text: "abcdefghij",
    annotation: { width: 100, wrap: true }
  });
  const lines = drawingGeometry(wrapped, project, 800, 600, { measureText }).annotation.text;
  assert.deepEqual(
    lines.map((line) => line.text),
    ["abcdefgh", "ij"]
  );
  assert.deepEqual(
    lines.map((line) => line.maxWidth),
    [80, 20]
  );
  assert.equal(
    hitDrawing([wrapped], { x: lines[1].x + 30, y: lines[1].y + 5 }, project, 800, 600, 4, {
      measureText
    }),
    null
  );
});

test("price note captions avoid the own-price box on short leaders and near plot edges", () => {
  const measureText = (text) => Array.from(text).length * 7;
  const formatPrice = (value) => value.toFixed(2);
  const fixtures = [
    { caption: "Коротко", a: { x: 720, y: 320 }, b: { x: 800, y: 270 }, width: 1000, height: 600 },
    {
      caption: "first\nsecond",
      a: { x: 720, y: 320 },
      b: { x: 800, y: 270 },
      width: 1000,
      height: 600
    },
    { caption: "first\nsecond", a: { x: 15, y: 30 }, b: { x: 20, y: 14 }, width: 200, height: 140 },
    {
      caption: "first\nsecond",
      a: { x: 180, y: 125 },
      b: { x: 180, y: 124 },
      width: 200,
      height: 140
    }
  ];
  for (const fixture of fixtures) {
    const item = drawing("priceNote", { text: fixture.caption }, [
      point(1, 64437.2),
      point(2, 64000)
    ]);
    const projection = (point) => (point.timestamp === 1 ? fixture.a : fixture.b);
    const layout = drawingGeometry(item, projection, fixture.width, fixture.height, {
      measureText,
      formatPrice
    }).annotation;
    assert.deepEqual(layout.anchor, fixture.a);
    assert.equal(layout.price.text[0].text, "64437.20");
    assert.deepEqual(
      layout.text.map((line) => line.text),
      fixture.caption.split("\n")
    );
    for (const line of layout.text) {
      const bounds = {
        left: line.x - line.maxWidth / 2,
        right: line.x + line.maxWidth / 2,
        top: line.y,
        bottom: line.y + layout.font.size * 1.3
      };
      const price = layout.price.bounds;
      assert.ok(
        bounds.right <= price.left - 5 ||
          bounds.left >= price.right + 5 ||
          bounds.bottom <= price.top - 5 ||
          bounds.top >= price.bottom + 5,
        JSON.stringify({ bounds, price })
      );
      assert.ok(bounds.left >= 4 && bounds.right <= fixture.width - 4);
      assert.ok(bounds.top >= 4 && bounds.bottom <= fixture.height - 4);
      assert.equal(line.maxWidth, measureText(line.text));
      assert.equal(layout.font.size, 14);
      assert.deepEqual(
        hitDrawing(
          [item],
          { x: line.x, y: line.y + 5 },
          projection,
          fixture.width,
          fixture.height,
          4,
          { measureText, formatPrice }
        ),
        { id: item.id, handle: -1 }
      );
    }
  }
});

test("callout tail is selectable while surrounding empty space is not", () => {
  const item = drawing("callout", { text: "Box", annotation: { width: 100, height: 50 } }, [
    point(100, 150),
    point(300, 100)
  ]);
  const layout = drawingGeometry(item, project, 800, 600).annotation;
  assert.equal(layout.body.left, 250);
  assert.equal(layout.body.top, 75);
  assert.ok(layout.outline.length > 4);
  assert.deepEqual(hitDrawing([item], { x: 200, y: 129 }, project, 800, 600, 4), {
    id: item.id,
    handle: -1
  });
  assert.equal(hitDrawing([item], { x: 180, y: 90 }, project, 800, 600, 4), null);
});

test("table rows, columns, frame and full divider hits use structured dimensions", () => {
  const item = drawing("table", {
    annotation: {
      table: {
        cells: [
          ["a", "b"],
          ["c", "d"]
        ],
        columnWidths: [80, 120],
        rowHeights: [30, 40]
      }
    }
  });
  const layout = drawingGeometry(item, project, 800, 600).annotation;
  assert.equal(layout.cells.length, 4);
  assert.equal(layout.body.right - layout.body.left, 200);
  assert.equal(layout.body.bottom - layout.body.top, 70);
  assert.deepEqual(
    layout.handles.map((handle) => handle.index),
    [0, 1, 100, 200]
  );
  assert.deepEqual(
    hitDrawing([item], { x: 180, y: 160 }, project, 800, 600, 4, { selectedId: item.id }),
    { id: item.id, handle: 100 }
  );
  assert.deepEqual(
    hitDrawing([item], { x: 290, y: 180 }, project, 800, 600, 4, { selectedId: item.id }),
    { id: item.id, handle: 200 }
  );
  assert.deepEqual(hitDrawing([item], { x: 180, y: 185 }, project, 800, 600, 4), {
    id: item.id,
    handle: -1
  });
});

test("maximum table matrices retain every cell within bounded frames and screen extents", () => {
  const cells = Array.from({ length: 20 }, (_, row) =>
    Array.from({ length: 20 }, (_, column) => `${row}:${column}`)
  );
  const item = drawing("table", { annotation: { table: { cells } } });
  assert.equal(isDrawing(item), true);
  const natural = drawingGeometry(item, project, 2000, 1500).annotation;
  assert.equal(natural.cells.length, 400);
  assert.ok(natural.body.right - natural.body.left <= 1600);
  assert.ok(natural.body.bottom - natural.body.top <= 1200);
  const screen = drawing("table", {
    annotation: { screenAnchored: true, screenX: 1, screenY: 1, table: { cells } }
  });
  const small = drawingGeometry(screen, () => null, 320, 240).annotation;
  assert.equal(small.cells.length, 400);
  assert.ok(small.body.left >= 0 && small.body.top >= 0);
  assert.ok(small.body.right <= 320 && small.body.bottom <= 240);
  for (const cell of small.cells) {
    assert.ok(cell.bounds.left >= small.body.left - 1e-8);
    assert.ok(cell.bounds.right <= small.body.right + 1e-8);
    assert.ok(cell.bounds.bottom <= small.body.bottom + 1e-8);
  }
});

test("screen anchors survive missing projection and resize; signpost offset is not a second quote", () => {
  const item = drawing("table", {
    annotation: { screenAnchored: true, screenX: 0.25, screenY: 0.4, table: { cells: [["a"]] } }
  });
  assert.equal(drawingGeometry(item, () => null, 800, 600).annotation.body.left, 170);
  assert.equal(drawingGeometry(item, () => null, 400, 300).annotation.body.left, 70);
  const signpost = drawing("signpost", { annotation: { offsetX: 20, offsetY: -60 } });
  const geometry = drawingGeometry(signpost, project, 800, 600).annotation;
  assert.deepEqual(geometry.handles.find((handle) => handle.index === 1).point, { x: 120, y: 90 });
  assert.equal(signpost.points.length, 1);
  for (const screenX of [0, 0.5, 1])
    for (const screenY of [0, 0.5, 1]) {
      const anchored = drawing("table", {
        annotation: { screenAnchored: true, screenX, screenY, table: { cells: [["a"]] } }
      });
      const body = drawingGeometry(anchored, () => null, 800, 600).annotation.body;
      assert.equal(body.left, (800 - 120) * screenX);
      assert.equal(body.top, (600 - 34) * screenY);
    }
});

test("annotation metadata roundtrips portable backup, Drive, clipboard and undo", () => {
  const item = drawing("table", {
    annotation: {
      bold: true,
      borderStyle: "dashed",
      screenAnchored: true,
      screenX: 0.2,
      screenY: 0.3,
      table: { cells: [["a\nb", "c"]], columnWidths: [80, 120], rowHeights: [50] }
    }
  });
  assert.deepEqual(validateBackup(portable([item])).drawings[0].items[0], item);
  const drive = sanitizeDriveBackup(portable([item]));
  assert.deepEqual(drive.drawings[0].items[0].settings.annotation, item.settings.annotation);
  const clipboard = parseObjectClipboard(encodeDrawingClipboard(item, "token"));
  assert.deepEqual(clipboard.drawing, item);
  assert.equal(
    encodeDrawingClipboard(drawing("text", { annotation: { token: "secret" } }), "token"),
    null
  );
  const history = new DrawingUndoHistory();
  const before = {
    owner: "local",
    symbol: "GAZP",
    drawings: [item],
    images: [],
    selectedObject: item.id
  };
  const changed = structuredClone(item);
  changed.settings.annotation.table.cells[0][0] = "changed";
  history.record(before, { ...before, drawings: [changed] });
  assert.equal(history.undo(before).drawings[0].settings.annotation.table.cells[0][0], "a\nb");
  const copied = copyDrawing(
    item,
    { pointToPixel: project, pixelToPoint: (x, y) => point(x, y) },
    { x: 0, y: -40 }
  );
  assert.notEqual(copied.id, item.id);
  assert.deepEqual(copied.settings.annotation, item.settings.annotation);
  const shifted = copyDrawing(
    item,
    {
      pointToPixel: () => null,
      pixelToPoint: () => null,
      plotSize: () => ({ width: 1000, height: 700 })
    },
    { x: 80, y: -40 }
  );
  assert.deepEqual(shifted.points, item.points);
  assert.ok(Math.abs(shifted.settings.annotation.screenX - 0.3) < 1e-9);
  assert.ok(Math.abs(shifted.settings.annotation.screenY - (0.3 - 40 / 650)) < 1e-9);
  assert.notEqual(shifted.settings.annotation.table, item.settings.annotation.table);
  assert.notEqual(shifted.settings.annotation.table.cells, item.settings.annotation.table.cells);
  shifted.settings.annotation.table.cells[0][0] = "clone-only";
  shifted.settings.annotation.table.columnWidths[0] = 40;
  shifted.settings.annotation.table.rowHeights[0] = 25;
  assert.equal(item.settings.annotation.table.cells[0][0], "a\nb");
  assert.equal(item.settings.annotation.table.columnWidths[0], 80);
  assert.equal(item.settings.annotation.table.rowHeights[0], 50);
});
