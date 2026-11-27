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
  window.dispatchEvent(new Event("resize"));
  window.visualViewport.dispatchEvent(new Event("resize"));
  assert.equal(closed, 4);
  cleanup();
  scroll.dispatchEvent(new Event("scroll"));
  assert.equal(closed, 4);
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

test("account popover follows keyboard viewport changes without dismissing or refocusing", (t) => {
  const saved = { window: globalThis.window, document: globalThis.document };
  t.after(() => Object.assign(globalThis, saved));
  const effects = [],
    positions = [],
    frames = new Map();
  let focused = 0,
    closed = 0,
    reads = 0,
    frameId = 0;
  const visibilityScrolls = [];
  let searchBounds = { top: 435, bottom: 455 };
  const search = {
    getBoundingClientRect: () => searchBounds,
    scrollIntoView: (options) => visibilityScrolls.push(options)
  };
  const panel = {
    getBoundingClientRect: () => {
      reads++;
      return { width: 328, height: 700, top: 50.5, bottom: 422 };
    },
    contains: (node) => node === search,
    querySelector: () => ({ focus: () => focused++ })
  };
  const strip = new EventTarget();
  const anchor = {
    current: {
      getBoundingClientRect: () => {
        reads++;
        return { left: 8, top: 4, bottom: 44 };
      },
      closest: () => strip
    }
  };
  const window = new EventTarget();
  window.visualViewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 0,
    width: 392,
    height: 800
  });
  window.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.window = window;
  globalThis.document = Object.assign(new EventTarget(), {
    activeElement: search,
    body: { append() {} },
    createElement: () => ({ remove() {} })
  });
  const load = createSourceLoader({
    react: {
      useEffectEvent: (callback) => callback,
      useRef: () => ({ current: panel }),
      useState: (initial) => [
        initial ? initial() : positions.at(-1),
        (value) => positions.push(value)
      ],
      useLayoutEffect: (callback) => effects.push(callback)
    },
    "react-dom": { createPortal: (node) => node },
    "react/jsx-runtime": { jsx, jsxs: jsx }
  });
  const { ToolbarPopover } = load("screens/terminal/ToolbarPopover.js");
  ToolbarPopover({
    anchor,
    open: true,
    resizeBehavior: "reposition",
    onClose: () => closed++,
    children: "zone search"
  });
  const detach = effects[0]();
  const cleanup = effects[1]();
  assert.equal(positions.at(-1).maxHeight, 742);
  window.visualViewport.height = 380;
  window.visualViewport.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new Event("resize"));
  window.visualViewport.dispatchEvent(new Event("scroll"));
  assert.equal(frames.size, 1);
  assert.equal(reads, 2);
  const flush = () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
  };
  flush();
  assert.equal(reads, 4);
  assert.equal(positions.at(-1).maxHeight, 322);
  assert.equal(positions.at(-1)["--toolbar-popover-height"], "322px");
  assert.equal(focused, 1);
  assert.equal(closed, 0);
  const recheckVisibility = () => {
    ToolbarPopover({
      anchor,
      open: true,
      resizeBehavior: "reposition",
      onClose: () => closed++,
      children: "zone search"
    });
    effects.at(-1)();
  };
  recheckVisibility();
  assert.deepEqual(visibilityScrolls, [{ block: "nearest", inline: "nearest" }]);
  assert.equal(focused, 1);
  searchBounds = { top: 350, bottom: 370 };
  recheckVisibility();
  assert.equal(visibilityScrolls.length, 1);
  window.visualViewport.offsetTop = 70;
  window.visualViewport.dispatchEvent(new Event("scroll"));
  flush();
  assert.equal(positions.at(-1).top, 78);
  assert.equal(positions.at(-1).maxHeight, 364);
  window.visualViewport.dispatchEvent(new Event("resize"));
  assert.equal(frames.size, 1);
  cleanup();
  assert.equal(frames.size, 0);
  window.dispatchEvent(new Event("resize"));
  window.visualViewport.dispatchEvent(new Event("scroll"));
  assert.equal(frames.size, 0);
  assert.equal(closed, 0);
  detach();
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
