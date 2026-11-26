import test from "node:test";
import assert from "node:assert/strict";
import { nativeFixture } from "./native-technical-fixture.mjs";
import {
  actions,
  controller,
  make,
  model,
  preferences
} from "./technical-pane-capture-order-fixture.mjs";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const pane = (id) => ({ kind: "pane", id });
const shared = () => [
  make("rsi", "first", { pane: pane("lower"), order: 0 }),
  make("rsi", "second", { pane: pane("lower"), order: 1 }),
  make("macd", "neighbor", { pane: pane("peer"), order: 2 }),
  make("sma", "overlay", { order: 3 })
];

test("pane controls retain saved height, resize only expanded panes, and remove the active group", async () => {
  const originals = shared();
  const c = controller(originals, preferences(["lower", "peer"], 0.32));
  await actions.changeTechnicalPane(c, "lower", true);
  await actions.resizeTechnicalPane(c, "lower", 1);
  assert.equal(c.writes.length, 1);
  assert.deepEqual(c.getSnapshot().preferences.technicalPaneLayout[0], {
    paneId: "lower",
    collapsed: true,
    heightRatio: 0.32
  });
  await actions.changeTechnicalPane(c, "lower", false);
  await actions.resizeTechnicalPane(c, "lower", 1);
  assert.equal(c.getSnapshot().preferences.technicalPaneLayout[0].heightRatio, 0.37);
  await actions.moveTechnicalPane(c, "lower", "peer", "after");
  assert.deepEqual(
    c.getSnapshot().preferences.technicalPaneLayout.map(({ paneId }) => paneId),
    ["peer", "lower"]
  );
  await actions.updateTechnicalIndicator(c, "first", () => null);
  assert.ok(c.getSnapshot().preferences.technicalIndicators.includes(originals[1]));
  await actions.removeTechnicalPane(c, "lower");
  assert.deepEqual(c.getSnapshot().preferences.technicalIndicators, originals.slice(2));
  assert.deepEqual(c.getSnapshot().preferences.technicalPaneLayout, preferences(["peer"], 0.32));
  assert.equal(c.listeners.size, 0);
});

for (const engine of ["lightweight", "kline"]) {
  test(`${engine}: transient maximize expands a collapsed study and returns prior height/visibility`, () => {
    const f = nativeFixture(engine);
    const nonFocusedChart = nativeFixture(engine);
    const instances = shared();
    const layout = [
      { paneId: "lower", heightRatio: 0.31, collapsed: true },
      { paneId: "peer", heightRatio: 0.23, collapsed: false }
    ];
    f.adapter.updateTechnicalIndicators(instances, layout);
    nonFocusedChart.adapter.updateTechnicalIndicators(instances, layout);
    f.ready();
    nonFocusedChart.ready();
    const normal = f.adapter.technicalPaneMetrics();
    const camera = f.camera();
    const otherChart = nonFocusedChart.adapter.technicalPaneMetrics();
    const lower = () => f.adapter.technicalPaneMetrics().find(({ key }) => key === "pane:lower");
    const lowerVisible = () =>
      engine === "lightweight"
        ? f.panes[1].getSeries().some((series) => series.options().visible)
        : f
            .activeIndicators()
            .some((series) => series.paneId === "technical:lower" && series.visible);
    assert.ok(lower().height <= 31);
    assert.equal(lowerVisible(), false);
    f.container.clientHeight = 1100;
    f.resize();
    f.adapter.setTechnicalPaneFocus({ key: "pane:lower", height: 750 });
    f.ready();
    assert.ok(Math.abs(lower().height - 750) <= 1);
    assert.equal(lowerVisible(), true);
    assert.deepEqual(f.camera(), camera);
    assert.deepEqual(nonFocusedChart.adapter.technicalPaneMetrics(), otherChart);
    assert.deepEqual(f.changes, []);

    f.adapter.setTechnicalPaneFocus(null);
    f.container.clientHeight = 900;
    f.resize();
    f.ready();
    assert.deepEqual(
      f.adapter.technicalPaneMetrics().map(({ key, height }) => [key, Math.round(height)]),
      normal.map(({ key, height }) => [key, Math.round(height)])
    );
    assert.equal(lowerVisible(), false);
    assert.deepEqual(f.camera(), camera);
    assert.equal(layout[0].heightRatio, 0.31);
    assert.equal(layout[0].collapsed, true);
    assert.deepEqual(f.changes, []);
    f.adapter.destroy();
    nonFocusedChart.adapter.destroy();
  });
}

const jsx = (type, props) => ({ type, props });
function findUi(value, match) {
  if (Array.isArray(value)) return value.flatMap((item) => findUi(item, match));
  if (!value?.props) return [];
  return [...(match(value) ? [value] : []), ...findUi(value.props.children, match)];
}
function panelFixture(instances) {
  const c = controller(instances, preferences(["lower", "peer"]));
  const state = c.getSnapshot();
  state.preferences.indicators = { volume: false };
  state.preferences.chartSettings = {};
  let stateIndex = 0;
  const hookStates = [];
  const load = sourceModules({
    react: {
      useRef: () => ({ current: null }),
      useId: () => "pane-menu",
      useCallback: (callback) => callback,
      useState: (initial) => {
        const current = stateIndex++;
        hookStates[current] ??= initial;
        return [hookStates[current], (value) => (hookStates[current] = value)];
      }
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "screens/terminal/context.tsx": {
      useTerminal: () => ({ state: c.getSnapshot(), controller: c })
    },
    "screens/terminal/DrawingToolbarMenu.tsx": { DrawingToolbarMenu() {} },
    "screens/terminal/SupplementalStudyStatus.tsx": { SupplementalStudyStatus() {} },
    "screens/terminal/use-technical-pane-focus.ts": { useTechnicalPaneFocus() {} },
    "screens/terminal/useIndicatorMenuAction.ts": {
      useIndicatorMenuAction: () => ({ pending: false, run: (fn) => fn() })
    }
  });
  const { TechnicalIndicatorPanels } = load("screens/terminal/TechnicalIndicatorPanels.tsx");
  const metrics = [
    { key: "pane:lower", top: 180, height: 100, width: 400 },
    { key: "pane:peer", top: 290, height: 100, width: 400 }
  ];
  const render = () => {
    stateIndex = 0;
    const panes = findUi(
      TechnicalIndicatorPanels({ metrics }),
      (node) => node.props["data-technical-pane"]
    );
    const [list, commands] = panes[0].props.children;
    return {
      count: panes.length,
      rows: list && list.props.children.type(list.props.children.props),
      commands: commands.type(commands.props)
    };
  };
  return { render, c };
}

test("a single study has one pane command group, no duplicate removal, and a keyboard menu", () => {
  const fixture = panelFixture(shared().slice(1));
  const { commands, rows } = fixture.render();
  assert.equal(
    findUi(commands, (node) => node.props.className === "technical-pane-actions").length,
    1
  );
  assert.equal(findUi(rows, (node) => node.props.draggable === true).length, 0);
  assert.equal(findUi(rows, (node) => node.props.title === "Удалить индикатор").length, 0);
  const [trigger] = findUi(commands, (node) => node.props["aria-haspopup"] === "menu");
  let prevented = false;
  trigger.props.onKeyDown({
    key: "ArrowDown",
    preventDefault: () => {
      prevented = true;
    },
    currentTarget: {}
  });
  assert.equal(prevented, true);
  const [menu] = findUi(fixture.render().commands, (node) => node.props.sections);
  assert.deepEqual(
    menu.props.sections[0].items.map(({ id }) => id),
    ["pane-down", "pane-grow", "pane-shrink", "pane-remove"]
  );
});

test("shared-pane rows retain study-only controls and reorder without drag", async () => {
  const fixture = panelFixture(shared());
  const { rows } = fixture.render();
  assert.equal(findUi(rows, (node) => node.props.title === "Удалить индикатор").length, 2);
  assert.equal(findUi(rows, (node) => node.props.title === "Скрыть").length, 2);
  const [up] = findUi(rows, (node) => node.props.title === "Выше в панели");
  up.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const next = fixture.c.getSnapshot().preferences;
  const group = model
    .technicalIndicatorGroups(next.technicalIndicators, next.technicalPaneLayout)
    .find(({ key }) => key === "pane:lower");
  assert.deepEqual(
    group.instances.map(({ id }) => id),
    ["second", "first"]
  );
});
