import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const { enterTerminalFullscreen, isTerminalFullscreen } = sourceLoader()(
  "screens/terminal/terminal-fullscreen.ts"
);

test("fullscreen immediately requests the document root and asks to hide browser navigation", async () => {
  const calls = [];
  const documentElement = {
    async requestFullscreen(options) {
      calls.push([this, options]);
    }
  };
  const target = { documentElement, fullscreenEnabled: true };
  const entered = enterTerminalFullscreen(target);
  assert.deepEqual(calls, [[documentElement, { navigationUI: "hide" }]]);
  assert.equal(await entered, true);
});

test("fullscreen denial or missing support is available to the focus-mode fallback", async () => {
  const missing = { fullscreenEnabled: false, documentElement: {} };
  assert.equal(await enterTerminalFullscreen(missing), false);
  const requestFullscreen = async () => {
    throw new TypeError("Fullscreen is blocked");
  };
  assert.equal(
    await enterTerminalFullscreen({
      fullscreenEnabled: true,
      documentElement: { requestFullscreen }
    }),
    false
  );
});

test("only fullscreen on the document root represents the terminal fullscreen mode", () => {
  const documentElement = {};
  const target = { documentElement, fullscreenElement: null };
  assert.equal(isTerminalFullscreen(target), false);
  target.fullscreenElement = {};
  assert.equal(isTerminalFullscreen(target), false);
  target.fullscreenElement = documentElement;
  assert.equal(isTerminalFullscreen(target), true);
  target.fullscreenElement = null;
  assert.equal(isTerminalFullscreen(target), false);
});
