import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { paintDrawings, TOOL_NAMES } = load("model/drawing-model.ts");
const { drawingPointCount } = load("model/drawing-tool-policy.ts");
const { validateBackup } = load("model/backup-format.ts");
const { assertReadableDrivePayload } = load("services/drive/reader-guard.ts");
const { prepareDriveBackup, restoreDriveBackup } = load("services/drive/backup.ts");
const { encodeDrawingClipboard, parseObjectClipboard } = load("model/drawing-editing.ts");
const { defaultVisibility, initialSettings, settingsCandidate } = load(
  "screens/terminal/drawings/drawing-settings-model.ts"
);

const note = "Area";
const lineColor = "#3355aa";
const textColor = "#f23645";
const rectPoints = [
  { timestamp: 25, value: 25 },
  { timestamp: 225, value: 175 }
];
const project = ({ timestamp, value }) => ({ x: timestamp, y: value });

function drawing(name, settings = {}) {
  const count = drawingPointCount(name) ?? 2;
  const points = [
    ...rectPoints,
    { timestamp: 100, value: 210 },
    { timestamp: 180, value: 80 }
  ].slice(0, count);
  return {
    id: name,
    name,
    points,
    settings: { color: lineColor, text: note, labels: false, prices: false, ...settings }
  };
}

function paint(item) {
  const text = [],
    outline = [];
  const sink = new Proxy(
    {
      fillText(value, x, y) {
        text.push([
          value,
          this.fillStyle,
          this.globalAlpha,
          this.textAlign,
          this.textBaseline,
          x,
          y,
          this.font
        ]);
      },
      strokeRect() {
        outline.push(this.strokeStyle);
      },
      measureText: () => ({ width: 24 })
    },
    {
      get(target, key) {
        return target[key] ?? (() => {});
      }
    }
  );
  paintDrawings(sink, [item], project, 250, 200, null);
  return { text, outline };
}

test("rectangle text uses its center and selected edges with independent size and color", () => {
  const fontSize = 72;
  for (const [textAlign, x] of [
    ["left", 29],
    ["center", 125],
    ["right", 221]
  ])
    for (const [textVertical, baseline, y] of [
      ["top", "top", 29],
      ["center", "middle", 100],
      ["bottom", "bottom", 171]
    ]) {
      const { text, outline } = paint(
        drawing("rectangle", { textAlign, textVertical, fontSize, textColor, lineOpacity: 0.3 })
      );
      assert.deepEqual(outline, [lineColor]);
      assert.deepEqual(text[0].slice(0, 7), [note, textColor, 1, textAlign, baseline, x, y]);
      assert.match(text[0][7], /^72px /);
    }
});

test("all drawing tools paint a caption; legacy drawings follow the outline and can hide captions", () => {
  for (const name of Object.keys(TOOL_NAMES)) {
    const item = drawing(name);
    assert.deepEqual(paint(item).text[0].slice(0, 2), [note, lineColor], name);
    assert.equal(paint(drawing(name, { textColor })).text[0][1], textColor, name);
    assert.deepEqual(paint(drawing(name, { textEnabled: false })).text, [], name);
  }
  assert.deepEqual(
    paint({
      ...drawing("rectangle"),
      points: [
        { timestamp: -90, value: 25 },
        { timestamp: -30, value: 150 }
      ]
    }).text,
    []
  );
});

test("caption style survives JSON, clipboard and Drive including drawing templates", async () => {
  const item = drawing("rectangle", { fontSize: 72, textColor, textVertical: "bottom" });
  const raw = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: { chartSettings: { drawingTemplates: { Test: { settings: item.settings } } } },
    drawings: [{ symbol: "GAZP", items: [item] }],
    images: [],
    history: []
  };
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(raw))), raw);
  const { payload } = await prepareDriveBackup(raw);
  const drive = assertReadableDrivePayload(JSON.parse(await payload.text()));
  assert.deepEqual(drive.drawings[0].items, [item]);
  assert.deepEqual(drive.layout.chartSettings.drawingTemplates.Test.settings, item.settings);
  assert.deepEqual(await restoreDriveBackup(payload, []), drive);
  assert.deepEqual(parseObjectClipboard(encodeDrawingClipboard(item, "fixture")).drawing, item);
  assert.throws(() =>
    validateBackup({
      ...raw,
      drawings: [{ symbol: "GAZP", items: [drawing("rectangle", { textColor: "url(example)" })] }]
    })
  );
  const draft = {
    ...item,
    settings: initialSettings(item),
    visibility: defaultVisibility()
  };
  assert.equal(settingsCandidate(draft).settings.textColor, textColor);
  assert.equal(settingsCandidate(draft).settings.fontSize, 72);
  draft.settings.textColor = undefined;
  draft.settings.fontSize = 100;
  assert.equal(Object.hasOwn(settingsCandidate(draft).settings, "textColor"), false);
  assert.equal(settingsCandidate(draft).settings.fontSize, 100);
});
