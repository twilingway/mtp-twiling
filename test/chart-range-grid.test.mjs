import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function fixture(rangeDays, historyViewReady, flags = {}) {
  const actions = [];
  const state = { owner: "fixture", historyViewReady, preferences: { rangeDays }, ...flags };
  const controller = {
    getSnapshot: () => state,
    setPreferences: async (patch) => actions.push(patch)
  };
  const jsx = (type, props) => ({ type, props });
  const Clock = () => null;
  const load = createSourceLoader({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "screens/terminal/context.js": { useTerminal: () => ({ state, controller }) },
    "screens/terminal/ClockZoneControl.js": { ClockZoneControl: Clock }
  });
  load("i18n/preferences.js").setDisplayPreferences({ locale: "en" });
  return {
    actions,
    Clock,
    ChartRangeControl: load("screens/terminal/intervals/ChartRangeControl.js").ChartRangeControl
  };
}

test("each compact plot select is labelled and changes only the scoped panel's history depth", () => {
  const first = fixture(365);
  const later = fixture(180);
  const one = first.ChartRangeControl({ slot: 1, placement: "plot" });
  const sixteen = later.ChartRangeControl({ slot: 16, placement: "plot" });
  const select = (tree) => find(tree, (node) => node.type === "select").props;
  assert.equal(one.props["data-placement"], "plot");
  assert.equal(select(one).id, "range-plot-1");
  assert.equal(select(one)["aria-label"], "History depth · Chart 1");
  assert.equal(select(one).value, 365);
  assert.equal(select(sixteen).id, "range-plot-16");
  assert.equal(select(sixteen)["aria-label"], "History depth · Chart 16");
  assert.equal(select(sixteen).value, 180);
  assert.ok(!select(sixteen).disabled);
  assert.equal(find(sixteen, (node) => node.type === "label").props.htmlFor, select(sixteen).id);
  assert.equal(
    find(one, (node) => node.type === first.Clock),
    null
  );
  select(sixteen).onChange({ target: { value: "30" } });
  assert.deepEqual(later.actions, [{ rangeDays: 30 }]);
  assert.deepEqual(first.actions, []);
});

test("single chart defaults to the plot selector and retains its mobile menu entry", () => {
  const { ChartRangeControl, Clock } = fixture(1825, false);
  const plot = ChartRangeControl();
  const toolbar = ChartRangeControl({ placement: "toolbar" });
  assert.equal(plot.props["data-placement"], "plot");
  assert.equal(find(plot, (node) => node.type === "select").props.id, "range-plot-1");
  assert.equal(
    find(plot, (node) => node.type === Clock),
    null
  );
  assert.equal(find(toolbar, (node) => node.type === "select").props.id, "mobile-chart-range");
  assert.equal(find(toolbar, (node) => node.type === "select").props.disabled, true);
});

test("plot history control preserves loading, import and recovery guards and custom depth values", () => {
  for (const flag of ["loading", "backupBusy", "importingBackup", "importRecoveryRequired"]) {
    const { ChartRangeControl } = fixture(1080, true, { [flag]: true });
    const tree = ChartRangeControl({ slot: 12 });
    const select = find(tree, (node) => node.type === "select");
    assert.equal(select.props.disabled, true, flag);
    assert.equal(select.props.id, "range-plot-12");
    assert.equal(select.props.value, 1080);
    assert.equal(
      find(tree, (node) => node.type === "option" && node.props.value === 1080).props.value,
      1080
    );
    assert.equal(
      find(tree, (node) => node.props?.className === "chart-depth-days").props.children[0],
      1080
    );
  }
});
