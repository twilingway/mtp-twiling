import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function fixture(setTimeframe) {
  const state = { owner: "first", preferences: { timeframe: "4h" } };
  const selections = [];
  const publications = [];
  const controller = {
    getSnapshot: () => state,
    setTimeframe:
      setTimeframe ??
      (async (id) => {
        selections.push(id);
        state.preferences.timeframe = id;
      })
  };
  const jsx = (type, props) => ({ type, props });
  const load = createSourceLoader({
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.js": { useTerminal: () => ({ state, controller }) },
    "screens/terminal/workspace-sync-controller.js": {
      publishWorkspaceTimeframe: (source, id) => publications.push([source, id])
    }
  });
  load("i18n/preferences.js").setDisplayPreferences({ locale: "en" });
  const { InlineTimeframeControl } = load("screens/terminal/intervals/InlineTimeframeControl.js");
  const render = (props) => find(InlineTimeframeControl(props), (node) => node.type === "select");
  return { controller, state, selections, publications, render };
}

function available(select) {
  return select.props.children[1].map((option) => option.props.value);
}

test("chart heading intervals use the native registry and the selected provider's availability", () => {
  const { render, state } = fixture();
  const primary = render({ slot: 1 });
  assert.equal(primary.props["aria-label"], "Chart interval · Chart 1");
  assert.equal(primary.props.value, "4h");
  assert.deepEqual(available(primary), [
    "1m",
    "2m",
    "3m",
    "5m",
    "10m",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "1d",
    "1w",
    "1M"
  ]);
  state.preferences.timeframe = "2m";
  for (const provider of ["bybit", "okx"]) {
    const auxiliary = render({ slot: 16, provider });
    assert.equal(auxiliary.props["aria-label"], "Chart interval · Chart 16");
    assert.deepEqual(
      available(auxiliary),
      available(primary).filter((id) => id !== "2m" && id !== "10m")
    );
    assert.equal(auxiliary.props.children[0].props.value, "2m");
    assert.equal(auxiliary.props.children[0].props.disabled, true);
  }
});

test("changing the interval edits its own chart before publishing workspace intent", async () => {
  const primary = fixture();
  const auxiliary = fixture();
  const change = auxiliary.render({ slot: 16, provider: "okx" }).props.onChange;
  for (const value of ["2m", "12M", "4h"]) change({ currentTarget: { value } });
  assert.deepEqual(auxiliary.selections, []);
  change({ currentTarget: { value: "1d" } });
  assert.deepEqual(auxiliary.selections, ["1d"]);
  assert.deepEqual(auxiliary.publications, []);
  await Promise.resolve();
  assert.deepEqual(auxiliary.publications, [[auxiliary.controller, "1d"]]);
  assert.deepEqual(primary.selections, []);
});

test("a pending edit never publishes into another owner's workspace", async () => {
  let finish;
  const { render, publications, state, controller } = fixture(
    () => new Promise((resolve) => (finish = resolve))
  );
  render({ slot: 2 }).props.onChange({ currentTarget: { value: "1d" } });
  controller.getSnapshot = () => ({ ...state, owner: "second" });
  finish();
  await Promise.resolve();
  assert.deepEqual(publications, []);
});
