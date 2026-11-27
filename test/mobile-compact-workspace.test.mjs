import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function setup({ open = true, mobile = true } = {}) {
  const actions = [];
  const setOpen = (next) => actions.push(["open", typeof next === "function" ? next(open) : next]);
  const panel = {
    select: async (...args) => actions.push(["panel", ...args]),
    closeMobile: () => actions.push(["chart"])
  };
  const controller = {
    panel,
    selectObject: (id) => actions.push(["selected", id]),
    setDialog: (dialog) => actions.push(["dialog", dialog]),
    setPreferences: async (preferences) => actions.push(["active preferences", preferences])
  };
  const state = {
    owner: "example",
    objectPanel: true,
    mobilePanelOpen: true,
    preferences: {
      chartSettings: {},
      indicators: {},
      symbol: "LKOH",
      timeframe: "1d",
      rangeDays: 180
    },
    drawings: [
      { id: "first", name: "segment" },
      { id: "second", name: "rectangle" }
    ],
    images: []
  };
  controller.getSnapshot = () => state;
  const react = {
    useEffect: () => {},
    useRef: () => ({ current: null }),
    useState: (initial) => (initial === false ? [open, setOpen] : [initial, () => {}])
  };
  const jsx = (type, props) => ({ type, props });
  const noop = () => null;
  const load = createSourceLoader({
    react,
    "react-dom": { createPortal: (node) => node },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    "screens/terminal/context.js": {
      TerminalContext: noop,
      useTerminal: () => ({ controller, state })
    },
    "screens/terminal/ClockZoneControl.js": { ClockZoneControl: noop },
    "screens/terminal/Watchlist.js": { Watchlist: noop },
    "screens/terminal/PanelDivider.js": { PanelDivider: noop },
    "screens/terminal/TechnicalIndicatorPanels.js": { TechnicalObjectTree: noop },
    "screens/terminal/use-mobile-layout.js": { useMobileLayout: () => mobile }
  });
  load("i18n/preferences.js").setDisplayPreferences({ locale: "en" });
  return { actions, controller, load };
}

test("account workspace content routes panel modes without a duplicate layout trigger", () => {
  const { actions, controller, load } = setup();
  const { MobileChartTools } = load("screens/terminal/MobileChartTools.js");
  const tree = MobileChartTools({
    controller,
    panelOpen: true,
    objectsOpen: true,
    onAction: () => actions.push(["close account"])
  });
  const trigger = find(tree, (node) => node.props?.className === "mobile-workspace-trigger");
  assert.equal(trigger, null);
  const objects = find(tree, (node) => node.props?.["aria-controls"] === "objects-view");
  assert.equal(objects.props["aria-pressed"], true);
  const watchlist = find(tree, (node) => node.props?.["aria-controls"] === "watchlist-view");
  assert.equal(watchlist.props["aria-pressed"], false);
  watchlist.props.onClick();
  const chart = find(
    tree,
    (node) => node.type === "button" && node.props?.["aria-controls"] === "chart-workspace"
  );
  chart.props.onClick();
  assert.deepEqual(actions, [
    ["close account"],
    ["panel", "watchlist", false, true],
    ["close account"],
    ["chart"]
  ]);
});

test("mobile history uses the active chart and does not duplicate its original input id", () => {
  const { actions, controller, load } = setup();
  const { MobileChartTools } = load("screens/terminal/MobileChartTools.js");
  const { ChartRangeControl } = load("screens/terminal/intervals/ChartRangeControl.js");
  const tree = MobileChartTools({ controller, panelOpen: false, objectsOpen: false });
  const compact = find(tree, (node) => node.type === ChartRangeControl);
  const select = find(ChartRangeControl(compact.props), (node) => node.type === "select");
  assert.equal(select.props.value, 180);
  assert.equal(select.props.id, "mobile-chart-range");
  assert.equal(
    find(ChartRangeControl({ slot: 2 }), (node) => node.type === "select").props.id,
    "range-plot-2"
  );
  select.props.onChange({ target: { value: "30" } });
  assert.deepEqual(actions, [["active preferences", { rangeDays: 30 }]]);
});

test("workspace actions remain available inside the account menu and honor recovery locks", () => {
  const { actions, controller, load } = setup();
  const { MobileChartTools } = load("screens/terminal/MobileChartTools.js");
  const { ClockZoneControl } = load("screens/terminal/ClockZoneControl.js");
  const { ChartRangeControl } = load("screens/terminal/intervals/ChartRangeControl.js");
  const tree = MobileChartTools({ controller, panelOpen: false, objectsOpen: false });
  assert.ok(find(tree, (node) => node.type === "nav"));
  assert.ok(find(tree, (node) => node.type === ClockZoneControl));
  assert.ok(find(tree, (node) => node.type === ChartRangeControl));
  assert.equal(
    find(tree, (node) => node.props?.className === "mobile-workspace-trigger"),
    null
  );
  assert.equal(
    find(tree, (node) => node.props?.className === "mobile-workspace-layout"),
    null
  );
  const blocked = MobileChartTools({
    controller,
    panelOpen: false,
    objectsOpen: false,
    disabled: true
  });
  assert.equal(blocked.props.disabled, true);
  find(blocked, (node) => node.props?.["aria-controls"] === "watchlist-view").props.onClick();
  assert.deepEqual(actions, []);
});

test("mobile objects use their exact drawing settings and return control to the workspace", () => {
  const { actions, load } = setup();
  const { RightPanel } = load("screens/terminal/RightPanel.js");
  const { ObjectTree } = load("screens/terminal/drawings/ObjectTree.js");
  const rightPanel = RightPanel();
  assert.equal(
    find(rightPanel, (node) => node.props?.role === "tablist"),
    null
  );
  const objects = find(rightPanel, (node) => node.type === ObjectTree);
  const tree = ObjectTree(objects.props);
  const drawing = find(tree, (node) => node.props?.["data-object"] === "first");
  const settings = find(drawing, (node) => node.props?.["data-object-action"] === "settings");
  assert.equal(settings.props["aria-label"], "Drawing settings");
  settings.props.onClick();
  objects.props.onClose();
  assert.deepEqual(actions, [["selected", "first"], ["dialog", "drawing-settings"], ["chart"]]);
});

test("desktop keeps its two panel tabs and original object close behavior", () => {
  const { load } = setup({ mobile: false });
  const { RightPanel } = load("screens/terminal/RightPanel.js");
  const { ObjectTree } = load("screens/terminal/drawings/ObjectTree.js");
  const panel = RightPanel();
  assert.equal(find(panel, (node) => node.props?.role === "tablist").props.children.length, 2);
  assert.equal(find(panel, (node) => node.type === ObjectTree).props.onClose, undefined);
});
