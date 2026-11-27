import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const jsx = (type, props) => ({ type, props });

function fixture(t, mobile) {
  const saved = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  let cleanup;
  t.after(() => {
    cleanup?.();
    Object.assign(globalThis, saved);
  });
  globalThis.Node = class {};
  const window = new EventTarget();
  window.innerHeight = 700;
  window.matchMedia = () => ({ matches: mobile });
  window.visualViewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 0,
    width: 390,
    height: 700
  });
  const body = { style: { overflow: "scroll" } };
  const fullscreen = {};
  const document = Object.assign(new EventTarget(), {
    body,
    fullscreenElement: fullscreen,
    activeElement: null
  });
  globalThis.window = window;
  globalThis.document = document;
  const selected = {
    focus: () => (document.activeElement = selected),
    scrollIntoView() {}
  };
  const last = { focus: () => (document.activeElement = last) };
  const scroller = new EventTarget();
  let focusedTrigger = 0;
  const trigger = {
    getBoundingClientRect: () => ({ left: 250, top: 0, bottom: 40 }),
    closest: () => scroller,
    contains: () => false,
    focus: () => focusedTrigger++
  };
  const panel = {
    querySelector: () => selected,
    querySelectorAll: () => [selected, last],
    contains: () => false
  };
  let stateIndex = 0,
    refIndex = 0,
    effect,
    portalTarget;
  const states = [],
    chosen = [],
    favorites = [];
  const load = createSourceLoader({
    react: {
      useId: () => "timeframes",
      useState: (initial) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (value) => (states[index] = typeof value === "function" ? value(states[index]) : value)
        ];
      },
      useRef: () => ({ current: refIndex++ === 0 ? trigger : panel }),
      useEffect: (callback) => (effect = callback)
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    "react-dom": {
      createPortal: (node, target) => {
        portalTarget = target;
        return node;
      }
    }
  });
  const { TimeframeMenu } = load("screens/terminal/intervals/TimeframeMenu.js");
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return TimeframeMenu({
      value: "1d",
      favorites: ["1m", "1d"],
      availability: { "45m": "Source unavailable" },
      onSelect: (id) => chosen.push(id),
      onToggleFavorite: (id) => favorites.push(id)
    });
  };
  find(render(), (node) => node.props?.className === "interval-menu-trigger").props.onClick();
  const tree = render();
  cleanup = effect();
  return {
    tree,
    render,
    panel,
    selected,
    last,
    document,
    body,
    chosen,
    favorites,
    scroller,
    portalTarget: () => portalTarget,
    fullscreen,
    focusedTrigger: () => focusedTrigger,
    cleanup
  };
}

test("mobile timeframe tap opens a full-width modal sheet and preserves interval/favorite actions", (t) => {
  const f = fixture(t, true);
  const trigger = find(f.tree, (node) => node.props?.className === "interval-menu-trigger");
  assert.equal(trigger.props.children.type, "svg");
  assert.equal(trigger.props.children.props.width, "20");
  assert.match(trigger.props["aria-label"], /День$/);
  assert.equal(
    find(f.tree, (node) => node.props?.["data-interval-favorite"] === "1d").props["aria-pressed"],
    true
  );
  const dialog = find(f.tree, (node) => node.props?.role === "dialog");
  assert.equal(dialog.props["aria-modal"], true);
  assert.equal(dialog.props["data-mobile-sheet"], true);
  assert.deepEqual(dialog.props.style, {
    left: 0,
    bottom: 0,
    width: 390,
    maxWidth: 390,
    maxHeight: 600
  });
  assert.equal(f.portalTarget(), f.fullscreen);
  assert.equal(f.body.style.overflow, "hidden");
  assert.equal(f.document.activeElement, f.selected);
  assert.ok(find(dialog, (node) => node.props?.className === "interval-menu-category"));
  assert.equal(
    find(dialog, (node) => node.props?.className === "interval-menu-add").props.disabled,
    true
  );
  const unavailable = find(dialog, (node) => node.props?.title === "Source unavailable");
  assert.equal(unavailable.props.disabled, true);
  find(
    dialog,
    (node) => node.props?.className === "interval-menu-star is-favorite"
  ).props.onClick();
  assert.deepEqual(f.favorites, ["1m"]);
  assert.equal(
    find(f.render(), (node) => node.props?.className === "interval-menu-trigger").props[
      "aria-expanded"
    ],
    true
  );
  find(dialog, (node) => node.props?.["data-selected"] === true).props.onClick();
  assert.deepEqual(f.chosen, ["1d"]);
  assert.equal(f.focusedTrigger(), 1);
  assert.equal(
    find(f.render(), (node) => node.props?.role === "dialog"),
    null
  );
  f.cleanup();
  assert.equal(f.body.style.overflow, "scroll");
});

test("mobile sheet wraps keyboard focus and closes through Escape and the backdrop", (t) => {
  const f = fixture(t, true);
  const dialog = find(f.tree, (node) => node.props?.role === "dialog");
  let prevented = 0;
  const event = { currentTarget: f.panel, preventDefault: () => prevented++, stopPropagation() {} };
  f.document.activeElement = f.last;
  dialog.props.onKeyDown({ ...event, key: "Tab" });
  assert.equal(f.document.activeElement, f.selected);
  dialog.props.onKeyDown({ ...event, key: "Tab", shiftKey: true });
  assert.equal(f.document.activeElement, f.last);
  assert.equal(prevented, 2);
  dialog.props.onKeyDown({ ...event, key: "Escape" });
  assert.equal(
    find(f.render(), (node) => node.props?.role === "dialog"),
    null
  );
  find(f.render(), (node) => node.props?.className === "interval-menu-trigger").props.onClick();
  const backdrop = find(f.render(), (node) => node.props?.className === "interval-menu-backdrop");
  backdrop.props.onPointerDown(event);
  backdrop.props.onClick();
  assert.equal(
    find(f.render(), (node) => node.props?.role === "dialog"),
    null
  );
  assert.equal(f.focusedTrigger(), 2);
});

test("desktop keeps the anchored dropdown without a modal backdrop or body lock", (t) => {
  const f = fixture(t, false);
  const dialog = find(f.tree, (node) => node.props?.role === "dialog");
  assert.equal(dialog.props["aria-modal"], undefined);
  assert.equal(dialog.props["data-mobile-sheet"], undefined);
  assert.equal(dialog.props.style.top, 46);
  assert.equal(dialog.props.style.maxWidth, 296);
  assert.equal(
    find(f.tree, (node) => node.props?.className === "interval-menu-backdrop"),
    null
  );
  assert.equal(f.body.style.overflow, "scroll");
  f.scroller.dispatchEvent(new Event("scroll"));
  assert.equal(
    find(f.render(), (node) => node.props?.role === "dialog"),
    null
  );
});

test("recovery barrier locks chart controls while leaving the account ancestor interactive", (t) => {
  const saved = globalThis.document;
  t.after(() => (globalThis.document = saved));
  const account = { inert: false },
    timeframe = { inert: false },
    chart = { inert: true };
  let effect;
  globalThis.document = {
    querySelectorAll(selector) {
      assert.ok(selector.includes(".toolbar-scroll > :not(.terminal-brand-menu)"));
      assert.ok(!selector.includes(".topbar >"), "the scrolling ancestor must stay interactive");
      return [timeframe, chart];
    }
  };
  const load = createSourceLoader({
    react: { useEffect: (callback) => (effect = callback) },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.js": {
      useTerminal: () => ({ state: { importRecoveryRequired: true } })
    }
  });
  load("screens/terminal/TransferMutationBarrier.js").TransferMutationBarrier();
  const cleanup = effect();
  assert.equal(timeframe.inert, true);
  assert.equal(chart.inert, true);
  assert.equal(account.inert, false);
  cleanup();
  assert.equal(timeframe.inert, false);
  assert.equal(chart.inert, true);
});
