import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { settings, walk } from "./technical-state-oscillator-settings-fixture.mjs";
import { core, createSourceLoader } from "./technical-state-oscillator-fixture.mjs";

function boundarySettings() {
  const original = core.createTechnicalIndicatorInstance("tsi", "tsi");
  let state = {
    owner: "profile",
    chartRevision: 1,
    dialog: "technical-settings",
    preferences: {
      locale: "en",
      symbol: "SBER",
      instrumentUid: "uid",
      timeframe: "1d",
      engine: "kline",
      technicalIndicators: [original],
      technicalPaneLayout: []
    }
  };
  const session = {},
    slots = [],
    tasks = [],
    writes = [];
  let cursor = 0;
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => session,
    subscribe: () => () => {},
    async setPreferences(patch, reload, valid) {
      assert.equal(reload, false);
      if (valid()) writes.push(patch);
    },
    setDialog() {}
  };
  const load = createSourceLoader({
    react: {
      useRef(value) {
        const i = cursor++;
        return (slots[i] ??= { current: value });
      },
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [
          slots[i],
          (value) => {
            slots[i] = typeof value === "function" ? value(slots[i]) : value;
          }
        ];
      }
    },
    "react/jsx-runtime": jsx,
    "screens/terminal/context.js": { useTerminal: () => ({ controller, state }) },
    "screens/terminal/Modal.js": { Modal: () => null },
    "screens/terminal/useIndicatorMenuAction.js": {
      useIndicatorMenuAction: () => ({
        pending: false,
        run(action) {
          const task = action();
          tasks.push(task);
          return task;
        }
      })
    }
  });
  const Component = load(
    "screens/terminal/TechnicalIndicatorSettings.js"
  ).TechnicalIndicatorSettings;
  return {
    render() {
      cursor = 0;
      return Component({ instance: original });
    },
    async submit(tree) {
      walk(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
      await Promise.all(tasks);
    },
    change(boundary) {
      const next = structuredClone(state);
      boundary(next, controller);
      state = next;
    },
    controller,
    writes
  };
}

const instance = (f) => f.controller.getSnapshot().preferences.technicalIndicators[0];
const output = (f, index, type) => {
  const group = walk(
    f.render(),
    (node) => node.type === "div" && node.props.className === "technical-output-style"
  )[index];
  return walk(group, (node) => node.type === "input" && node.props.type === type)[0];
};
const edit = (f, index, type, value) => {
  const target = type === "checkbox" ? { checked: value } : { value };
  output(f, index, type).props.onChange({ target });
};

test("period/pane-only actual submit preserves absent, undefined, empty and sparse legacy style shape", async () => {
  const manual = { width: 3, color: "#2962ff", visible: false };
  for (const initial of [
    {},
    { styles: undefined },
    { styles: {} },
    { styles: { signal: manual } },
    {
      styles: {
        signal: { color: "#ff6d00", width: 4, visible: false, opacity: 0, lineStyle: "dotted" }
      }
    },
    { styles: { value: { color: "#123456", width: 2, visible: true, opacity: 0.2 } } },
    { styles: { signal: { color: "#ff6d00", width: 4, visible: false, lineStyle: "dotted" } } }
  ])
    for (const field of ["period", "pane"]) {
      const f = settings("tsi", "en");
      Object.assign(instance(f), initial);
      const original = instance(f),
        before = JSON.stringify(original.styles);
      if (field === "period")
        f.control(f.render(), "Long length").props.onChange({ target: { value: "31" } });
      else f.control(f.render(), "Location").props.onChange({ target: { value: "price" } });
      await f.submit(f.render());
      assert.equal(f.writes.length, 1);
      const saved = instance(f);
      assert.equal(Object.hasOwn(saved, "styles"), Object.hasOwn(original, "styles"));
      assert.equal(saved.styles, original.styles);
      assert.equal(JSON.stringify(saved.styles), before);
      assert.equal(core.isTechnicalIndicatorInstance(saved), true);
      if (field === "period") assert.equal(saved.params.longLength, 31);
      else assert.deepEqual(saved.pane, { kind: "overlay" });
    }
});

test("default display controls remain populated without materializing stored styles", async () => {
  const f = settings("tsi", "en");
  for (const [index, color] of [
    [0, "#2962ff"],
    [1, "#ff6d00"]
  ]) {
    assert.equal(output(f, index, "color").props.value, color);
    assert.equal(output(f, index, "number").props.value, 1);
    assert.equal(output(f, index, "checkbox").props.checked, true);
    assert.equal(output(f, index, "range").props.value, 100);
  }
  await f.submit(f.render());
  assert.equal(Object.hasOwn(instance(f), "styles"), false);
});

test("each output control materializes only its edited output and preserves the untouched legacy entry", async () => {
  for (const [type, value, expected] of [
    ["color", "#2962ff", { color: "#2962ff" }],
    ["number", "4", { width: 4 }],
    ["checkbox", false, { visible: false }],
    ["range", "35", { opacity: 0.35 }],
    ["line", "dashed", { lineStyle: "dashed" }]
  ]) {
    const f = settings("tsi", "en"),
      manual = { color: "#ff6d00", width: 3, visible: false };
    instance(f).styles = { signal: manual };
    if (type === "line") {
      const group = walk(
        f.render(),
        (node) => node.type === "div" && node.props.className === "technical-output-style"
      )[0];
      walk(group, (node) => node.type === "select")[0].props.onChange({ target: { value } });
    } else edit(f, 0, type, value);
    await f.submit(f.render());
    assert.equal(f.writes.length, 1);
    assert.deepEqual(instance(f).styles.value, {
      color: "#2962ff",
      width: 1,
      visible: true,
      opacity: 1,
      lineStyle: "solid",
      ...expected
    });
    assert.equal(instance(f).styles.signal, manual);
    assert.deepEqual(Object.keys(manual), ["color", "width", "visible"]);
  }
});

test("manual default color and change/revert stay explicit while the other output remains absent", async () => {
  const f = settings("tsi", "en");
  edit(f, 0, "color", "#123456");
  edit(f, 0, "color", "#2962ff");
  await f.submit(f.render());
  assert.deepEqual(Object.keys(instance(f).styles), ["value"]);
  assert.equal(instance(f).styles.value.color, "#2962ff");
  assert.equal(Object.hasOwn(instance(f).styles, "signal"), false);
});

test("editing a legacy output preserves its manual fields while filling only that output's optional defaults", async () => {
  const f = settings("tsi", "en");
  instance(f).styles = { value: { color: "#123456", width: 3, visible: false, opacity: 0.25 } };
  edit(f, 0, "color", "#2962ff");
  await f.submit(f.render());
  assert.deepEqual(instance(f).styles, {
    value: { color: "#2962ff", width: 3, visible: false, opacity: 0.25, lineStyle: "solid" }
  });
});

test("actual submit still blocks owner/current/session/import boundaries after style editing", async () => {
  for (const boundary of [
    (s) => {
      s.owner = "other";
    },
    (s) => {
      s.chartRevision++;
    },
    (s) => {
      s.preferences.symbol = "OTHER";
    },
    (s) => {
      s.preferences.instrumentUid = "other-uid";
    },
    (s) => {
      s.preferences.timeframe = "1h";
    },
    (s) => {
      s.preferences.engine = "tradingview";
    },
    (s) => {
      s.importingBackup = true;
    },
    (s) => {
      s.importRecoveryRequired = true;
    },
    (s) => {
      s.profileTransition = true;
    },
    (s) => {
      s.backupBusy = true;
    },
    (s, c) => {
      c.sessionKey = () => ({});
    }
  ]) {
    const f = boundarySettings();
    edit(f, 0, "color", "#123456");
    f.change(boundary);
    await f.submit(f.render());
    assert.equal(f.writes.length, 0);
    assert.equal(Object.hasOwn(instance(f), "styles"), false);
  }
});
