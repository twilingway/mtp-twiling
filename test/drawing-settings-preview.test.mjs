import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const compiled = new Map();
const json = (value) => JSON.parse(JSON.stringify(value));
function sources(overrides = {}, globals = {}) {
  const cells = new Map();
  const events = { addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({
    console,
    Date,
    Math,
    Promise,
    TextEncoder,
    TextDecoder,
    crypto,
    Blob,
    structuredClone,
    EventTarget,
    Event,
    CustomEvent,
    AbortController,
    AbortSignal,
    DOMException,
    navigator: { onLine: true },
    window: events,
    document: { ...events, visibilityState: "visible" },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask,
    ...globals
  });
  function load(relative) {
    let filename = path.resolve(root, relative).replace(/\.js$/, ".ts");
    if (!existsSync(filename)) filename += "x";
    const key = path.relative(root, filename).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cells.has(key)) return cells.get(key).exports;
    const module = { exports: {} };
    cells.set(key, module);
    let code = compiled.get(filename);
    if (!code) {
      code = ts.transpileModule(readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX
        }
      }).outputText;
      compiled.set(filename, code);
    }
    new vm.Script(`(function(require,module,exports){${code}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) =>
        specifier === "react-dom"
          ? { createPortal: (value) => value }
          : Object.hasOwn(overrides, specifier)
            ? overrides[specifier]
            : specifier === "react"
              ? { createContext: () => ({}) }
              : specifier === "react/jsx-runtime"
                ? {
                    jsx: (type, props) => ({ type, props }),
                    jsxs: (type, props) => ({ type, props })
                  }
                : load(path.relative(root, path.resolve(path.dirname(filename), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
const tools = [
  "segment",
  "rayLine",
  "straightLine",
  "horizontalStraightLine",
  "horizontalRayLine",
  "verticalStraightLine",
  "rectangle",
  "fibonacciLine",
  "fibonacciExtension"
];
function drawing(name = "segment") {
  const count = ["horizontalStraightLine", "horizontalRayLine", "verticalStraightLine"].includes(
    name
  )
    ? 1
    : name === "fibonacciExtension"
      ? 3
      : 2;
  return {
    id: "original",
    name,
    points: Array.from({ length: count }, (_, index) => ({
      timestamp: 1700000000000 + index * 60000,
      value: 100 + index * 10
    })),
    settings: { color: "#123456", width: 1, lineStyle: "solid", lineOpacity: 1 },
    lock: true
  };
}
function fixture(name = "segment") {
  let persisted,
    controller,
    driveBridge,
    changes = 0;
  const writes = [];
  const storage = {
    flush: async () => {},
    savePreferences: async () => {},
    saveAnnotationDocument: async (owner, symbol, drawings, images) => {
      const value = { owner, symbol, drawings: json(drawings), images: json(images) };
      writes.push(value);
      persisted = value.drawings;
    },
    createBackup: async () => ({
      application: "personal-terminal",
      schemaVersion: 1,
      layout: json(controller.getSnapshot().preferences),
      watchlist: [],
      drawings: [{ symbol: "ONE", items: json(persisted) }],
      images: []
    })
  };
  const load = sources({
    "services/storage.ts": storage,
    "services/storage-v2.ts": storage,
    "services/storage-db.ts": {},
    "services/drive/auth.ts": { DriveAuth: class {} },
    "services/drive/coordinator.ts": {
      DriveCoordinator: class {
        constructor(bridge) {
          driveBridge = bridge;
        }
        profileChanged() {}
        resume() {}
        suspend() {}
        localIntent() {}
        localChanged() {
          changes++;
        }
      }
    }
  });
  const { TerminalController } = load("screens/terminal/controller.ts");
  controller = new TerminalController();
  const original = drawing(name);
  controller.update({
    owner: "alice",
    authenticated: true,
    preferences: {
      ...controller.getSnapshot().preferences,
      symbol: "ONE",
      instrumentUid: "uid-one"
    },
    rows: [
      {
        symbol: "ONE",
        ticker: "ONE",
        uid: "uid-one",
        figi: null,
        name: "One",
        currency: "rub",
        color: "#123456",
        mark: "O",
        step: 0.01,
        price: null,
        previousClose: null,
        availability: "pending"
      }
    ],
    drawings: [original],
    selectedObject: original.id
  });
  controller.setDialog("drawing-settings");
  persisted = json(controller.getSnapshot().drawings);
  return {
    controller,
    load,
    original,
    writes,
    persisted: () => persisted,
    changes: () => changes,
    drive: () => driveBridge
  };
}
const draftFor = (f) => {
  const { initialSettings, defaultVisibility } = f.load(
    "screens/terminal/drawings/drawing-settings-model.ts"
  );
  return {
    ...structuredClone(f.controller.getSnapshot().drawings[0]),
    settings: initialSettings(f.original),
    visibility: defaultVisibility()
  };
};

test("all drawing tools preview every candidate field without publishing and commit as one undo action", async () => {
  for (const name of tools) {
    const f = fixture(name),
      c = f.controller;
    const committed = c.getSnapshot().drawings;
    const { settingsCandidate } = f.load("screens/terminal/drawings/drawing-settings-model.ts");
    const { drawingRenderList } = f.load("screens/terminal/drawing-settings-preview.ts");
    const drive = f.load("screens/terminal/controller-drive.ts");
    const signature = drive.portableStateSignature(c.getSnapshot());
    const stop = drive.startTerminalDrive(c);
    const token = c.drawingSettings.begin("original");
    assert.ok(token);
    const draft = draftFor(f);
    Object.assign(draft.settings, {
      color: "#ff9800",
      width: 4,
      lineStyle: "dotted",
      lineOpacity: 0.23,
      trendColor: "#26a69a",
      trendWidth: 3,
      trendStyle: "dashed",
      trendOpacity: 0.37,
      opacity: 0.61,
      fontSize: 72,
      textEnabled: true,
      text: "Preview",
      textColor: "#398aff",
      labels: true,
      fill: true,
      oneColor: true,
      extend: "both",
      reverse: true,
      prices: true,
      labelFormat: "percent"
    });
    draft.settings.levelStyles[0] = { value: 0.33, enabled: true, color: "#ffffff", text: "Level" };
    draft.points[0].value = 123.45;
    draft.visibility.minutes.enabled = false;
    const candidate = settingsCandidate(draft);
    assert.ok(candidate);
    assert.equal(c.drawingSettings.preview(token, candidate), true);
    assert.equal(c.getSnapshot().drawings, committed, name);
    assert.equal(c.getSnapshot().drawings[0], f.original, name);
    assert.deepEqual(json(drawingRenderList(c.getSnapshot())[0]), json(candidate));
    assert.equal(drive.portableStateSignature(c.getSnapshot()), signature);
    assert.equal(f.changes(), 0, name);
    const backup = await c.exportBackup(false, { captureView: false });
    assert.deepEqual(backup.drawings[0].items, [f.original]);
    const automatic = await f.drive().exportBackup();
    assert.deepEqual(automatic.drawings[0].items, [f.original]);
    assert.equal(c.getSnapshot().drawings, committed);
    assert.equal(f.writes.length, 0);
    assert.equal(await c.drawingSettings.commit(token, candidate), true);
    assert.equal(c.getSnapshot().drawingSettingsPreview, null);
    assert.equal(f.writes.length, 1, name);
    assert.equal(f.changes(), 1, name);
    assert.equal(c.getSnapshot().drawings[0].lock, true);
    await c.undoDrawings();
    assert.deepEqual(json(c.getSnapshot().drawings), [f.original]);
    await c.editing.redo();
    assert.deepEqual(json(c.getSnapshot().drawings[0]), json(candidate));
    await c.undoDrawings();
    const count = f.writes.length;
    await c.undoDrawings();
    assert.equal(f.writes.length, count, "no extra preview undo commands");
    assert.deepEqual(json(c.getSnapshot().drawings), [f.original]);
    stop();
    c.dispose();
  }
});

test("cancel and every scope change reject stale commit without writing a draft", async () => {
  const cases = [
    ["cancel", (c) => c.drawingSettings.cancel()],
    ["dialog", (c) => c.setDialog(null)],
    ["owner", (c) => c.update({ owner: "bob" })],
    ["symbol", (c) => c.update({ preferences: { ...c.getSnapshot().preferences, symbol: "TWO" } })],
    [
      "uid",
      (c) =>
        c.update({ preferences: { ...c.getSnapshot().preferences, instrumentUid: "uid-other" } })
    ],
    [
      "engine",
      (c) => c.update({ preferences: { ...c.getSnapshot().preferences, engine: "kline" } })
    ],
    [
      "timeframe",
      (c) => c.update({ preferences: { ...c.getSnapshot().preferences, timeframe: "1d" } })
    ],
    ["revision", (c) => c.update({ chartRevision: 9 })],
    [
      "resolved uid",
      (c) => c.update({ rows: c.getSnapshot().rows.map((row) => ({ ...row, uid: "uid-other" })) })
    ],
    ["selected", (c) => c.selectObject(null)],
    ["import", (c) => c.update({ importingBackup: true })],
    ["recovery", (c) => c.update({ importRecoveryRequired: true })],
    ["original", (c) => c.update({ drawings: [{ ...c.getSnapshot().drawings[0] }] })],
    ["undo", (c) => c.undoDrawings()],
    ["delete", (c) => c.setDrawings([])],
    ["dispose", (c) => c.dispose()]
  ];
  for (const [label, change] of cases) {
    const f = fixture(),
      c = f.controller;
    if (label === "engine")
      c.update({ preferences: { ...c.getSnapshot().preferences, engine: "tradingview" } });
    if (label === "timeframe")
      c.update({ preferences: { ...c.getSnapshot().preferences, timeframe: "1m" } });
    const token = c.drawingSettings.begin("original");
    const candidate = { ...f.original, title: "uncommitted" };
    assert.equal(c.drawingSettings.preview(token, candidate), true);
    await change(c);
    const count = f.writes.length;
    assert.equal(c.getSnapshot().drawingSettingsPreview, null, label);
    assert.equal(await c.drawingSettings.commit(token, candidate), false, label);
    assert.equal(f.writes.length, count, label);
    c.dispose();
  }
});

test("opening settings retires an existing gesture before capturing the committed original", async () => {
  const f = fixture(),
    c = f.controller;
  c.setDialog(null);
  const gesture = c.editing.beginGesture();
  c.editing.previewGesture(gesture, {
    drawings: [
      { ...f.original, points: f.original.points.map((point) => ({ ...point, value: 999 })) }
    ]
  });
  c.setDialog("drawing-settings");
  assert.equal(c.getSnapshot().drawings[0].points[0].value, 100);
  const token = c.drawingSettings.begin("original");
  const item = { ...c.getSnapshot().drawings[0], title: "Style edit" };
  assert.equal(await c.drawingSettings.commit(token, item), true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].drawings[0].points[0].value, 100);
  await c.undoDrawings();
  assert.deepEqual(json(c.getSnapshot().drawings), [f.original]);
  c.dispose();
});

test("actual chart visibility selector renders transient visibility and restores the committed object", () => {
  const f = fixture(),
    c = f.controller;
  c.update({ preferences: { ...c.getSnapshot().preferences, timeframe: "1m" } });
  const { visibleDrawings } = f.load("screens/terminal/ChartSurface.tsx");
  const { settingsCandidate } = f.load("screens/terminal/drawings/drawing-settings-model.ts");
  assert.equal(visibleDrawings(c.getSnapshot()).length, 1);
  const token = c.drawingSettings.begin("original"),
    draft = draftFor(f);
  draft.visibility.minutes.enabled = false;
  c.drawingSettings.preview(token, settingsCandidate(draft));
  assert.equal(visibleDrawings(c.getSnapshot()).length, 0);
  c.drawingSettings.cancel(token);
  assert.equal(visibleDrawings(c.getSnapshot())[0], f.original);
  c.dispose();
});

test("invalid numeric fields never become zero or overwrite committed coordinates", async () => {
  const f = fixture("fibonacciLine"),
    c = f.controller;
  const model = f.load("screens/terminal/drawings/drawing-settings-model.ts");
  const token = c.drawingSettings.begin("original"),
    committed = c.getSnapshot().drawings;
  assert.ok(Number.isNaN(model.draftNumber("")));
  assert.ok(Number.isNaN(model.draftNumber("  ")));
  for (const change of [
    (draft) => {
      draft.points[0].value = NaN;
    },
    (draft) => {
      draft.points[0].timestamp = NaN;
    },
    (draft) => {
      draft.points[0].timestamp = 1e17;
    },
    (draft) => {
      draft.settings.levelStyles[0].value = NaN;
    },
    (draft) => {
      draft.visibility.minutes.from = NaN;
    },
    (draft) => {
      draft.visibility.hours.to = 25;
    },
    (draft) => {
      draft.settings.lineOpacity = -1;
    }
  ]) {
    const draft = draftFor(f);
    change(draft);
    assert.equal(model.settingsCandidate(draft), null);
    assert.equal(c.drawingSettings.preview(token, draft), false);
    assert.equal(await c.drawingSettings.commit(token, draft), false);
    assert.equal(c.getSnapshot().drawings, committed);
    assert.equal(f.writes.length, 0);
  }
  c.drawingSettings.cancel(token);
  c.dispose();
});

const jsx = (type, props) => ({ type, props });
function formFixture(name = "segment") {
  const f = fixture(name),
    c = f.controller,
    cells = [],
    effects = [];
  let cursor = 0,
    node;
  const hooks = {
    useRef(value) {
      const index = cursor++;
      return (cells[index] ??= { current: value });
    },
    useState(initial) {
      const index = cursor++;
      if (!cells[index])
        cells[index] = { value: typeof initial === "function" ? initial() : initial };
      return [
        cells[index].value,
        (next) => {
          cells[index].value = typeof next === "function" ? next(cells[index].value) : next;
        }
      ];
    },
    useLayoutEffect(effect, deps) {
      const index = cursor++;
      const previous = cells[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i]))
        effects.push(() => {
          previous?.cleanup?.();
          cells[index] = { deps, cleanup: effect() };
        });
    }
  };
  hooks.useEffect = hooks.useLayoutEffect;
  const load = sources({
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.tsx": {
      useTerminal: () => ({ state: c.getSnapshot(), controller: c })
    }
  });
  const wrapper = load(
    "screens/terminal/drawings/DrawingSettingsDialog.tsx"
  ).DrawingSettingsDialog();
  function render() {
    cursor = 0;
    node = wrapper.type(wrapper.props);
    node.props.ref.current = {
      open: false,
      showModal() {
        this.open = true;
      }
    };
    while (effects.length) effects.shift()();
    return node;
  }
  return {
    ...f,
    render,
    node: () => node,
    style: () => node.props.children.props.children[3].props.children.props,
    coordinates: () => node.props.children.props.children[4].props.children.props,
    lock: () => node.props.children.props.children[0].props.children[1].props,
    template: () => node.props.children.props.children[7].props.children[0].props,
    submit: () => node.props.children.props.onSubmit({ preventDefault() {} }),
    unmount: () => {
      for (const cell of cells) cell?.cleanup?.();
    }
  };
}

test("actual form handlers preview fields and templates; Cancel/Escape/close/unmount restore committed", async () => {
  for (const mode of ["cancel", "escape", "close", "unmount"]) {
    const f = formFixture("fibonacciExtension"),
      c = f.controller;
    f.render();
    const original = c.getSnapshot().drawings;
    f.style().change("lineOpacity", 0.4);
    f.render();
    assert.equal(c.getSnapshot().drawingSettingsPreview.drawing.settings.lineOpacity, 0.4);
    assert.equal(f.coordinates().disabled, true);
    f.coordinates().point(0, { value: 222 });
    f.render();
    assert.equal(c.getSnapshot().drawingSettingsPreview.drawing.points[0].value, 100);
    f.lock().onClick();
    f.render();
    assert.equal(f.coordinates().disabled, false);
    f.coordinates().point(0, { value: 222 });
    f.render();
    assert.equal(c.getSnapshot().drawingSettingsPreview.drawing.points[0].value, 222);
    f.template().onApply({ settings: { color: "#ffffff", lineOpacity: 0.12, fontSize: 20 } });
    f.render();
    assert.equal(c.getSnapshot().drawingSettingsPreview.drawing.settings.lineOpacity, 0.12);
    assert.equal(c.getSnapshot().drawings, original);
    if (mode === "unmount") f.unmount();
    else if (mode === "escape") f.node().props.onCancel();
    else if (mode === "close") f.node().props.onClose();
    else f.node().props.children.props.children[7].props.children[2].props.onClick();
    assert.equal(c.getSnapshot().drawingSettingsPreview, null, mode);
    assert.equal(c.getSnapshot().drawings, original, mode);
    assert.equal(f.writes.length, 0);
    f.unmount();
    c.dispose();
  }
  const f = formFixture();
  f.render();
  f.style().change("lineOpacity", 0.31);
  f.render();
  f.submit();
  await new Promise(setImmediate);
  assert.equal(f.writes.length, 1);
  assert.equal(f.controller.getSnapshot().dialog, null);
  await f.controller.undoDrawings();
  assert.equal(f.controller.getSnapshot().drawings[0].settings.lineOpacity, 1);
  f.unmount();
  f.controller.dispose();
  const invalid = formFixture();
  invalid.render();
  invalid.lock().onClick();
  invalid.render();
  invalid.coordinates().point(0, { value: NaN });
  invalid.render();
  invalid.submit();
  await new Promise(setImmediate);
  assert.equal(invalid.writes.length, 0);
  assert.equal(invalid.controller.getSnapshot().drawings[0].points[0].value, 100);
  invalid.unmount();
  invalid.controller.dispose();
});

test("rectangle text palette and font size preview separately from outline and persist at save", async () => {
  const f = formFixture("rectangle"),
    c = f.controller;
  f.render();
  const style = f.style();
  const node = f.node().props.children.props.children[3].props.children;
  const controls = node.type(style).props.children;
  const find = (value, check) => {
    if (Array.isArray(value)) return value.flatMap((item) => find(item, check));
    if (!value?.props) return [];
    return [...(check(value) ? [value] : []), ...find(value.props.children, check)];
  };
  const [font] = find(controls, (item) => item.props.name === "fontSize");
  assert.equal(font.props.children.at(-1).props.value, "72");
  const [swatch] = find(controls, (item) => item.props.label === "Цвет текста");
  swatch.props.onClick();
  f.render();
  const [palette] = find(f.node(), (item) => item.props.target?.kind === "text");
  palette.props.onColor("#f23645");
  font.props.onChange({ currentTarget: { value: "72" } });
  f.style().change("text", "Нижняя грань");
  f.style().change("textVertical", "bottom");
  f.render();
  const preview = c.getSnapshot().drawingSettingsPreview.drawing.settings;
  assert.equal(preview.fontSize, 72);
  assert.equal(preview.textColor, "#f23645");
  assert.equal(preview.text, "Нижняя грань");
  assert.equal(preview.color, f.original.settings.color);
  f.submit();
  await new Promise(setImmediate);
  assert.equal(f.persisted()[0].settings.textColor, "#f23645");
  assert.equal(f.persisted()[0].settings.textVertical, "bottom");
  f.unmount();
  c.dispose();
});

test("visible opacity controls use 0..100 percent without inversion and retain inline line controls", () => {
  const load = sources({
    react: { useId: () => "opacity" },
    "react/jsx-runtime": { jsx, jsxs: jsx }
  });
  const { OpacityControl } = load("screens/terminal/drawings/controls/OpacityControl.tsx");
  const changes = [];
  for (const value of [0, 0.37, 1]) {
    const tree = OpacityControl({
      name: "lineOpacity",
      color: "#ff9800",
      value,
      onChange: (next) => changes.push(next)
    });
    const input = tree.props.children[1].props.children;
    assert.equal(input.props.min, 0);
    assert.equal(input.props.max, 100);
    assert.equal(input.props.value, Math.round(value * 100));
    assert.equal(tree.props.children[2].props.children.join(""), `${Math.round(value * 100)}%`);
    input.props.onChange({ currentTarget: { value: "0" } });
    input.props.onChange({ currentTarget: { value: "100" } });
  }
  assert.deepEqual(changes, [0, 1, 0, 1, 0, 1]);
  const { DrawingLineControls } = load(
    "screens/terminal/drawings/controls/DrawingLineControls.tsx"
  );
  const settings = load("screens/terminal/drawings/drawing-settings-model.ts").initialSettings({});
  const patches = [];
  for (const trend of [false, true]) {
    const controls = DrawingLineControls({
      settings,
      trend,
      onOpen() {},
      onChange: (patch) => patches.push(patch)
    });
    assert.equal(controls.props.children[1].type, "select");
    assert.equal(controls.props.children[2].type.name, "LineStylePicker");
    assert.equal(controls.props.children[3].type, OpacityControl);
    controls.props.children[3].props.onChange(0.26);
  }
  assert.deepEqual(json(patches), [{ lineOpacity: 0.26 }, { trendOpacity: 0.26 }]);
  const css = readFileSync(new URL("../public/drawing-opacity.css", import.meta.url), "utf8");
  assert.match(css, /repeating-conic-gradient/);
  assert.match(css, /linear-gradient\(to right, transparent, var\(--opacity-color\)\)/);
});

test("actual inline editor keeps multiline input, isolates keys, cancels without writes and saves an existing object once", async () => {
  const f = fixture(),
    c = f.controller;
  const original = {
    id: "text",
    name: "text",
    points: [{ timestamp: 1700000000000, value: 100 }],
    settings: { text: "Old\nvalue" }
  };
  c.chart = {
    plotSize: () => ({ width: 800, height: 600 }),
    pointToPixel: () => ({ x: 100, y: 100 })
  };
  c.update({ drawings: [original], selectedObject: "text" });
  c.setDialog("annotation-editor");
  c.drawingSettings.begin("text");
  let cursor = 0;
  const cells = [],
    hooks = {
      useEffect() {},
      useRef(value) {
        const i = cursor++;
        return (cells[i] ??= { current: value });
      },
      useState(initial) {
        const i = cursor++;
        cells[i] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          cells[i].value,
          (next) => {
            cells[i].value = typeof next === "function" ? next(cells[i].value) : next;
          }
        ];
      }
    };
  const load = sources({
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "model/drawing-annotation-measure.ts": {
      annotationMeasureText: (text, font) => text.length * font.size * 0.6
    },
    "screens/terminal/context.tsx": {
      useTerminal: () => ({ state: c.getSnapshot(), controller: c })
    }
  });
  const render = () => {
    cursor = 0;
    return load("screens/terminal/drawings/AnnotationInlineEditor.tsx").AnnotationInlineEditor({});
  };
  let node = render();
  node.props.children[0].props.onChange({ currentTarget: { value: "" } });
  node = render();
  assert.equal(node.props.children[0].props.value, "", "temporary empty input remains editable");
  assert.equal(f.writes.length, 0);
  node.props.children[0].props.onChange({ currentTarget: { value: "New\nmultiline" } });
  node = render();
  assert.equal(c.getSnapshot().drawingSettingsPreview.drawing.settings.text, "New\nmultiline");
  assert.equal(c.getSnapshot().drawings[0], original);
  let stopped = 0,
    prevented = 0;
  node.props.onKeyDown({
    key: "Enter",
    stopPropagation: () => stopped++,
    preventDefault: () => prevented++
  });
  assert.equal(stopped, 1);
  assert.equal(prevented, 0, "Enter inserts a newline");
  node.props.onKeyDown({ key: "Escape", stopPropagation() {}, preventDefault() {} });
  assert.equal(f.writes.length, 0);
  assert.equal(c.getSnapshot().drawingSettingsPreview, null);
  assert.equal(c.getSnapshot().drawings[0], original);
  c.setDialog("annotation-editor");
  c.drawingSettings.begin("text");
  node = render();
  node.props.children[0].props.onChange({ currentTarget: { value: "Saved\ntext" } });
  node = render();
  node.props.onKeyDown({ key: "Enter", ctrlKey: true, stopPropagation() {}, preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(f.writes.length, 1);
  assert.equal(c.getSnapshot().dialog, null);
  assert.equal(c.getSnapshot().drawings[0].settings.text, "Saved\ntext");
  await c.undoDrawings();
  assert.deepEqual(json(c.getSnapshot().drawings), [original]);
  c.dispose();
});
