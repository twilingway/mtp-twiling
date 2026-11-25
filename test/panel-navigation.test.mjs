import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(
  readFileSync(new URL("../src/screens/terminal/controller-panel.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { exports: module.exports, module, Promise });
const { TerminalPanel } = module.exports;

function fixture() {
  const state = {
    owner: "one",
    preferences: { rightPanelCollapsed: false, rightPanelTab: "watchlist", sidebarWidth: 413 }
  };
  const controller = {
    getSnapshot: () => state,
    update: (patch) => Object.assign(state, patch),
    setPreferences: async (patch) => Object.assign(state.preferences, patch)
  };
  return { state, controller, panel: new TerminalPanel(controller) };
}

test("rapid repeated desktop clicks close and reopen without losing width", async () => {
  const { state, panel } = fixture();
  await Promise.all([panel.select("watchlist"), panel.select("watchlist")]);
  assert.equal(state.preferences.rightPanelCollapsed, false);
  assert.equal(state.preferences.sidebarWidth, 413);
  await panel.select("objects");
  assert.equal(state.preferences.rightPanelTab, "objects");
  assert.equal(state.preferences.rightPanelCollapsed, false);
});

test("mobile starts with chart despite desktop open and first tap opens list", async () => {
  const { state, panel } = fixture();
  assert.equal(!!state.mobilePanelOpen, false);
  await panel.select("watchlist", true, true);
  assert.equal(state.mobilePanelOpen, true);
  await panel.select("watchlist", true, true);
  assert.equal(state.mobilePanelOpen, false);
  await panel.select("objects", false);
  assert.equal(state.mobilePanelOpen, true);
  assert.equal(state.preferences.rightPanelTab, "objects");
});

test("failed save leaves presentation intact and queue remains usable", async () => {
  const { state, controller, panel } = fixture();
  const save = controller.setPreferences;
  controller.setPreferences = async () => {
    throw new Error("quota");
  };
  await assert.rejects(panel.select("objects"), /quota/);
  assert.equal(state.mobilePanelOpen, undefined);
  assert.equal(state.preferences.rightPanelTab, "watchlist");
  controller.setPreferences = save;
  await panel.select("objects");
  assert.equal(state.preferences.rightPanelTab, "objects");
});

test("completion from previous owner cannot open mobile panel of new owner", async () => {
  const { state, controller, panel } = fixture();
  let release;
  controller.setPreferences = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = panel.select("objects", false);
  await Promise.resolve();
  state.owner = "two";
  release();
  await pending;
  assert.equal(state.mobilePanelOpen, undefined);
});

test("return to chart supersedes pending mobile opens and later opens still work", async () => {
  const { state, controller, panel } = fixture();
  const save = controller.setPreferences;
  let release;
  controller.setPreferences = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = panel.select("watchlist", true, true);
  await Promise.resolve();
  panel.closeMobile();
  release();
  await pending;
  assert.equal(state.mobilePanelOpen, false);
  controller.setPreferences = save;
  await panel.select("watchlist", true, true);
  assert.equal(state.mobilePanelOpen, true);
});
