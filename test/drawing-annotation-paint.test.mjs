import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { paintDrawings, drawingGeometry, hitDrawing } = load("model/drawing-model.ts");
const { annotationMeasureText } = load("model/drawing-annotation-measure.ts");
const { drawingPointCount } = load("model/drawing-tool-policy.ts");
const { TOOLBAR_GROUPS, toolbarToolAvailable } = load("screens/terminal/toolbar-registry.ts");
const tools = [
  "text",
  "note",
  "priceNote",
  "pin",
  "table",
  "callout",
  "comment",
  "priceLabel",
  "signpost",
  "flag"
];
const project = ({ timestamp, value }) => ({ x: timestamp, y: value });
const options = { measureText: annotationMeasureText, formatPrice: (value) => value.toFixed(7) };

function item(name, settings = {}) {
  return {
    id: name,
    name,
    points: [
      { timestamp: 60, value: 80.1234567 },
      { timestamp: 160, value: 120 }
    ].slice(0, drawingPointCount(name)),
    settings: { color: "#ffcc00", text: "First\nSecond", ...settings }
  };
}

function paint(drawing, selected = null, extraOptions = {}) {
  const calls = [];
  const ctx = new Proxy(
    {
      measureText() {
        assert.fail("painting must use the same shared measurement source as hit testing");
      }
    },
    {
      get(target, key) {
        return (
          target[key] ??
          ((...args) => {
            calls.push({
              method: key,
              args,
              font: target.font,
              color: target.fillStyle,
              stroke: target.strokeStyle,
              alpha: target.globalAlpha,
              baseline: target.textBaseline
            });
          })
        );
      }
    }
  );
  paintDrawings(ctx, [drawing], project, 600, 400, selected, 5, { ...options, ...extraOptions });
  return calls;
}

test("all ten annotation menu entries are enabled and content tools keep their capabilities", () => {
  const rows = TOOLBAR_GROUPS.find((group) => group.id === "annotation").sections.flatMap(
    (section) => section.items
  );
  assert.deepEqual(
    rows.filter((row) => row.tool).map((row) => row.tool),
    tools
  );
  for (const tool of tools) assert.ok(toolbarToolAvailable(rows.find((row) => row.tool === tool)));
  assert.equal(rows.find((row) => row.referenceId === "LineToolNote").tool, "pin");
  assert.equal(rows.find((row) => row.referenceId === "LineToolImage").image, true);
  for (const referenceId of ["LineToolTweet", "LineToolIdea"])
    assert.equal(toolbarToolAvailable(rows.find((row) => row.referenceId === referenceId)), false);
});

test("annotation painter draws the exact body used for hit testing and keeps CSS font size", () => {
  for (const tool of tools) {
    const drawing = item(tool, {
      fontSize: 22,
      annotation: {
        bold: true,
        italic: true,
        ...(tool === "table" ? { table: { cells: [["Cell"]] } } : {})
      }
    });
    const geometry = drawingGeometry(drawing, project, 600, 400, { ...options, selected: true });
    const layout = geometry.annotation;
    assert.ok(layout, tool);
    const calls = paint(drawing, drawing.id);
    if (layout.body && layout.background && !layout.outline && tool !== "priceNote") {
      const { left, top, right, bottom } = layout.body;
      assert.ok(
        calls.some(
          (call) =>
            (call.method === "fillRect" || call.method === "roundRect") &&
            JSON.stringify(call.args.slice(0, 4)) ===
              JSON.stringify([left, top, right - left, bottom - top])
        ),
        tool
      );
    }
    const text = calls.filter((call) => call.method === "fillText");
    if (tool !== "flag") {
      assert.ok(text.length > 0, tool);
      assert.ok(
        text.every(
          (call) => /22px /.test(call.font) || (tool === "priceNote" && /12px /.test(call.font))
        ),
        tool
      );
      assert.ok(
        text.every((call) => call.baseline === "top"),
        tool
      );
    }
    const bounds = layout.body ?? layout.bounds;
    const hit = hitDrawing(
      [drawing],
      { x: bounds.left + 2, y: bounds.top + 2 },
      project,
      600,
      400,
      0,
      { ...options, selectedId: drawing.id }
    );
    // The body itself is selectable, including transparent text padding.
    if (layout.body) assert.equal(hit?.id ?? hit?.drawing?.id, drawing.id, tool);
  }
});

test("pin text paints on selection or hover and hides away; flag always paints a fixed blue marker", () => {
  assert.equal(paint(item("pin")).filter((call) => call.method === "fillText").length, 0);
  assert.ok(paint(item("pin"), "pin").some((call) => call.method === "fillText"));
  assert.ok(
    paint(item("pin"), null, { hoveredId: "pin" }).some((call) => call.method === "fillText")
  );
  assert.equal(
    paint(item("pin"), null, { hoveredId: "another" }).filter((call) => call.method === "fillText")
      .length,
    0
  );
  const calls = paint(
    item("flag", { color: "#ff0000", annotation: { backgroundColor: "#00ff00" } })
  );
  assert.equal(calls.filter((call) => call.method === "fillText").length, 0);
  assert.ok(
    calls.some((call) => call.method === "fill" && call.color === "#2962ff" && call.alpha === 1)
  );
});

test("price labels render their own anchor with the supplied instrument precision", () => {
  const drawing = item("priceLabel", { text: "never a quote", fontSize: 18 });
  const values = paint(drawing)
    .filter((call) => call.method === "fillText")
    .map((call) => call.args[0]);
  assert.deepEqual(values, ["80.1234567"]);
  assert.ok(
    paint(drawing)
      .filter((call) => call.method === "fillText")
      .every((call) => /bold 18px /.test(call.font))
  );
});

test("price note separates automatic 12px price from the user caption", () => {
  const drawing = item("priceNote", { text: "Entry plan" });
  const text = paint(drawing).filter((call) => call.method === "fillText");
  const price = text.find((call) => call.args[0] === "80.1234567");
  const caption = text.find((call) => call.args[0] === "Entry plan");
  assert.ok(price && caption);
  assert.match(price.font, /12px /);
  assert.equal(price.color, "#ffffff");
  assert.match(caption.font, /14px /);
  assert.notEqual(price.args[2], caption.args[2]);
});

test("callout paints the shared filled pointer polygon instead of a connector stroke", () => {
  const drawing = item("callout", { text: "Callout" });
  const layout = drawingGeometry(drawing, project, 600, 400, options).annotation;
  assert.ok(layout.outline?.some((point) => point.x === 60 && point.y === 80.1234567));
  const calls = paint(drawing);
  assert.ok(calls.some((call) => call.method === "fill"));
  assert.equal(calls.filter((call) => call.method === "stroke").length, 1);
  assert.ok(
    calls.some(
      (call) =>
        ["moveTo", "lineTo"].includes(call.method) &&
        call.args[0] === 60 &&
        call.args[1] === 80.1234567
    )
  );
});

test("annotation text opacity is independent of background and border styling", () => {
  const drawing = item("note", {
    textColor: "#12abcd",
    annotation: {
      backgroundColor: "#234567",
      backgroundOpacity: 0.2,
      borderColor: "#765432",
      borderOpacity: 0.35,
      borderWidth: 3
    }
  });
  const calls = paint(drawing);
  assert.ok(
    calls.some(
      (call) =>
        ["fillRect", "fill"].includes(call.method) && call.color === "#234567" && call.alpha === 0.2
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        ["strokeRect", "stroke"].includes(call.method) &&
        call.stroke === "#765432" &&
        call.alpha === 0.35
    )
  );
  assert.ok(
    calls
      .filter((call) => call.method === "fillText")
      .every((call) => call.color === "#12abcd" && call.alpha === 1)
  );
});

test("plain text has no visible background by default and accepts an optional styled box", () => {
  assert.equal(
    paint(item("text")).some((call) => call.method === "fillRect" && call.alpha > 0),
    false
  );
  const calls = paint(
    item("text", {
      annotation: {
        backgroundColor: "#123456",
        backgroundOpacity: 0.4,
        borderColor: "#654321",
        borderWidth: 2
      }
    })
  );
  assert.ok(
    calls.some(
      (call) => call.method === "fillRect" && call.color === "#123456" && call.alpha === 0.4
    )
  );
  assert.ok(calls.some((call) => call.method === "strokeRect" && call.stroke === "#654321"));
});

test("table painting preserves empty multiline spacing inside individual cells", () => {
  const drawing = item("table", {
    fontSize: 20,
    annotation: {
      table: {
        cells: [
          ["A\n\nB", ""],
          ["C", "D"]
        ],
        rowHeights: [100, 40]
      }
    }
  });
  const text = paint(drawing).filter((call) => call.method === "fillText");
  const a = text.find((call) => call.args[0] === "A");
  const b = text.find((call) => call.args[0] === "B");
  assert.ok(a && b);
  assert.ok(b.args[2] - a.args[2] >= 40);
  assert.ok(text.some((call) => call.args[0] === "C"));
  assert.ok(text.some((call) => call.args[0] === "D"));
});

test("table grid strokes shared borders once so opacity stays uniform", () => {
  const drawing = item("table", {
    annotation: {
      borderOpacity: 0.35,
      table: {
        cells: [
          ["A", "B"],
          ["C", "D"]
        ]
      }
    }
  });
  const strokes = paint(drawing).filter((call) => call.method === "stroke");
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].alpha, 0.35);
});

test("selected table and signpost paint the shared resize and offset handles", () => {
  for (const tool of ["table", "signpost"]) {
    const drawing = item(tool);
    const layout = drawingGeometry(drawing, project, 600, 400, options).annotation;
    const handles = paint(drawing, drawing.id)
      .filter((call) => call.method === "arc")
      .map((call) => call.args.slice(0, 2));
    assert.deepEqual(
      handles,
      layout.handles.map(({ point }) => [point.x, point.y])
    );
  }
});
