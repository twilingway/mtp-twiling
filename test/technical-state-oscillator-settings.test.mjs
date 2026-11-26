import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { settings, walk, text } from "./technical-state-oscillator-settings-fixture.mjs";
import { core, ids, defaults, createSourceLoader } from "./technical-state-oscillator-fixture.mjs";

const ru = {
  longLength: "Длинный период",
  shortLength: "Короткий период",
  signalLength: "Сигнальный период",
  length: "Период",
  roc1Length: "Период ROC №1",
  roc2Length: "Период ROC №2",
  roc3Length: "Период ROC №3",
  roc4Length: "Период ROC №4",
  sma1Length: "Период SMA №1",
  sma2Length: "Период SMA №2",
  sma3Length: "Период SMA №3",
  sma4Length: "Период SMA №4"
};
const en = {
  longLength: "Long length",
  shortLength: "Short length",
  signalLength: "Signal length",
  length: "Length",
  roc1Length: "ROC length #1",
  roc2Length: "ROC length #2",
  roc3Length: "ROC length #3",
  roc4Length: "ROC length #4",
  sma1Length: "SMA length #1",
  sma2Length: "SMA length #2",
  sma3Length: "SMA length #3",
  sma4Length: "SMA length #4"
};

test("RU/EN human labels render every numeric input; actual settings submit saves all3 through root validator", async () => {
  for (const locale of ["ru", "en"])
    for (const id of ids) {
      const f = settings(id, locale),
        labels = locale === "ru" ? ru : en;
      let tree = f.render();
      const expected = {};
      Object.keys(defaults[id]).forEach((key, i) => {
        const control = f.control(tree, labels[key]);
        assert.equal(control.type, "input");
        assert.equal(control.props.type, "number");
        assert.equal(control.props.min, 1);
        assert.equal(control.props.max, 10000);
        assert.equal(control.props.step, 1);
        assert.equal(Number(control.props.value), defaults[id][key]);
        expected[key] = i + 2;
        control.props.onChange({ target: { value: String(i + 2) } });
        tree = f.render();
      });
      await f.submit(tree);
      assert.equal(f.writes.length, 1);
      const saved = f.controller.getSnapshot().preferences.technicalIndicators[0];
      assert.deepEqual(saved.params, expected);
      assert.equal(core.isTechnicalIndicatorInstance(saved), true);
      assert.equal(Object.hasOwn(saved, "styles"), false);
    }
});
test("actual settings submit rejects invalid numeric fields before save without default replacement", async () => {
  for (const id of ids)
    for (const bad of ["", "unknown", "null", "0", "1.5", "10001"]) {
      const f = settings(id, "en"),
        key = Object.keys(defaults[id])[0];
      f.control(f.render(), en[key]).props.onChange({ target: { value: bad } });
      await f.submit(f.render());
      assert.equal(f.writes.length, 0);
      assert.deepEqual(
        f.controller.getSnapshot().preferences.technicalIndicators[0].params,
        defaults[id]
      );
      assert.ok(
        walk(f.render(), (n) => n.props?.role === "alert").some((n) =>
          text(n).includes("Check parameters")
        )
      );
    }
});
test("Fisher length1 is saved by actual settings with result-only flags computed afterwards", async () => {
  const f = settings("fisher-transform", "en");
  f.control(f.render(), "Length").props.onChange({ target: { value: "1" } });
  await f.submit(f.render());
  const saved = f.controller.getSnapshot().preferences.technicalIndicators[0];
  assert.deepEqual(saved.params, { length: 1 });
  assert.equal(Object.hasOwn(saved, "alwaysUndefined"), false);
  const result = core.calculateTechnicalIndicator(saved, []);
  assert.equal(result.warmupBars, null);
  assert.equal(result.historyRequirement.seedBars, null);
  assert.equal(result.alwaysUndefined, true);
});
test("actual library source exposes52 available entries including48TA and4 existing scripts", () => {
  const state = { preferences: { locale: "en", indicators: {}, technicalIndicators: [] } };
  const load = createSourceLoader({
    "react/jsx-runtime": jsx,
    "screens/terminal/context.js": { useTerminal: () => ({ controller: {}, state }) },
    "screens/terminal/useIndicatorMenuAction.js": {
      useIndicatorMenuAction: () => ({ pending: false, run: () => {} })
    },
    "screens/terminal/IndicatorLibraryDialog.js": { IndicatorLibraryDialog: () => null },
    "screens/terminal/state.js": {
      INDICATOR_NAMES: { mtpAll: "All MTP", mtp160: "MTP160", mtp440: "MTP440", mtp640: "MTP640" }
    },
    "screens/terminal/indicator-menu-actions.js": { changeMenuIndicator: () => {} }
  });
  const tree = load("screens/terminal/TerminalIndicatorLibrary.js").TerminalIndicatorLibrary();
  assert.equal(tree.props.entries.filter((e) => e.available).length, 52);
  assert.equal(
    tree.props.entries.filter((e) => e.available && e.category === "technicals").length,
    48
  );
  assert.equal(tree.props.entries.filter((e) => e.available && e.category === "scripts").length, 4);
});
