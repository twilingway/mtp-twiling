import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";

const load = sourceLoader({ "i18n/messages.ts": { t: (value) => value } });
const { createDrawingInput, createDrawingContextSource, drawingHandleRadius } = load(
  "screens/terminal/chart-drawing-touch.ts"
);
const { hitDrawing, paintDrawings } = load("model/drawing-model.ts");

function fixture(tool = "segment") {
  let preview = null;
  const drawings = [],
    capture = new Set();
  const state = { activeTool: tool, preferences: { chartSettings: {} } };
  const input = createDrawingInput(
    {
      getSnapshot: () => state,
      setPreview: (value) => {
        preview = value;
      },
      addDrawing: (value) => drawings.push(value),
      notify: (value) => assert.fail(value)
    },
    ({ x, y }) => ({ timestamp: x, value: y })
  );
  const event = (type = "touch", id = 1) => ({
    pointerId: id,
    pointerType: type,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: {
      setPointerCapture: (id) => capture.add(id),
      hasPointerCapture: (id) => capture.has(id),
      releasePointerCapture: (id) => capture.delete(id)
    }
  });
  return { input, event, drawings, capture, preview: () => preview };
}

for (const tool of ["segment", "rectangle", "rayLine", "straightLine", "fibonacciLine"]) {
  test(`${tool}: one captured touch drag previews and commits exact release anchor once`, () => {
    const f = fixture(tool),
      event = f.event();
    assert.equal(f.input.down(event, { x: 100, y: 200 }), true);
    assert.equal(f.capture.has(1), true);
    f.input.move(event, { x: 200, y: 300 });
    assert.deepEqual(f.preview().points, [
      { timestamp: 100, value: 200 },
      { timestamp: 200, value: 300 }
    ]);
    assert.equal(f.drawings.length, 0);
    assert.equal(f.input.up(event, { x: 250, y: 350 }), true);
    assert.deepEqual(f.drawings[0].points, [
      { timestamp: 100, value: 200 },
      { timestamp: 250, value: 350 }
    ]);
    assert.equal(f.preview(), null);
    assert.equal(f.capture.size, 0);
    assert.equal(f.input.up(event, { x: 250, y: 350 }), false);
    assert.equal(f.drawings.length, 1);
  });
}

test("cancel and stationary touch discard preview; another pointer cannot complete a gesture", () => {
  const f = fixture();
  f.input.down(f.event(), { x: 100, y: 100 });
  assert.equal(f.input.up(f.event("touch", 2), { x: 200, y: 200 }), false);
  f.input.cancel();
  assert.equal(f.preview(), null);
  assert.equal(f.input.up(f.event(), { x: 200, y: 200 }), false);
  f.input.down(f.event(), { x: 100, y: 100 });
  f.input.up(f.event(), { x: 101, y: 101 });
  assert.equal(f.drawings.length, 0);
  assert.equal(f.preview(), null);
});

test("mouse keeps two-click creation and does not capture the pointer", () => {
  const f = fixture(),
    event = f.event("mouse");
  f.input.down(event, { x: 100, y: 100 });
  f.input.up(event, { x: 200, y: 200 });
  assert.equal(f.drawings.length, 0);
  f.input.down(event, { x: 300, y: 400 });
  assert.deepEqual(f.drawings[0].points, [
    { timestamp: 100, value: 100 },
    { timestamp: 300, value: 400 }
  ]);
  assert.equal(f.capture.size, 0);
});

test("object hold suppresses Android MouseEvent contextmenu, including delayed release; physical mouse resets it", () => {
  const source = createDrawingContextSource();
  source.down({ pointerType: "touch", timeStamp: 100 }, true);
  assert.equal(source.suppress({ timeStamp: 2500 }), true);
  source.up({ timeStamp: 2600 });
  assert.equal(source.suppress({ timeStamp: 2700 }), true);
  assert.equal(source.suppress({ timeStamp: 3900 }), false);
  source.down({ pointerType: "mouse", timeStamp: 2800 }, true);
  assert.equal(source.suppress({ timeStamp: 2801 }), false);
  source.down({ pointerType: "touch", timeStamp: 2900 }, false);
  assert.equal(source.suppress({ timeStamp: 3400 }), false);
});

test("touch anchors have 44px targets and 26px visual diameter while mouse defaults stay unchanged", () => {
  const drawing = {
    id: "line",
    name: "segment",
    points: [
      { timestamp: 100, value: 100 },
      { timestamp: 200, value: 100 }
    ]
  };
  const project = ({ timestamp, value }) => ({ x: timestamp, y: value });
  assert.equal(hitDrawing([drawing], { x: 100, y: 121 }, project, 400, 400), null);
  assert.deepEqual(hitDrawing([drawing], { x: 100, y: 121 }, project, 400, 400, 22), {
    id: "line",
    handle: 0
  });
  assert.equal(hitDrawing([drawing], { x: 100, y: 123 }, project, 400, 400, 22), null);
  const radii = [];
  const ctx = new Proxy(
    { arc: (_x, _y, radius) => radii.push(radius) },
    {
      get: (target, key) => target[key] ?? (() => {}),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      }
    }
  );
  paintDrawings(ctx, [drawing], project, 400, 400, "line");
  paintDrawings(ctx, [drawing], project, 400, 400, "line", 13);
  assert.deepEqual(radii, [5, 5, 13, 13]);
});

test("image native hold does not open a menu; real mouse right-click still does", () => {
  const contexts = [],
    selected = [];
  const state = {
    preferences: { chartSettings: {} },
    images: [{ id: "image", point: {}, blob: {} }]
  };
  const controller = {
    getSnapshot: () => state,
    selectObject: (id) => selected.push(id),
    setContext: (value) => contexts.push(value)
  };
  const modules = {
    react: {
      useEffect() {},
      useLayoutEffect() {},
      useMemo: (fn) => fn(),
      useState: () => ["", () => {}],
      useRef: () => ({ current: null })
    },
    "react/jsx-runtime": jsxRuntime,
    "../../i18n/messages.js": { t: (value) => value },
    "../../model/drawing-toolbar.js": load("model/drawing-toolbar.ts"),
    "./context.js": { useTerminal: () => ({ controller, state }) },
    "./drawing-projection.js": {},
    "./chart-drawing-touch.js": { createDrawingContextSource }
  };
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/screens/terminal/ImageLayer.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  vm.runInThisContext(`(function(require,module,exports,Element){${source}\n})`)(
    (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
    module,
    module.exports,
    class {}
  );
  const layer = module.exports.ImageLayer({ drawingProjection: {} });
  const child = layer.props.children[0];
  const image = child.type(child.props);
  const event = (pointerType, timeStamp, button = 0) => ({
    pointerType,
    timeStamp,
    button,
    target: null,
    preventDefault() {},
    stopPropagation() {}
  });
  image.props.onPointerDown(event("touch", 100));
  image.props.onContextMenu({ ...event(undefined, 800), nativeEvent: { timeStamp: 800 } });
  assert.equal(contexts.length, 0);
  image.props.onPointerUp(event("touch", 850));
  image.props.onContextMenu({ ...event(undefined, 900), nativeEvent: { timeStamp: 900 } });
  assert.equal(contexts.length, 0);
  image.props.onPointerDown(event("mouse", 950, 2));
  image.props.onContextMenu({
    ...event(undefined, 951),
    clientX: 10,
    clientY: 20,
    nativeEvent: { timeStamp: 951 }
  });
  assert.equal(contexts.length, 1);
  assert.deepEqual(contexts[0], { x: 10, y: 20, target: { kind: "image", id: "image" } });
  assert.ok(selected.includes("image"));
});

test("ChartSurface preserves the editing owner when a second finger moves, releases or cancels", () => {
  const state = {
    owner: "owner",
    activeTool: null,
    rows: [],
    drawings: [
      {
        id: "line",
        name: "segment",
        points: [
          { timestamp: 100, value: 100 },
          { timestamp: 200, value: 100 }
        ]
      }
    ],
    preferences: {
      engine: "lightweight",
      technicalIndicators: [],
      indicators: {},
      chartSettings: {}
    }
  };
  let begins = 0,
    previews = 0,
    cancellations = 0;
  const finished = [];
  const controller = {
    chart: {
      plotSize: () => ({ width: 400, height: 400 }),
      pointToPixel: ({ timestamp, value }) => ({ x: timestamp, y: value }),
      pixelToPoint: (x, y) => ({ timestamp: x, value: y })
    },
    getSnapshot: () => state,
    setContext() {},
    setPreview() {},
    selectObject: (id) => {
      state.selectedObject = id;
    },
    editing: {
      beginGesture: () => ++begins,
      gestureActive: () => true,
      previewGesture: () => previews++,
      cancelGesture: () => cancellations++,
      finishGesture: (token) => {
        finished.push(token);
        return Promise.resolve();
      }
    }
  };
  const noop = () => {};
  const modules = {
    react: {
      useEffect() {},
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: () => ({ current: null })
    },
    "react/jsx-runtime": jsxRuntime,
    "../../i18n/messages.js": { t: (value) => value },
    "../../model/drawing-model.js": load("model/drawing-model.ts"),
    "../../model/backup-format.js": load("model/backup-format.ts"),
    "../../model/drawing-toolbar.js": load("model/drawing-toolbar.ts"),
    "../../model/drawing-magnet.js": { snapDrawingPoint: (point) => point },
    "../../model/theme.js": {},
    "../../charts/price-format.js": {
      nativePriceStep: () => 1,
      roundPriceToStep: (value) => value
    },
    "../../model/selected-instrument.js": { selectedMarketRow: () => null },
    "../../charts/navigation.js": load("charts/navigation.ts"),
    "./chart-lifecycle.js": {},
    "./context.js": { useTerminal: () => ({ controller, state }) },
    "../../model/intervals/drawing-visibility.js": { drawingVisibleOnInterval: () => true },
    "../../model/technical-indicator-layout.js": { technicalIndicatorGroups: () => [] },
    "./camera-input.js": { useCameraInput: () => ({ down: noop, move: noop, up: noop }) },
    "./drawing-settings-preview.js": { drawingRenderList: (current) => current.drawings },
    "./ChartMeasurement.js": {},
    "./chart-measurement-input.js": {
      useChartMeasurementInput: () => ({
        down: () => false,
        move: () => false,
        up: () => false,
        active: () => false,
        cancel: noop
      })
    },
    "./workspace-sync-controller.js": {},
    "./ohlc-inspection-input.js": {
      useOhlcInspection: () => ({ down: noop, move: noop, up: noop, cancel: noop, clear: noop })
    },
    "./OhlcCandleCard.js": {},
    "./chart-drawing-touch.js": load("screens/terminal/chart-drawing-touch.ts")
  };
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/screens/terminal/ChartSurface.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  vm.runInThisContext(`(function(require,module,exports,Element){${source}\n})`)(
    (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
    module,
    module.exports,
    class {}
  );
  const surface = module.exports.ChartGestures({ children: null });
  const capture = new Set();
  const target = {
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: (id) => capture.add(id),
    hasPointerCapture: (id) => capture.has(id),
    releasePointerCapture: (id) => capture.delete(id)
  };
  const event = (id, x = 100) => ({
    pointerId: id,
    pointerType: "touch",
    isPrimary: id === 1,
    button: 0,
    clientX: x,
    clientY: 100,
    timeStamp: 100,
    currentTarget: target,
    target: null,
    preventDefault() {},
    stopPropagation() {}
  });
  surface.props.onPointerDownCapture(event(1));
  surface.props.onPointerDownCapture(event(2));
  surface.props.onPointerMoveCapture(event(2, 150));
  surface.props.onPointerUpCapture(event(2));
  surface.props.onPointerCancelCapture(event(2));
  assert.equal(begins, 1);
  assert.equal(previews, 0);
  assert.equal(cancellations, 0);
  assert.deepEqual(finished, []);
  surface.props.onPointerMoveCapture(event(1, 150));
  surface.props.onPointerUpCapture(event(1, 150));
  assert.equal(previews, 1);
  assert.deepEqual(finished, [1]);
  const canvas = { closest: () => target };
  assert.equal(drawingHandleRadius(canvas, true), 13);
  surface.props.onPointerDownCapture({ ...event(1), pointerType: "mouse", button: 2 });
  assert.equal(target.dataset.drawingTouch, "false");
  assert.equal(drawingHandleRadius(canvas, true), 5);
  delete target.dataset.drawingTouch;
  assert.equal(drawingHandleRadius(canvas, true), 13);
  assert.equal(drawingHandleRadius(canvas, false), 5);
});
