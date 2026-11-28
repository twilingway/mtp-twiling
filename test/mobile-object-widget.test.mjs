import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const base = new URL("../src/screens/terminal/drawings/", import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value));
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
const load = (name, imports = {}, globals = {}) => {
  const filename = new URL(name, base);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  const module = { exports: {} };
  new vm.Script(`(function(require,module,exports){${source}\n})`, {
    filename: filename.pathname
  }).runInNewContext(globals)(
    (specifier) => {
      assert.ok(Object.hasOwn(imports, specifier), `Unexpected import ${specifier}`);
      return imports[specifier];
    },
    module,
    module.exports
  );
  return module.exports;
};
const helpers = load("mobile-object-widget.ts");

function menuDismissHarness({ mobile = true, kind = "drawing" } = {}) {
  class Node {
    constructor(inside = false) {
      this.inside = inside;
    }
    closest() {
      return null;
    }
  }
  const listeners = [];
  const document = {
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, capture: options === true || options?.capture === true });
    },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((item) => item.type === type && item.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    querySelector: () => ({
      focus: () => {
        focused = "widget";
      }
    })
  };
  let focused = null;
  let onMenuClose = () => {};
  const state = {
    selectedObject: "selected",
    contextMenu: {
      x: 128,
      y: 226,
      target:
        kind === "chart"
          ? { kind }
          : kind === "indicator"
            ? { kind, key: "ma" }
            : { kind, id: "selected" }
    },
    drawings: kind === "image" ? [] : [{ id: "selected", name: "segment", points: [] }],
    images: kind === "image" ? [{ id: "selected", name: "Photo", width: 100 }] : [],
    preferences: { chartSettings: {}, indicators: {} }
  };
  const controller = {
    getSnapshot: () => state,
    setContext: (contextMenu) => {
      const closing = state.contextMenu !== null && contextMenu === null;
      state.contextMenu = contextMenu;
      if (closing) onMenuClose();
    },
    selectObject: (selectedObject) => {
      state.selectedObject = selectedObject;
    }
  };
  const hooks = [];
  let cursor = 0;
  let pending = [];
  const Widget = () => {};
  const { ContextMenu } = load(
    "ContextMenu.tsx",
    {
      react: {
        useCallback: (fn) => fn,
        useRef(initial) {
          const index = cursor++;
          return (hooks[index] ??= { current: initial });
        },
        useState(initial) {
          const index = cursor++;
          const cell = (hooks[index] ??= { value: initial });
          return [
            cell.value,
            (value) => {
              cell.value = value;
            }
          ];
        },
        useEffect(effect, deps) {
          const index = cursor++;
          const previous = hooks[index];
          if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
          pending.push(() => {
            previous?.cleanup?.();
            hooks[index] = { deps, cleanup: effect() };
          });
        }
      },
      "react/jsx-runtime": {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
        Fragment: "fragment"
      },
      "../../../i18n/messages.js": { t: (value) => value },
      "../../../model/drawing-model.js": { TOOL_NAMES: { segment: "Line" } },
      "../../../model/indicator-legend.js": { indicatorShown: () => true },
      "../state.js": { INDICATOR_NAMES: { ma: "MA" } },
      "../context.js": { useTerminal: () => ({ controller, state }) },
      "./controls/ChevronIcon.js": { ChevronIcon: "chevron" },
      "./MobileObjectWidget.js": {
        useMobileObjectWidget: () => mobile,
        MobileObjectWidget: Widget
      },
      "./mobile-object-widget.js": helpers,
      "./mobile-object-menu-dismiss.js": load("mobile-object-menu-dismiss.ts", {}, { Node })
    },
    {
      document,
      Node,
      HTMLElement: Node,
      window: { innerWidth: 392, innerHeight: 783, getSelection: () => null }
    }
  );
  function render() {
    cursor = 0;
    pending = [];
    const tree = ContextMenu();
    hooks[0].current = state.contextMenu
      ? {
          contains: (target) => target.inside,
          querySelector: () => ({
            focus: () => {
              focused = "menu";
            }
          })
        }
      : null;
    for (const effect of pending) effect();
    return tree;
  }
  function dispatch(type, { inside = false, native = () => {}, ...values } = {}) {
    const event = {
      type,
      target: new Node(inside),
      pointerId: 7,
      isPrimary: true,
      pointerType: "touch",
      detail: 1,
      cancelable: true,
      stopped: false,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...values
    };
    for (const entry of [...listeners]) {
      if (entry.type === type && entry.capture) entry.listener(event);
      if (event.stopped) return event;
    }
    native(event);
    for (const entry of [...listeners]) {
      if (entry.type === type && !entry.capture) entry.listener(event);
      if (event.stopped) break;
    }
    return event;
  }
  render();
  return {
    state,
    dispatch,
    render,
    Widget,
    focused: () => focused,
    document,
    onMenuClose: (callback) => {
      onMenuClose = callback;
    },
    dispose: () => hooks.forEach((hook) => hook?.cleanup?.()),
    listeners
  };
}

test("first mobile object-menu outside gesture preserves selection through pointer, native touch and click phases", () => {
  for (const kind of ["drawing", "image"]) {
    const harness = menuDismissHarness({ kind });
    const received = [];
    const canvas = (event) => {
      received.push(event.type);
      if (event.type === "pointerdown") harness.state.selectedObject = null;
    };
    assert.ok(harness.dispatch("pointerdown", { native: canvas }).defaultPrevented);
    assert.equal(harness.state.contextMenu, null);
    assert.equal(harness.state.selectedObject, "selected");
    // Rerender removes the menu while the rest of this same gesture is still pending.
    assert.equal(harness.render().type, harness.Widget);
    for (const type of [
      "touchstart",
      "pointermove",
      "touchmove",
      "pointerup",
      "touchend",
      "mousedown",
      "mouseup",
      "click"
    ])
      assert.ok(harness.dispatch(type, { native: canvas }).defaultPrevented, type);
    assert.deepEqual(received, [], "no slot activation, SDK pan or outside button click");
    assert.equal(harness.state.selectedObject, "selected");
    harness.dispatch("pointerdown", { pointerId: 8, native: canvas });
    harness.dispatch("pointerup", { pointerId: 8, native: canvas });
    harness.dispatch("click", { pointerId: 8, native: canvas });
    assert.equal(harness.state.selectedObject, null);
    assert.equal(harness.render(), null);
    assert.deepEqual(received, ["pointerdown", "pointerup", "click"]);
    harness.dispose();
    assert.equal(harness.listeners.length, 0);
  }
});

test("mobile shield does not swallow menu actions, keyboard Escape or focus restoration", () => {
  const harness = menuDismissHarness();
  let action = false;
  assert.equal(harness.dispatch("pointerdown", { inside: true }).defaultPrevented, false);
  harness.dispatch("click", {
    inside: true,
    native: () => {
      action = true;
    }
  });
  assert.ok(action);
  assert.ok(harness.state.contextMenu);
  assert.equal(harness.focused(), "menu");
  harness.dispatch("keydown", { key: "Escape" });
  assert.equal(harness.state.contextMenu, null);
  assert.equal(harness.state.selectedObject, "selected");
  assert.equal(harness.render().type, harness.Widget);
  assert.equal(harness.focused(), "widget");
  harness.dispose();
});

test("menu Escape survives synchronous widget remount and competing document shortcuts", () => {
  for (const kind of ["drawing", "image"]) {
    const harness = menuDismissHarness({ kind });
    const widget = componentHarness(
      kind === "drawing"
        ? { id: "selected", name: "segment", points: [] }
        : { id: "selected", name: "Photo" }
    );
    const widgetCleanup = widget.effects.map((effect) => effect());
    const widgetKey = widget.handlers.get("keydown").fn;
    let competingEscapes = 0;
    const globalShortcut = (event) => {
      if (event.key === "Escape") {
        competingEscapes++;
        harness.state.selectedObject = null;
      }
    };
    harness.document.addEventListener("keydown", globalShortcut);
    harness.onMenuClose(() => {
      assert.equal(harness.render().type, harness.Widget);
      // Reentrant mount during native dispatch must not turn this Escape into widget dismissal.
      harness.document.addEventListener("keydown", widgetKey);
    });
    const closingEscape = harness.dispatch("keydown", { key: "Escape" });
    assert.ok(closingEscape.defaultPrevented);
    assert.equal(competingEscapes, 0);
    assert.equal(harness.state.selectedObject, "selected");
    assert.equal(harness.state.contextMenu, null);
    assert.equal(harness.focused(), "widget");
    // A handled event is also safe if a reentrant listener is invoked directly.
    widgetKey(closingEscape);
    assert.equal(widget.state.selectedObject, "selected");
    harness.dispatch("keydown", { key: "Escape" });
    assert.equal(competingEscapes, 1);
    assert.equal(widget.state.selectedObject, null);
    assert.equal(harness.state.selectedObject, null);
    assert.equal(harness.render(), null);
    harness.document.removeEventListener("keydown", globalShortcut);
    harness.document.removeEventListener("keydown", widgetKey);
    widgetCleanup.forEach((cleanup) => cleanup());
    harness.dispose();
    assert.equal(harness.listeners.length, 0);
  }
});

test("desktop object menus and mobile chart/indicator menus retain ordinary outside actions", () => {
  for (const options of [{ mobile: false }, { kind: "chart" }, { kind: "indicator" }]) {
    const harness = menuDismissHarness(options);
    let clicked = false;
    harness.dispatch("pointerdown", {
      native: () => {
        harness.state.selectedObject = null;
      }
    });
    harness.dispatch("pointerup");
    harness.dispatch("click", {
      native: () => {
        clicked = true;
      }
    });
    assert.equal(harness.state.contextMenu, null);
    assert.equal(harness.state.selectedObject, null);
    assert.ok(clicked);
    harness.dispose();
  }
});

test("cancelled dismiss gesture cannot block the next pointer or keyboard activation", () => {
  const harness = menuDismissHarness();
  harness.dispatch("pointerdown");
  harness.render();
  harness.dispatch("pointercancel");
  let activations = 0;
  harness.dispatch("click", {
    detail: 0,
    pointerId: -1,
    native: () => {
      activations++;
    }
  });
  harness.dispatch("pointerdown", {
    pointerId: 9,
    native: () => {
      activations++;
    }
  });
  harness.dispatch("click", {
    pointerId: 9,
    native: () => {
      activations++;
    }
  });
  assert.equal(activations, 3);
  harness.dispose();
});

function renderContextMenu({ width, height, mobile, kind = "drawing" }) {
  const state = {
    selectedObject: "selected",
    contextMenu: { x: 128, y: 226, target: { kind, id: "selected" } },
    drawings: kind === "drawing" ? [{ id: "selected", name: "segment", points: [] }] : [],
    images: kind === "image" ? [{ id: "selected", name: "Photo", width: 100 }] : []
  };
  const { ContextMenu } = load(
    "ContextMenu.tsx",
    {
      react: {
        useCallback: (fn) => fn,
        useEffect: () => {},
        useRef: (current) => ({ current }),
        useState: (initial) => [initial === false ? true : initial, () => {}]
      },
      "react/jsx-runtime": {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
        Fragment: "fragment"
      },
      "../../../i18n/messages.js": { t: (value) => value },
      "../../../model/drawing-model.js": { TOOL_NAMES: { segment: "Line" } },
      "../../../model/indicator-legend.js": {},
      "../state.js": {},
      "../context.js": { useTerminal: () => ({ state, controller: {} }) },
      "./controls/ChevronIcon.js": { ChevronIcon: "chevron" },
      "./MobileObjectWidget.js": { useMobileObjectWidget: () => mobile },
      "./mobile-object-widget.js": helpers,
      "./mobile-object-menu-dismiss.js": load("mobile-object-menu-dismiss.ts")
    },
    { window: { innerWidth: width, innerHeight: height } }
  );
  return ContextMenu();
}

test("expanded mobile context menus retain a six pixel lower margin on phone viewports", () => {
  for (const [width, height] of [
    [392, 783],
    [320, 568]
  ]) {
    for (const kind of ["drawing", "image"]) {
      const menu = renderContextMenu({ width, height, mobile: true, kind });
      const { top, maxHeight } = menu.props.style;
      assert.equal(maxHeight, `calc(100dvh - ${top + 6}px)`);
      // The reported 566px expanded menu must scroll instead of crossing the bottom edge.
      const effectiveHeight = Math.min(566, height - top - 6);
      assert.ok(top + effectiveHeight <= height - 6);
      assert.ok(effectiveHeight > 40);
    }
  }
});

test("desktop context menu positioning and height remain unchanged", () => {
  assert.deepEqual(
    plain(renderContextMenu({ width: 1440, height: 900, mobile: false }).props.style),
    {
      left: 128,
      top: 226
    }
  );
});

test("widget clamps all edges on 392x783 and 320x568 without losing drag coordinates", () => {
  for (const [width, height] of [
    [392, 783],
    [320, 568]
  ]) {
    const viewport = { left: 0, top: 0, width, height };
    const size = { width: 306, height: 48 };
    assert.deepEqual(plain(helpers.clampObjectWidget({ x: -200, y: -100 }, size, viewport)), {
      x: 6,
      y: 6
    });
    assert.deepEqual(plain(helpers.clampObjectWidget({ x: 2000, y: 2000 }, size, viewport)), {
      x: width - 312,
      y: height - 54
    });
    assert.deepEqual(plain(helpers.clampObjectWidget({ x: 7, y: 70 }, size, viewport)), {
      x: 7,
      y: 70
    });
  }
});

test("widget reclamps for rotation and an offset visual viewport", () => {
  const bounds = { width: 306, height: 48 };
  const point = helpers.clampObjectWidget({ x: 400, y: 200 }, bounds, {
    left: 0,
    top: 0,
    width: 783,
    height: 392
  });
  assert.deepEqual(
    plain(helpers.clampObjectWidget(point, bounds, { left: 20, top: 90, width: 320, height: 300 })),
    { x: 28, y: 200 }
  );
});

test("only the selected visible object in the active snapshot is exposed", () => {
  const drawing = { id: "line", name: "segment" };
  const image = { id: "image", name: "photo" };
  assert.equal(helpers.selectedWidgetObject("line", [drawing], [image]).drawing, drawing);
  assert.equal(helpers.selectedWidgetObject("image", [drawing], [image]).image, image);
  assert.equal(helpers.selectedWidgetObject(null, [drawing], [image]), null);
  assert.equal(helpers.selectedWidgetObject("other-window", [drawing], [image]), null);
  assert.equal(helpers.selectedWidgetObject("line", [{ ...drawing, visible: false }], []), null);
  assert.equal(helpers.selectedWidgetObject("image", [], [{ ...image, visible: false }]), null);
});

function componentHarness(object) {
  const handlers = new Map();
  const calls = [];
  const effects = [];
  const state = {
    selectedObject: object.id,
    drawings: object.points ? [object] : [],
    images: object.points ? [] : [object]
  };
  const controller = {
    getSnapshot: () => state,
    updateDrawing: async (drawing) => {
      state.drawings = [drawing];
      calls.push(["update", drawing]);
    },
    setContext: (menu) => calls.push(["menu", menu]),
    selectObject: (id) => {
      state.selectedObject = id;
      calls.push(["select", id]);
    },
    tools: { deleteObject: async (id) => calls.push(["delete", id]) },
    notify: (value) => calls.push(["notify", value])
  };
  class Node {}
  class Element extends Node {
    constructor(ancestor = null) {
      super();
      this.ancestor = ancestor;
    }
    closest(selector) {
      return selector.split(", ").includes(this.ancestor) ? this : null;
    }
  }
  const events = {
    addEventListener: (name, fn, capture) => handlers.set(name, { fn, capture }),
    removeEventListener: (name) => handlers.delete(name)
  };
  const module = load(
    "MobileObjectWidget.tsx",
    {
      react: {
        useCallback: (fn) => fn,
        useEffect: (fn) => effects.push(fn),
        useLayoutEffect: () => {},
        useRef: (current) => ({ current }),
        useState: (value) => [value, () => {}],
        useSyncExternalStore: (_subscribe, get) => get()
      },
      "react/jsx-runtime": {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
        Fragment: "fragment"
      },
      "../../../i18n/messages.js": { t: (value) => value },
      "../../../model/drawing-model.js": {
        TOOL_NAMES: Object.fromEntries(tools.map((name) => [name, name])),
        drawingStyle: (drawing) => ({
          color: "#f4df30",
          width: 2,
          lineStyle: "solid",
          ...drawing.settings
        })
      },
      "../context.js": { useTerminal: () => ({ controller, state }) },
      "./mobile-object-widget.js": helpers
    },
    { document: events, Node, Element, window: { innerWidth: 392, innerHeight: 783 } }
  );
  const tree = module.MobileObjectWidget();
  const nodes = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    for (const child of [node.props?.children].flat(Infinity)) visit(child);
  }
  visit(tree);
  const find = (label) => nodes.find((node) => node.props?.["aria-label"] === label);
  return {
    tree,
    nodes,
    find,
    calls,
    state,
    effects,
    handlers,
    Node,
    Element,
    render: module.MobileObjectWidget
  };
}

test("all existing drawing types expose working style controls and preserve previous edits", () => {
  for (const name of tools) {
    const harness = componentHarness({
      id: name,
      name,
      points: [],
      settings: { text: "Retained" }
    });
    harness.find("Цвет линий").props.onChange({ currentTarget: { value: "#ff0000" } });
    harness.find("Цвет текста").props.onChange({ currentTarget: { value: "#00ff00" } });
    harness.find("Толщина линии").props.onChange({ currentTarget: { value: "4" } });
    harness.find("Стиль линии").props.onChange({ currentTarget: { value: "dotted" } });
    const settings = harness.state.drawings[0].settings;
    assert.deepEqual(plain(settings), {
      text: "Retained",
      color: "#ff0000",
      ...(name.startsWith("fibonacci") ? { oneColor: true } : {}),
      textColor: "#00ff00",
      width: 4,
      lineStyle: "dotted"
    });
    harness.find("Удалить").props.onClick();
    assert.deepEqual(harness.calls.at(-1), ["delete", name]);
    harness.find("Другие действия").props.onClick({
      currentTarget: { getBoundingClientRect: () => ({ left: 100, bottom: 140 }) }
    });
    assert.deepEqual(plain(harness.calls.at(-1)), [
      "menu",
      { x: 100, y: 144, target: { kind: "drawing", id: name } }
    ]);
  }
});

test("images expose only applicable actions and ellipsis opens the image menu", () => {
  const harness = componentHarness({ id: "photo", name: "Photo" });
  assert.equal(harness.find("Цвет линий"), undefined);
  assert.equal(harness.find("Цвет текста"), undefined);
  assert.equal(harness.find("Толщина линии"), undefined);
  assert.equal(harness.find("Стиль линии"), undefined);
  harness.find("Удалить").props.onClick();
  assert.deepEqual(harness.calls.at(-1), ["delete", "photo"]);
  harness
    .find("Другие действия")
    .props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 12, bottom: 80 }) } });
  assert.deepEqual(plain(harness.calls.at(-1)), [
    "menu",
    { x: 12, y: 84, target: { kind: "image", id: "photo" } }
  ]);
});

test("outside dismissal runs in capture phase and never consumes the canvas pointer event", () => {
  const harness = componentHarness({ id: "line", name: "segment", points: [] });
  const cleanup = harness.effects.map((effect) => effect());
  assert.equal(harness.handlers.get("pointerdown").capture, true);
  harness.handlers.get("pointerdown").fn({
    target: new harness.Node(),
    preventDefault: () => assert.fail("canvas event consumed"),
    stopPropagation: () => assert.fail("canvas propagation stopped")
  });
  assert.deepEqual(harness.calls.at(-1), ["select", null]);
  for (const remove of cleanup) remove();
  assert.equal(harness.handlers.size, 0);
});

test("native toolbar, menu and object-tree transitions retain the selected object", () => {
  for (const object of [
    { id: "line", name: "segment", points: [] },
    { id: "image", name: "Photo" }
  ]) {
    const harness = componentHarness(object);
    const cleanup = harness.effects.map((effect) => effect());
    const dispatch = (type, target) =>
      harness.handlers.get(type).fn({
        target,
        preventDefault: () => assert.fail("related control event consumed"),
        stopPropagation: () => assert.fail("related control propagation stopped")
      });
    // Tap the left lock, focus the portalled sheet, activate its row, restore trigger focus.
    for (const [type, ancestor] of [
      ["pointerdown", ".drawing-toolbar"],
      ["focusin", "#drawing-toolbar-menu"],
      ["pointerdown", "#drawing-toolbar-menu"],
      ["focusin", ".drawing-toolbar"],
      ["pointerdown", "#objects-view"],
      ["focusin", "#objects-view"]
    ]) {
      dispatch(type, new harness.Element(ancestor));
      assert.equal(harness.state.selectedObject, object.id, `${type}: ${ancestor}`);
    }
    assert.deepEqual(harness.calls, []);
    dispatch("pointerdown", new harness.Element());
    assert.equal(harness.state.selectedObject, null, "blank chart still deselects");
    for (const remove of cleanup) remove();
    assert.equal(harness.handlers.size, 0);
  }
});

test("Escape dismisses the selection and handle uses pointer capture without opening a menu", () => {
  const harness = componentHarness({ id: "line", name: "segment", points: [] });
  harness.effects.forEach((effect) => effect());
  let prevented = false;
  harness.handlers.get("keydown").fn({
    key: "Escape",
    preventDefault: () => {
      prevented = true;
    }
  });
  assert.ok(prevented);
  assert.deepEqual(harness.calls.at(-1), ["select", null]);
  const capture = [];
  const handle = harness.find("Переместить панель");
  const target = {
    setPointerCapture: (id) => capture.push(["capture", id]),
    hasPointerCapture: () => true,
    releasePointerCapture: (id) => capture.push(["release", id])
  };
  handle.props.onPointerDown({
    button: 0,
    pointerId: 7,
    clientX: 15,
    clientY: 100,
    preventDefault() {},
    currentTarget: target
  });
  handle.props.onPointerUp({ pointerId: 7, currentTarget: target });
  assert.deepEqual(capture, [
    ["capture", 7],
    ["release", 7]
  ]);
  assert.equal(
    harness.calls.some(([type]) => type === "menu"),
    false
  );
});

test("dragged position survives widget remounts for the same controller", () => {
  const harness = componentHarness({ id: "line", name: "segment", points: [] });
  harness.tree.props.ref.current = { getBoundingClientRect: () => ({ width: 306, height: 48 }) };
  const handle = harness.find("Переместить панель");
  handle.props.onPointerDown({
    button: 0,
    pointerId: 1,
    clientX: 12,
    clientY: 108,
    preventDefault() {},
    currentTarget: { setPointerCapture() {} }
  });
  handle.props.onPointerMove({ pointerId: 1, clientX: 60, clientY: 300 });
  assert.deepEqual(plain(harness.render().props.style), { left: 60, top: 300 });
});
