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
