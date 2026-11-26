import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { createSourceLoader, core } from "./technical-volume-registration-fixture.mjs";

function walk(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => walk(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...walk(node.props?.children, predicate)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object") return text(node.props?.children);
  return node == null ? "" : String(node);
}
function settings(id, locale = "ru") {
  const instance = core.createTechnicalIndicatorInstance(id, id);
  let state = {
    owner: "profile",
    chartRevision: 1,
    dialog: "technical-settings",
    preferences: {
      locale,
      symbol: "SBER",
      instrumentUid: "uid",
      timeframe: "1d",
      engine: "kline",
      technicalIndicators: [instance],
      technicalPaneLayout: []
    }
  };
  const slots = [],
    tasks = [],
    listeners = new Set(),
    writes = [],
    session = {};
  let cursor = 0;
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setPreferences(patch, reload, valid) {
      assert.equal(reload, false);
      if (!valid()) return;
      state = { ...state, preferences: { ...state.preferences, ...patch } };
      writes.push(patch);
      listeners.forEach((listener) => listener());
    },
    setDialog(dialog) {
      state = { ...state, dialog };
    }
  };
  const load = createSourceLoader({
    react: {
      useRef(value) {
        const index = cursor++;
        return (slots[index] ??= { current: value });
      },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [
          slots[index],
          (value) => {
            slots[index] = typeof value === "function" ? value(slots[index]) : value;
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
          const promise = action();
          tasks.push(promise);
          return promise;
        }
      })
    }
  });
  const { TechnicalIndicatorSettings } = load("screens/terminal/TechnicalIndicatorSettings.js");
  const render = () => {
    cursor = 0;
    return TechnicalIndicatorSettings({ instance });
  };
  const control = (tree, label) => {
    const wrapper = walk(
      tree,
      (node) =>
        node.type === "label" &&
        node.props.children?.[0]?.type === "span" &&
        text(node.props.children[0]) === label
    )[0];
    assert.ok(wrapper, label);
    return walk(wrapper, (node) => node.type === "input" || node.type === "select")[0];
  };
  const submit = async (tree) => {
    walk(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
    await Promise.all(tasks);
  };
  return { render, control, submit, writes, controller };
}

test("choice settings render exact EMA/SMA selects with readable RU/EN labels and preserve strings on save", async () => {
  for (const [locale, oscillatorLabel, signalLabel] of [
    ["ru", "Тип средней осциллятора", "Тип сигнальной средней"],
    ["en", "Oscillator MA type", "Signal MA type"]
  ]) {
    const f = settings("volume-oscillator", locale);
    let tree = f.render();
    for (const label of [oscillatorLabel, signalLabel]) {
      const select = f.control(tree, label);
      assert.equal(select.type, "select");
      assert.deepEqual(walk(select, (node) => node.type === "option").map(text), ["EMA", "SMA"]);
      assert.equal(select.props.value, "EMA");
      select.props.onChange({ target: { value: "SMA" } });
      tree = f.render();
    }
    await f.submit(tree);
    assert.equal(f.writes.length, 1);
    const saved = f.controller.getSnapshot().preferences.technicalIndicators[0];
    assert.equal(saved.params.oscillatorAverage, "SMA");
    assert.equal(saved.params.signalAverage, "SMA");
    assert.equal(core.isTechnicalIndicatorInstance(saved), true);
  }
});

test("invalid choice remains a string and is rejected by actual validator before any save/default fallback", async () => {
  for (const invalid of ["unknown", "ema", "", "0"]) {
    const f = settings("volume-oscillator", "en");
    f.control(f.render(), "Signal MA type").props.onChange({ target: { value: invalid } });
    await f.submit(f.render());
    assert.equal(f.writes.length, 0);
    assert.equal(
      f.controller.getSnapshot().preferences.technicalIndicators[0].params.signalAverage,
      "EMA"
    );
    assert.ok(
      walk(f.render(), (node) => node.props?.role === "alert").some((node) =>
        text(node).includes("Check parameters")
      )
    );
  }
});

test("new divisor/EMA labels and numeric/source controls retain their existing input types", async () => {
  for (const [locale, divisorLabel, emaLabel] of [
    ["ru", "Делитель", "Период EMA"],
    ["en", "Divisor", "EMA length"]
  ]) {
    const eom = settings("eom", locale),
      divisor = eom.control(eom.render(), divisorLabel);
    assert.equal(divisor.type, "input");
    assert.equal(divisor.props.type, "number");
    divisor.props.onChange({ target: { value: "12345" } });
    await eom.submit(eom.render());
    assert.equal(
      eom.controller.getSnapshot().preferences.technicalIndicators[0].params.divisor,
      12345
    );
    const nvi = settings("nvi", locale),
      ema = nvi.control(nvi.render(), emaLabel);
    assert.equal(ema.props.type, "number");
    ema.props.onChange({ target: { value: "17" } });
    await nvi.submit(nvi.render());
    assert.equal(
      nvi.controller.getSnapshot().preferences.technicalIndicators[0].params.emaLength,
      17
    );
  }
  const legacy = settings("sma", "en");
  let tree = legacy.render();
  const length = legacy.control(tree, "Length");
  assert.equal(length.props.type, "number");
  length.props.onChange({ target: { value: "7" } });
  tree = legacy.render();
  const source = legacy.control(tree, "Source");
  assert.equal(source.type, "select");
  const sourceOptions = walk(source, (node) => node.type === "option");
  assert.deepEqual(
    sourceOptions.map((option) => option.props.value),
    core.PRICE_SOURCES
  );
  assert.deepEqual(sourceOptions.map(text), [
    "Open",
    "High",
    "Low",
    "Close",
    "High–low average (HL2)",
    "Typical price (HLC3)",
    "OHLC average (OHLC4)",
    "Volume"
  ]);
  source.props.onChange({ target: { value: "hl2" } });
  await legacy.submit(legacy.render());
  assert.deepEqual(legacy.controller.getSnapshot().preferences.technicalIndicators[0].params, {
    length: 7,
    source: "hl2"
  });
});
