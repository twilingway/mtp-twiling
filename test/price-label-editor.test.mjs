import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const jsx = (type, props) => ({ type, props });
const hooks = {
  useEffect() {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (initial) => [initial, () => {}]
};
const find = (node, check) =>
  Array.isArray(node)
    ? node.flatMap((child) => find(child, check))
    : !node?.props
      ? []
      : [...(check(node) ? [node] : []), ...find(node.props.children, check)];
const pure = sourceModules({ "i18n/messages.ts": { t: (value) => value } });
const { annotationDefaults } = pure("model/drawing-annotation.ts");

test("PriceLabel one click commits the own-price marker directly without an editor draft", () => {
  const drawings = [],
    drafts = [],
    state = { activeTool: "priceLabel", preferences: { chartSettings: {} } };
  const { createDrawingInput } = pure("screens/terminal/chart-drawing-touch.ts");
  const input = createDrawingInput(
    {
      getSnapshot: () => state,
      chart: { plotSize: () => ({ width: 800, height: 400 }) },
      setPreview() {},
      addDrawing: (drawing) => drawings.push(drawing),
      drawingCreation: { begin: (drawing) => drafts.push(drawing) },
      notify: assert.fail
    },
    ({ x, y }) => ({ timestamp: x, value: y })
  );
  input.down(
    { pointerId: 1, pointerType: "mouse", preventDefault() {}, stopPropagation() {} },
    { x: 100, y: 200 }
  );
  assert.equal(drawings.length, 1);
  assert.equal(drafts.length, 0);
  assert.equal(drawings[0].settings.text, "");
  assert.equal(drawings[0].points[0].value, 200);
});

test("PriceLabel settings have formatting controls but no custom text input, preserving legacy text untouched", () => {
  const load = sourceModules({
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "i18n/messages.ts": { t: (value) => value }
  });
  const { AnnotationEditor } = load("screens/terminal/drawings/AnnotationEditor.tsx");
  const { initialSettings } = pure("screens/terminal/drawings/drawing-settings-model.ts");
  const settings = initialSettings({
    name: "priceLabel",
    settings: { ...annotationDefaults("priceLabel"), text: "legacy invisible caption" }
  });
  const patches = [],
    node = AnnotationEditor({
      name: "priceLabel",
      settings,
      change: (key, value) => patches.push({ key, value })
    });
  assert.equal(
    find(node, (item) => item.type === "textarea" || item.props.name === "text").length,
    0
  );
  assert.ok(find(node, (item) => item.props["aria-label"] === "Размер шрифта").length);
  assert.ok(find(node, (item) => item.props["aria-label"] === "Цвет текста").length);
  assert.equal(settings.text, "legacy invisible caption");
  assert.deepEqual(patches, []);
});

test("PriceLabel cannot expose an inline editor for an existing object even with stale inline state", () => {
  const drawing = {
    id: "price",
    name: "priceLabel",
    points: [{ timestamp: 100, value: 200 }],
    settings: annotationDefaults("priceLabel")
  };
  const state = {
    dialog: "annotation-editor",
    drawingSettingsPreview: { token: "stale", drawing }
  };
  const load = sourceModules({
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "i18n/messages.ts": { t: (value) => value },
    "screens/terminal/context.tsx": { useTerminal: () => ({ state, controller: { chart: {} } }) }
  });
  assert.equal(
    load("screens/terminal/drawings/AnnotationInlineEditor.tsx").AnnotationInlineEditor({}),
    null
  );
});

test("PriceLabel native double click opens full settings instead of starting an inline text transaction", (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Element");
  Object.defineProperty(globalThis, "Element", { configurable: true, value: class {} });
  t.after(() =>
    descriptor
      ? Object.defineProperty(globalThis, "Element", descriptor)
      : delete globalThis.Element
  );
  const drawing = {
    id: "price",
    name: "priceLabel",
    points: [{ timestamp: 100, value: 200 }],
    settings: annotationDefaults("priceLabel")
  };
  const state = {
    selectedObject: null,
    drawings: [drawing],
    rows: [],
    preferences: {
      symbol: "ONE",
      timeframe: "1m",
      engine: "lightweight",
      indicators: {},
      chartSettings: {}
    }
  };
  const dialogs = [],
    inline = [];
  const controller = {
    getSnapshot: () => state,
    chart: {
      plotSize: () => ({ width: 800, height: 400 }),
      pointToPixel: ({ timestamp, value }) => ({ x: timestamp, y: value })
    },
    selectObject: (id) => {
      state.selectedObject = id;
    },
    setDialog: (dialog) => dialogs.push(dialog),
    drawingSettings: { begin: (id) => inline.push(id) }
  };
  const load = sourceModules({
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "i18n/messages.ts": { t: (value) => value },
    "screens/terminal/context.tsx": { useTerminal: () => ({ state, controller }) },
    "screens/terminal/chart-lifecycle.ts": {},
    "screens/terminal/camera-input.ts": { useCameraInput: () => ({ action() {} }) },
    "screens/terminal/chart-drawing-input.ts": {
      useChartDrawingInput: () => ({ drawingInput: { finish: () => false } })
    },
    "screens/terminal/chart-measurement-input.ts": {
      useChartMeasurementInput: () => ({ active: () => false })
    },
    "screens/terminal/ohlc-inspection-input.ts": { useOhlcInspection: () => ({ timestamp: null }) },
    "model/drawing-annotation-measure.ts": {
      annotationMeasureText: (text, font) => text.length * font.size * 0.6
    }
  });
  const node = load("screens/terminal/ChartSurface.tsx").ChartGestures({ children: null });
  node.props.onDoubleClickCapture({
    target: null,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    clientX: 100,
    clientY: 200,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(state.selectedObject, drawing.id);
  assert.deepEqual(dialogs, ["drawing-settings"]);
  assert.deepEqual(inline, []);
});

test("inline editor selector ignores market ticks and the hidden editor never subscribes to projection frames", () => {
  const effects = [];
  let state = {
    dialog: null,
    drawingCreationDraft: null,
    drawingSettingsPreview: null,
    candles: [],
    rows: []
  };
  const load = sourceModules({
    react: { ...hooks, useEffect: (effect) => effects.push(effect) },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "i18n/messages.ts": { t: (value) => value },
    "screens/terminal/context.tsx": { useTerminal: () => ({ state, controller: { chart: null } }) }
  });
  const { AnnotationInlineEditor, selectAnnotationInlineState } = load(
    "screens/terminal/drawings/AnnotationInlineEditor.tsx"
  );
  const { shallowEqual, selectedSnapshot } = pure("screens/terminal/snapshot-selector.ts");
  const get = selectedSnapshot(() => state, selectAnnotationInlineState, shallowEqual);
  const before = get();
  state = {
    ...state,
    rows: [{ price: 100 }],
    candles: [{ close: 100 }],
    crosshairBar: { close: 100 }
  };
  assert.equal(get(), before, "market/candle/hover updates reuse the selected snapshot");
  let subscriptions = 0;
  assert.equal(
    AnnotationInlineEditor({
      projection: { addEventListener: () => subscriptions++, removeEventListener() {} }
    }),
    null
  );
  for (const effect of effects) effect();
  assert.equal(subscriptions, 0, "hidden overlay does not repaint on candle projection events");
  state = {
    ...state,
    dialog: "annotation-editor",
    drawingCreationDraft: { token: "draft", drawing: { name: "text" } }
  };
  assert.notEqual(get(), before, "opening an editor changes the selected snapshot");
});
