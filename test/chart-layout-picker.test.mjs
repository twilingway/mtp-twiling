import assert from "node:assert/strict";
import test from "node:test";
import { find } from "./controller-preference-routing-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";

function setup({ layoutId = "single", desktopOpen = false } = {}) {
  let browsing;
  const events = [];
  const jsx = (type, props) => ({ type, props });
  const load = createSourceLoader({
    react: {
      useId: () => "chart-layout",
      useEffect: () => {},
      useRef: () => ({ current: null }),
      useState: (initial) =>
        initial === false
          ? [desktopOpen, (open) => events.push(["open", open])]
          : [browsing, (value) => (browsing = value)]
    },
    "react/jsx-runtime": { jsx, jsxs: jsx }
  });
  const { ChartLayoutOptions, ChartLayoutPicker } = load("screens/terminal/ChartLayoutPicker.js");
  const props = {
    layoutId,
    flags: { instrument: false, timeframe: true, crosshair: false, time: true, dateRange: false },
    onLayoutChange: (id) => events.push(["layout", id]),
    onFlagChange: (key, enabled) => events.push([key, enabled])
  };
  return { ChartLayoutOptions, ChartLayoutPicker, props, events, load };
}

test("layout options browse every count and emit the exact chosen layout", () => {
  const { ChartLayoutOptions, props, events, load } = setup();
  const { CHART_LAYOUTS } = load("model/chart-workspace-layout.js");
  const original = ChartLayoutOptions(props);
  const numbers = find(original, (node) => node.props?.className === "chart-layout-count-grid");
  assert.equal(numbers.props.children.length, 16);
  assert.equal(numbers.props.children[0].props.children[0].props.checked, true);
  for (const [index, item] of numbers.props.children.entries()) {
    item.props.children[0].props.onChange();
    const count = index + 1;
    const browsed = ChartLayoutOptions(props);
    const variants = find(browsed, (node) => node.props?.className === "chart-layout-variant-grid");
    const layouts = CHART_LAYOUTS.filter((definition) => definition.count === count);
    assert.equal(variants.props.children.length, layouts.length);
    assert.ok(layouts.length > 0);
    for (const [variantIndex, variant] of variants.props.children.entries()) {
      assert.equal(variant.props.children[0].props.layout.panes.length, count);
      variant.props.onClick();
      assert.deepEqual(events.pop(), ["layout", layouts[variantIndex].id]);
    }
  }
  assert.deepEqual(events, []);
});

test("five switches preserve independent values and callbacks", () => {
  const { ChartLayoutOptions, props, events } = setup();
  const options = ChartLayoutOptions(props);
  const fieldset = find(options, (node) => node.props?.className === "chart-layout-sync-flags");
  const switches = fieldset.props.children[1].map((label) => label.props.children[1]);
  assert.equal(switches.length, 5);
  for (const [index, [key, checked]] of Object.entries(props.flags).entries()) {
    const control = switches[index];
    assert.equal(control.props.role, "switch");
    assert.equal(control.props.checked, checked);
    control.props.onChange({ currentTarget: { checked: !checked } });
    assert.deepEqual(events.pop(), [key, !checked]);
  }
});

test("desktop reports the current count and closes after choosing a layout or pressing Escape", () => {
  const { ChartLayoutPicker, ChartLayoutOptions, props, events } = setup({
    layoutId: "16-balanced",
    desktopOpen: true
  });
  const picker = ChartLayoutPicker(props);
  const trigger = find(picker, (node) => node.props?.className === "chart-layout-picker-trigger");
  assert.equal(trigger.props["aria-expanded"], true);
  assert.match(trigger.props["aria-label"], /16$/);
  const options = find(picker, (node) => node.type === ChartLayoutOptions);
  options.props.onLayoutChange("4-focus");
  assert.deepEqual(events, [
    ["layout", "4-focus"],
    ["open", false]
  ]);
  picker.props.onKeyDown({ key: "Escape", stopPropagation: () => events.push(["stop"]) });
  assert.deepEqual(events.slice(-2), [["stop"], ["open", false]]);
});
