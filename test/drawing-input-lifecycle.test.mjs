import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

test("two chart inputs share one shell keyboard listener and Enter follows the selected editor with modal and profile guards", (t) => {
  const saved = new Map(
    ["document", "window", "Element"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  const keys = new Set(),
    effects = [];
  class Element {
    constructor(blocked) {
      this.blocked = blocked;
    }
    closest() {
      return this.blocked ? {} : null;
    }
  }
  const document = {
    baseURI: "https://example.test/",
    addEventListener: (type, fn) => {
      if (type === "keydown") keys.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === "keydown") keys.delete(fn);
    }
  };
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: document },
    window: {
      configurable: true,
      value: { addEventListener() {}, removeEventListener() {}, getSelection: () => null }
    },
    Element: { configurable: true, value: Element }
  });
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const editor = () => {
    const state = {
      owner: "owner",
      activeTool: "path",
      dialog: null,
      preferences: {
        symbol: "SBER",
        instrumentUid: "uid",
        timeframe: "1m",
        chartSettings: {},
        indicators: {}
      }
    };
    const drawings = [];
    return {
      state,
      drawings,
      controller: {
        getSnapshot: () => state,
        setPreview: (value) => {
          state.preview = value;
        },
        addDrawing: (value) => drawings.push(value),
        notify: (value) => assert.fail(value),
        start: () => Promise.resolve(),
        editing: { observeWorkspaceAnnotations: () => () => {} },
        dispose() {}
      }
    };
  };
  const root = editor(),
    second = editor();
  let eventCallback;
  const react = {
    memo: (fn) => fn,
    useState: () => [null, () => {}],
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useEffect: (fn) => effects.push(fn),
    useEffectEvent: (fn) => {
      eventCallback = fn;
      return () => eventCallback();
    }
  };
  const load = sourceModules({
    react,
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props })
    },
    "i18n/messages.ts": { t: (value) => value },
    "services/pwa.ts": { setupPwa: async () => () => {} },
    "screens/terminal/context.tsx": { useTerminal: () => ({ controller: root.controller }) },
    "screens/terminal/controller-cloud-sync.ts": { startTerminalCloudSync: () => () => {} },
    "screens/terminal/TransferMutationBarrier.tsx": {},
    "screens/terminal/WelcomeDialog.tsx": {},
    "model/drawing-magnet.ts": { snapDrawingPoint: (point) => point },
    "charts/price-format.ts": { nativePriceStep: () => null, roundPriceToStep: (value) => value },
    "model/selected-instrument.ts": { selectedMarketRow: () => null }
  });
  const { TerminalLifecycle } = load("screens/terminal/TerminalLifecycle.tsx");
  TerminalLifecycle({ chartEditor: root.controller });
  const stopShell = effects.shift()();
  const { useChartDrawingInput } = load("screens/terminal/chart-drawing-input.ts");
  const input = (f) =>
    useChartDrawingInput(f.controller, f.state, { current: null }, { current: null }).drawingInput;
  const firstInput = input(root),
    secondInput = input(second);
  const cleanups = effects
    .splice(0)
    .map((effect) => effect())
    .filter(Boolean);
  assert.equal(keys.size, 1, "chart surfaces do not install competing document listeners");
  const pointer = { pointerId: 1, pointerType: "mouse", preventDefault() {}, stopPropagation() {} };
  // Real projected points are unnecessary here: the input receives a controlled market projection.
  for (const f of [root, second])
    f.controller.chart = {
      pixelToPoint: (timestamp, value) => ({ timestamp, value }),
      pointToPixel: ({ timestamp, value }) => ({ x: timestamp, y: value })
    };
  const seed = (drawingInput) => {
    drawingInput.down(pointer, { x: 10, y: 20 });
    drawingInput.down(pointer, { x: 100, y: 50 });
  };
  seed(firstInput);
  seed(secondInput);
  const enter = (target) => {
    const event = {
      key: "Enter",
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {}
    };
    for (const listener of keys) listener(event);
    return event.defaultPrevented;
  };
  // Re-render changes selectedEditor without replacing the shell's installed listener.
  TerminalLifecycle({ chartEditor: second.controller });
  effects.length = 0;
  assert.equal(enter(null), true);
  assert.equal(root.drawings.length, 0);
  assert.equal(second.drawings.length, 1);
  assert.equal(firstInput.pending(), true);
  TerminalLifecycle({ chartEditor: root.controller });
  effects.length = 0;
  for (const [field, value] of [
    ["dialog", "drawing-settings"],
    ["loading", true],
    ["importingBackup", true],
    ["importRecoveryRequired", true],
    ["profileTransition", true],
    ["annotationReady", false]
  ]) {
    root.state[field] = value;
    assert.equal(enter(null), false, field);
    assert.equal(root.drawings.length, 0);
    delete root.state[field];
  }
  assert.equal(enter(new Element(true)), false, "editable and modal targets retain Enter");
  root.state.owner = "other-owner";
  assert.equal(enter(null), false, "stale profile draft is discarded before commit");
  assert.equal(firstInput.pending(), false);
  assert.equal(root.drawings.length, 0);
  for (const cleanup of cleanups) cleanup();
  stopShell();
  assert.equal(keys.size, 0);
});
