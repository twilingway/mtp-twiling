import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

const { installTerminalViewport } = createSourceLoader()("browser/terminal-viewport.js");

// Synthetic geometry verifies the sizing boundary, not native Android browser-toolbar behavior.
function setup() {
  const viewport = Object.assign(new EventTarget(), { height: 700, offsetTop: 0, scale: 1 });
  const frames = new Map();
  let id = 0;
  const target = Object.assign(new EventTarget(), {
    visualViewport: viewport,
    innerHeight: 800,
    requestAnimationFrame(callback) {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame(frame) {
      frames.delete(frame);
    }
  });
  const writes = [];
  const stop = installTerminalViewport(target, {
    setProperty: (...args) => writes.push(args),
    removeProperty: (name) => writes.push([name, null])
  });
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  const resize = () => viewport.dispatchEvent(new Event("resize"));
  return { viewport, target, frames, writes, stop, flush, resize };
}

test("shell follows visible browser bounds, rotation and keyboard pan without duplicate writes", () => {
  const env = setup();
  assert.equal(env.writes.at(-1)[1], "700px");
  env.viewport.height = 760;
  env.resize();
  env.resize();
  assert.equal(env.frames.size, 1);
  env.flush();
  assert.equal(env.writes.at(-1)[1], "760px");
  env.resize();
  env.flush();
  assert.equal(env.writes.length, 2);
  env.target.innerHeight = 400;
  env.target.dispatchEvent(new Event("resize"));
  env.flush();
  assert.equal(env.writes.at(-1)[1], "400px");
  env.viewport.height = 220;
  env.viewport.offsetTop = 45;
  env.resize();
  env.flush();
  assert.equal(env.writes.at(-1)[1], "265px");
  env.viewport.offsetTop = 60;
  env.viewport.dispatchEvent(new Event("scroll"));
  env.flush();
  assert.equal(env.writes.at(-1)[1], "280px");
  env.viewport.height = 400;
  env.viewport.offsetTop = 0;
  env.resize();
  env.flush();
  assert.equal(env.writes.at(-1)[1], "400px");
  env.target.innerHeight = 800;
  env.viewport.height = 800;
  env.resize();
  env.flush();
  assert.equal(env.writes.at(-1)[1], "800px");
});

test("pinch zoom and invalid transient geometry leave the shell size unchanged", () => {
  const env = setup();
  env.viewport.scale = 2;
  env.viewport.height = 350;
  env.resize();
  env.flush();
  env.viewport.scale = 1;
  env.viewport.height = 0;
  env.resize();
  env.flush();
  env.viewport.height = NaN;
  env.resize();
  env.flush();
  assert.equal(env.writes.length, 1);
  env.viewport.height = 780;
  env.resize();
  env.flush();
  assert.equal(env.writes.at(-1)[1], "780px");
});

test("disposing removes listeners and cancels the queued viewport update", () => {
  const env = setup();
  env.resize();
  env.stop();
  assert.equal(env.frames.size, 0);
  assert.equal(env.writes.at(-1)[1], null);
  env.resize();
  env.target.dispatchEvent(new Event("resize"));
  env.viewport.dispatchEvent(new Event("scroll"));
  assert.equal(env.frames.size, 0);
});

test("browsers without visualViewport retain CSS viewport sizing", () => {
  const stop = installTerminalViewport(
    { visualViewport: null },
    {
      setProperty: () => assert.fail("CSS fallback must be retained"),
      removeProperty: () => assert.fail("nothing was installed")
    }
  );
  stop();
});

test("mobile viewport stylesheet overrides the active Drive banner's stronger root height", () => {
  const read = (file) => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
  const banner = read("google-drive-settings.css");
  const viewport = read("terminal-viewport.css");
  const html = read("index.html");
  // This guards the known specificity/order conflict. Computed layout still needs browser QA.
  const legacySelector = banner.match(/(#root:has\([^{}]+\))\s*\{[^}]*\bheight:\s*100dvh;/)?.[1];
  assert.ok(legacySelector, "the banner's independent viewport-height rule is covered");
  const mobileRules = viewport.match(
    /@media \(max-width: 800px\), \(pointer: coarse\) \{([\s\S]*)\}\s*$/
  )?.[1];
  assert.ok(mobileRules, "the override is limited to mobile/coarse-pointer layouts");
  const rootRule = [...mobileRules.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(
    ([, selectors, body]) =>
      selectors
        .split(",")
        .map((selector) => selector.trim())
        .includes(legacySelector) && /\bheight:\s*100%;/.test(body)
  );
  assert.ok(rootRule, "the active banner retains the body's capped height with equal specificity");
  assert.ok(
    html.indexOf('href="./terminal-viewport.css"') >
      html.indexOf('href="./google-drive-settings.css"'),
    "the equal-specificity override loads after the banner stylesheet"
  );
});
