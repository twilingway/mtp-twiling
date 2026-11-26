import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function fixture() {
  const hooks = { dialog: [], sections: [] };
  let currentHooks;
  let hookIndex;
  const useState = (initial) => {
    const index = hookIndex++;
    const store = currentHooks;
    if (!(index in store)) store[index] = typeof initial === "function" ? initial() : initial;
    return [
      store[index],
      (next) => {
        store[index] = typeof next === "function" ? next(store[index]) : next;
      }
    ];
  };
  const jsx = (type, props) => ({ type, props });
  const preferences = {
    chartSettings: { theme: "dark", upColor: "#33aa77" },
    engine: "tradingview",
    locale: "ru",
    timeZone: "Europe/Moscow"
  };
  const state = { preferences, dialog: "chart-settings" };
  const changes = [];
  const dialogs = [];
  const controller = {
    getSnapshot: () => state,
    marketNow: () => 0,
    setPreferences: async (patch) => changes.push(patch),
    setDialog: (dialog) => dialogs.push(dialog)
  };
  const load = createSourceLoader({
    react: {
      useState,
      useId: () => "chart-sections",
      useRef: (initial) => useState(() => ({ current: initial }))[0]
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("Fragment") },
    "screens/terminal/context.js": { useTerminal: () => ({ state, controller }) },
    "screens/terminal/Modal.js": { Modal: Symbol("Modal") },
    "screens/terminal/PriceAxisLabelFields.js": { PriceAxisLabelFields: Symbol("Price colors") },
    "screens/terminal/ChartEngineSelect.js": { ChartEngineSelect: Symbol("Engine") },
    "screens/terminal/ClockZoneControl.js": { TimeZonePicker: Symbol("Time zone") }
  });
  const { ChartSettingsDialog } = load("screens/terminal/ChartSettingsDialog.js");
  const { ChartSettingsSections } = load("screens/terminal/ChartSettingsSections.js");
  const render = () => {
    currentHooks = hooks.dialog;
    hookIndex = 0;
    const form = ChartSettingsDialog().props.children;
    const { props } = find(form, (node) => node.type === ChartSettingsSections);
    currentHooks = hooks.sections;
    hookIndex = 0;
    const [tabs, panels] = ChartSettingsSections(props).props.children;
    return { form, tabs: tabs.props.children, panels };
  };
  return { render, preferences, changes, dialogs };
}

function field(panel, name) {
  return find(panel, (node) => node.props?.name === name).props;
}

test("chart settings tabs expose their panels and support arrow, Home and End navigation", () => {
  const { render } = fixture();
  const focused = [];
  let view = render();
  const labels = ["Инструмент", "Строка статуса", "Шкалы и линии", "Оформление"];
  assert.deepEqual(
    view.tabs.map(({ props }) => props.children),
    labels
  );
  for (const [index, tab] of view.tabs.entries()) {
    assert.equal(tab.props.type, "button");
    assert.equal(tab.props["aria-controls"], view.panels[index].props.id);
    assert.equal(view.panels[index].props["aria-labelledby"], tab.props.id);
    tab.props.ref({ focus: () => focused.push(index) });
  }
  const current = (index) => {
    assert.equal(view.tabs[index].props.tabIndex, 0);
    assert.equal(view.tabs[index].props["aria-selected"], true);
    assert.equal(view.tabs.filter(({ props }) => props["aria-selected"]).length, 1);
    assert.deepEqual(
      view.panels.map(({ props }) => props.hidden),
      labels.map((_, candidate) => candidate !== index)
    );
  };
  current(0);
  for (const [from, key, to] of [
    [0, "ArrowDown", 1],
    [1, "End", 3],
    [3, "ArrowRight", 0],
    [0, "ArrowLeft", 3],
    [3, "Home", 0]
  ]) {
    let prevented = false;
    view.tabs[from].props.onKeyDown({
      key,
      preventDefault: () => {
        prevented = true;
      }
    });
    assert.ok(prevented);
    assert.equal(focused.at(-1), to);
    view = render();
    current(to);
  }
});

test("all sections share a chart settings draft and one submit persists it", async () => {
  const { render, preferences, changes, dialogs } = fixture();
  let view = render();
  field(view.panels[0], "upColor").onChange({ target: { value: "#ffff00" } });
  view.tabs[1].props.onClick();
  view = render();
  field(view.panels[1], "showLegend").onChange({ target: { checked: false } });
  view.tabs[2].props.onClick();
  view = render();
  field(view.panels[2], "scaleFontSize").onChange({ target: { value: "14" } });
  view.tabs[3].props.onClick();
  view = render();
  field(view.panels[3], "grid").onChange({ target: { checked: false } });
  field(view.panels[3], "locale").onChange({ target: { value: "en" } });
  view.tabs[0].props.onClick();
  view = render();
  assert.equal(field(view.panels[0], "upColor").value, "#ffff00");
  assert.equal(field(view.panels[1], "showLegend").checked, false);
  assert.equal(field(view.panels[2], "scaleFontSize").value, 14);
  assert.equal(field(view.panels[3], "grid").checked, false);
  assert.equal(preferences.chartSettings.upColor, "#33aa77");
  assert.equal(preferences.locale, "ru");
  assert.deepEqual(changes, []);
  view.form.props.onSubmit({ preventDefault() {}, currentTarget: { isConnected: true } });
  await Promise.resolve();
  assert.deepEqual(changes, [
    {
      chartSettings: {
        theme: "dark",
        upColor: "#ffff00",
        showLegend: false,
        scaleFontSize: 14,
        grid: false
      },
      locale: "en",
      timeZone: "Europe/Moscow"
    }
  ]);
  assert.deepEqual(dialogs, [null]);
});

test("cancel closes the form and leaves the current chart settings untouched", () => {
  const { render, preferences, changes, dialogs } = fixture();
  const view = render();
  field(view.panels[0], "upColor").onChange({ target: { value: "#ffff00" } });
  view.tabs[3].props.onClick();
  find(
    render().form,
    (node) => node.type === "button" && node.props.children === "Отмена"
  ).props.onClick();
  assert.deepEqual(dialogs, [null]);
  assert.deepEqual(changes, []);
  assert.equal(preferences.chartSettings.upColor, "#33aa77");
});
