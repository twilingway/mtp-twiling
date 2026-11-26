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

const { technicalPaneAtPointer } = sourceModules({
  react: {}
})("screens/terminal/use-technical-pane-action-reveal.ts");

test("pointer reveal isolates the current native indicator band, including collapsed bands", () => {
  const box = { left: 100, right: 500, top: 90, bottom: 500 };
  const metrics = [
    { key: "price", top: 0, height: 120, width: 330 },
    { key: "pane:lower", top: 121, height: 30, width: 330 },
    { key: "pane:peer", top: 152, height: 119, width: 330 },
    { key: "legacy:volume", top: 272, height: 40, width: 330 }
  ];
  const at = (clientX, clientY) => technicalPaneAtPointer({ clientX, clientY }, box, metrics);
  assert.equal(at(190, 150), undefined);
  assert.equal(at(190, 219), "pane:lower");
  assert.equal(at(497, 240), "pane:lower");
  assert.equal(at(190, 241), undefined);
  assert.equal(at(190, 242), "pane:peer");
  assert.equal(at(190, 370), undefined);
  assert.equal(at(499, 360), "pane:peer");
  assert.equal(at(500, 360), undefined);
  assert.equal(at(NaN, 360), undefined);
});

test("only a completed tap reveals controls, while swipes, cancellation and another pane clear it", () => {
  class ElementFixture extends EventTarget {
    attributes = new Set();
    dataset = {};
    setAttribute(name) {
      this.attributes.add(name);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }
  const document = new EventTarget();
  const body = new ElementFixture();
  body.ownerDocument = document;
  body.contains = (target) => target === body;
  const layer = new ElementFixture();
  const first = new ElementFixture();
  const second = new ElementFixture();
  first.dataset.technicalPane = "pane:first";
  second.dataset.technicalPane = "pane:second";
  layer.children = [first, second];
  layer.parentElement = body;
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200 });
  const tap = (type, clientY = 76, target = body, pointerType = "touch") => {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    Object.assign(event, {
      pointerType,
      pointerId: 4,
      isPrimary: true,
      clientX: 20,
      clientY
    });
    document.dispatchEvent(event);
  };
  let cleanup;
  const { useTechnicalPaneActionReveal } = sourceModules({
    react: {
      useRef: (current) => ({ current }),
      useEffect: (act) => {
        cleanup = act();
      },
      useLayoutEffect: (act) => act()
    }
  })("screens/terminal/use-technical-pane-action-reveal.ts");
  const keys = ["Node", "HTMLElement", "Element"];
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  try {
    for (const key of keys)
      Object.defineProperty(globalThis, key, { configurable: true, value: ElementFixture });
    useTechnicalPaneActionReveal(
      { current: layer },
      [
        { key: "pane:first", top: 70, height: 40, width: 150 },
        { key: "pane:second", top: 111, height: 40, width: 150 }
      ],
      true
    );
    const active = () => [first, second].map((item) => item.attributes.has("data-pane-touch"));
    tap("pointerdown");
    assert.deepEqual(active(), [false, false]);
    tap("pointercancel");
    assert.deepEqual(active(), [false, false]);
    tap("pointerdown");
    tap("pointerup");
    assert.deepEqual(active(), [true, false]);
    tap("pointerdown");
    tap("pointermove", 96);
    tap("pointerup");
    assert.deepEqual(active(), [false, false]);
    tap("pointerdown");
    tap("pointerup");
    tap("pointerdown", 119);
    assert.deepEqual(active(), [false, false]);
    tap("pointerup", 119);
    assert.deepEqual(active(), [false, true]);
    tap("pointerdown", 119, new ElementFixture());
    assert.deepEqual(active(), [false, false]);
    const action = new ElementFixture();
    first.parentElement = layer;
    action.closest = () => ({ parentElement: first });
    assert.equal(first.attributes.has("data-pane-hover"), false);
    tap("pointerdown", 76, action, "mouse");
    assert.equal(first.attributes.has("data-pane-hover"), true);
    body.dispatchEvent(new Event("pointerleave"));
    assert.equal(first.attributes.has("data-pane-hover"), false);
  } finally {
    cleanup?.();
    keys.forEach((key, index) => {
      const property = previous[index];
      if (property) Object.defineProperty(globalThis, key, property);
      else delete globalThis[key];
    });
  }
});

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
  let pending = false;
  const hookStates = [];
  const load = sourceModules({
    react: {
      useRef: () => ({ current: null }),
      useId: () => "pane-menu",
      useCallback: (callback) => callback,
      useEffect: () => {},
      useLayoutEffect: () => {},
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
      useIndicatorMenuAction: () => ({ pending, run: (fn) => fn() })
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
      rows:
        list && typeof list.props.children.type === "function"
          ? list.props.children.type(list.props.children.props)
          : list?.props.children,
      commands: commands.type(commands.props)
    };
  };
  return {
    render,
    c,
    setPending(value) {
      pending = value;
    }
  };
}

test("pending pane commands remain focusable and ignore repeat activation", async () => {
  const fixture = panelFixture(shared());
  fixture.setPending(true);
  const { commands } = fixture.render();
  const buttons = findUi(commands, (node) => node.type === "button");
  assert.equal(buttons.length, 3);
  assert.ok(buttons.every(({ props }) => !props.disabled && props["aria-disabled"] === true));
  const [collapse, maximize, menu] = buttons;
  collapse.props.onClick();
  maximize.props.onClick();
  menu.props.onClick({ currentTarget: {} });
  menu.props.onKeyDown({
    key: "ArrowDown",
    preventDefault: () => assert.fail("opened pending menu")
  });
  assert.equal(fixture.c.writes.length, 0);
  assert.equal(fixture.render().count, 2);
  assert.equal(findUi(fixture.render().commands, (node) => node.props.sections).length, 0);

  fixture.setPending(false);
  const [ready] = findUi(fixture.render().commands, (node) => node.type === "button");
  ready.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const [collapsed] = findUi(fixture.render().commands, (node) => node.type === "button");
  assert.equal(collapsed.props["aria-expanded"], false);
});

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
