import assert from "node:assert/strict";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const jsx = (type, props) => ({ type, props });

test("toolbar wheel scrolls one shared strip while preserving zoom and boundary scrolling", () => {
  const listeners = new Map();
  let cleanup;
  const strip = {
    clientWidth: 300,
    scrollWidth: 900,
    scrollLeft: 0,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name)
  };
  const load = createSourceLoader({
    react: {
      useRef: () => ({ current: strip }),
      useEffect: (effect) => (cleanup = effect())
    },
    "react/jsx-runtime": { jsx, jsxs: jsx }
  });
  const { ToolbarScroll } = load("screens/terminal/ToolbarScroll.js");
  const tree = ToolbarScroll({ children: "controls" });
  const wheel = listeners.get("wheel");
  let prevented = 0;
  const event = {
    deltaX: 0,
    deltaY: 80,
    deltaMode: 0,
    preventDefault: () => prevented++
  };
  wheel(event);
  assert.equal(strip.scrollLeft, 80);
  assert.equal(prevented, 1);
  wheel({ ...event, ctrlKey: true });
  wheel({ ...event, deltaX: 100 });
  assert.equal(strip.scrollLeft, 80);
  assert.equal(prevented, 1);
  strip.scrollLeft = 600;
  wheel(event);
  assert.equal(prevented, 1);
  tree.props.onKeyDown({
    key: "Home",
    target: strip,
    currentTarget: strip,
    preventDefault: () => prevented++
  });
  assert.equal(strip.scrollLeft, 0);
  tree.props.onKeyDown({
    key: "ArrowRight",
    target: { tagName: "SELECT" },
    currentTarget: strip,
    preventDefault: () => assert.fail("child keyboard input must remain native")
  });
  assert.equal(strip.scrollLeft, 0);
  cleanup();
  assert.equal(listeners.size, 0);
});

test("toolbar popover escapes the strip, clamps its anchor and dismisses on strip scroll", (t) => {
  const saved = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  t.after(() => Object.assign(globalThis, saved));
  class Element {}
  globalThis.Node = Element;
  const scroll = new EventTarget();
  const outside = new Element();
  const inside = new Element();
  let focused = 0,
    closed = 0,
    position;
  const effects = [];
  const host = {
    remove() {
      this.parent = null;
    }
  };
  const fullscreen = { append: (node) => (node.parent = fullscreen) };
  const body = { append: (node) => (node.parent = body) };
  const panel = {
    getBoundingClientRect: () => ({ width: 260, height: 300 }),
    contains: (node) => node === inside,
    querySelector: () => ({ focus: () => focused++ })
  };
  const anchor = {
    current: {
      getBoundingClientRect: () => ({ left: 350, top: 4, bottom: 36 }),
      closest: () => scroll,
      contains: () => false
    }
  };
  const window = new EventTarget();
  window.visualViewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 0,
    width: 390,
    height: 700
  });
  globalThis.window = window;
  globalThis.document = Object.assign(new EventTarget(), {
    fullscreenElement: fullscreen,
    body,
    createElement: () => host
  });
  const load = createSourceLoader({
    react: {
      useEffectEvent: (callback) => callback,
      useRef: () => ({ current: panel }),
      useState: (initial) => [initial ? initial() : undefined, (value) => (position = value)],
      useLayoutEffect: (callback) => effects.push(callback)
    },
    "react-dom": { createPortal: (node, host) => ({ node, host }) },
    "react/jsx-runtime": { jsx, jsxs: jsx }
  });
  const { ToolbarPopover } = load("screens/terminal/ToolbarPopover.js");
  const popup = ToolbarPopover({ anchor, open: true, onClose: () => closed++, children: "menu" });
  assert.equal(popup.host, host);
  const detach = effects[0]();
  const cleanup = effects[1]();
  assert.equal(host.parent, fullscreen);
  document.fullscreenElement = null;
  document.dispatchEvent(new Event("fullscreenchange"));
  assert.equal(host.parent, body);
  assert.equal(popup.host, host);
  assert.equal(position.left, 122);
  assert.equal(position.top, 42);
  assert.equal(focused, 1);
  const pointer = (target) => {
    const event = new Event("pointerdown");
    Object.defineProperty(event, "target", { value: target });
    document.dispatchEvent(event);
  };
  pointer(inside);
  assert.equal(closed, 0);
  pointer(outside);
  assert.equal(closed, 1);
  scroll.dispatchEvent(new Event("scroll"));
  assert.equal(closed, 2);
  cleanup();
  scroll.dispatchEvent(new Event("scroll"));
  assert.equal(closed, 2);
  const retained = ToolbarPopover({
    anchor,
    open: false,
    keepMounted: true,
    onClose() {},
    children: "install-ids"
  });
  assert.equal(retained.node.props.hidden, true);
  assert.equal(retained.node.props.children, "install-ids");
  detach();
  assert.equal(host.parent, null);
});

test("calendar badges use D/W/M in English without changing interval IDs or durations", () => {
  const load = createSourceLoader();
  const { getInterval } = load("model/intervals/registry.js");
  const { NATIVE_PERIOD_LABELS, NATIVE_TIMEFRAME_CONFIG } = load(
    "model/intervals/native-timeframes.js"
  );
  const { t } = load("i18n/messages.js");
  for (const [id, ru, en, ms] of [
    ["1d", "Д", "D", 86400000],
    ["1w", "Н", "W", 604800000],
    ["1M", "М", "M", null]
  ]) {
    assert.equal(getInterval(id).id, id);
    assert.equal(getInterval(id).shortLabel, ru);
    assert.equal(NATIVE_PERIOD_LABELS[id], ru);
    assert.equal(t(ru, "en"), en);
    assert.equal(NATIVE_TIMEFRAME_CONFIG[id].ms, ms);
  }
  assert.equal(getInterval("1m").shortLabel, "1м");
  assert.equal(NATIVE_TIMEFRAME_CONFIG["1m"].ms, 60000);
});
