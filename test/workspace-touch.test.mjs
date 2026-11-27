import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

test("stacked narrow charts release vertical touch and restore chart dragging in one-pane mode", () => {
  const { observeWorkspaceTouchScroll } = sourceLoader()("charts/workspace-touch.ts");
  const originalMedia = globalThis.matchMedia;
  const originalObserver = globalThis.MutationObserver;
  let observeLayout;
  let observeMedia;
  let cleaned = false;
  const media = {
    matches: true,
    addEventListener: (_, callback) => (observeMedia = callback),
    removeEventListener: () => (observeMedia = undefined)
  };
  globalThis.matchMedia = () => media;
  globalThis.MutationObserver = class {
    constructor(callback) {
      observeLayout = callback;
    }
    observe() {}
    disconnect() {
      cleaned = true;
    }
  };
  try {
    const touched = [];
    const workspace = { dataset: { chartCount: "1" } };
    const stop = observeWorkspaceTouchScroll({ closest: () => workspace }, (allow) =>
      touched.push(allow)
    );
    workspace.dataset.chartCount = "16";
    observeLayout();
    media.matches = false;
    observeMedia();
    media.matches = true;
    observeMedia();
    workspace.dataset.chartCount = "1";
    observeLayout();
    assert.deepEqual(touched, [false, true, false, true]);
    stop();
    assert.equal(observeMedia, undefined);
    assert.equal(cleaned, true);
  } finally {
    globalThis.matchMedia = originalMedia;
    globalThis.MutationObserver = originalObserver;
  }
});

test("multi-chart price-axis touch enables native scaling and releases back to workspace scroll", () => {
  const { observeWorkspaceTouchScroll } = sourceLoader()("charts/workspace-touch.ts");
  const originalMedia = globalThis.matchMedia;
  const originalObserver = globalThis.MutationObserver;
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {}
  });
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  try {
    const listeners = new Map(),
      changes = [];
    const container = {
      closest: () => ({ dataset: { chartCount: "4" } }),
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name)
    };
    const stop = observeWorkspaceTouchScroll(
      container,
      (value) => changes.push(value),
      () => ({ width: 340, height: 270 })
    );
    assert.deepEqual(changes, [false]);
    const start = (x, y) =>
      listeners.get("touchstart")({ touches: [{ clientX: x + 10, clientY: y + 20 }] });
    start(360, 100);
    assert.deepEqual(changes, [false, true]);
    listeners.get("touchend")();
    assert.deepEqual(changes, [false, true, false]);
    start(100, 100); // Plot vertical swipe must still reach workspace scrolling.
    start(360, 280); // Time-axis corner is not a price-axis target.
    assert.deepEqual(changes, [false, true, false]);
    start(360, 100);
    listeners.get("touchcancel")();
    assert.deepEqual(changes, [false, true, false, true, false]);
    stop();
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.matchMedia = originalMedia;
    globalThis.MutationObserver = originalObserver;
  }
});
