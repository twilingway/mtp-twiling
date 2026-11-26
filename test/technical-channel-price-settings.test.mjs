import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { settings, walk, text } from "./technical-state-oscillator-settings-fixture.mjs";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
const load = createSourceLoader(),
  core = load("model/technical-indicators/index.js");
const cases = {
  alma: { Период: "Length", Смещение: "Offset", Сигма: "Sigma" },
  lsma: { Период: "Length", Смещение: "Offset", Источник: "Source" },
  "chandelier-exit": { Период: "Length", "Период ATR": "ATR length", Множитель: "Multiplier" }
};

test("actual local library has55 available entries:51 technical incl Volume plus4 scripts, while blocked state disables additions", () => {
  for (const locale of ["ru", "en"])
    for (const blocked of [false, true]) {
      const state = {
        preferences: { locale, indicators: {}, technicalIndicators: [] },
        importingBackup: blocked
      };
      const reader = createSourceLoader({
        "react/jsx-runtime": jsx,
        "screens/terminal/context.js": { useTerminal: () => ({ controller: {}, state }) },
        "screens/terminal/useIndicatorMenuAction.js": {
          useIndicatorMenuAction: () => ({ pending: false, run: () => {} })
        },
        "screens/terminal/IndicatorLibraryDialog.js": { IndicatorLibraryDialog: () => null },
        "screens/terminal/state.js": {
          INDICATOR_NAMES: {
            mtpAll: "All MTP",
            mtp160: "MTP160",
            mtp440: "MTP440",
            mtp640: "MTP640"
          }
        },
        "screens/terminal/indicator-menu-actions.js": { changeMenuIndicator: () => {} }
      });
      const entries = reader(
        "screens/terminal/TerminalIndicatorLibrary.js"
      ).TerminalIndicatorLibrary().props.entries;
      assert.equal(entries.filter((e) => e.available).length, blocked ? 0 : 55);
      if (!blocked) {
        assert.equal(entries.filter((e) => e.available && e.category === "technicals").length, 51);
        assert.equal(entries.filter((e) => e.available && e.category === "scripts").length, 4);
      }
    }
});
test("actual RU/EN settings expose all and only builtin inputs, LSMA local2, CE two exit outputs; styles remain v1 on parameter edit", async () => {
  for (const locale of ["ru", "en"])
    for (const id of Object.keys(cases)) {
      const f = settings(id, locale);
      const i = f.controller.getSnapshot().preferences.technicalIndicators[0];
      const definition = core.getTechnicalIndicatorDefinition(id);
      i.styles = Object.fromEntries(
        definition.outputs.map((o) => [
          o.id,
          { color: "#123456", width: 3, visible: false, opacity: 0.35, lineStyle: "dotted" }
        ])
      );
      const previous = structuredClone(i.styles);
      let tree = f.render();
      for (const [ru, en] of Object.entries(cases[id]))
        assert.ok(f.control(tree, locale === "ru" ? ru : en));
      if (id === "alma") {
        assert.ok(!text(tree).includes(locale === "ru" ? "Источник" : "Source"));
        assert.ok(!text(tree).includes("floor"));
      }
      if (id === "lsma") {
        assert.equal(f.control(tree, locale === "ru" ? "Период" : "Length").props.min, 2);
        assert.ok(text(tree).includes(locale === "ru" ? "не подтверждён" : "unverified"));
      }
      if (id === "chandelier-exit") {
        assert.ok(text(tree).includes(locale === "ru" ? "Выход из длинной позиции" : "Long Exit"));
        assert.ok(
          text(tree).includes(locale === "ru" ? "Выход из короткой позиции" : "Short Exit")
        );
        assert.ok(!text(tree).includes("Signals"));
      }
      f.control(tree, locale === "ru" ? "Период" : "Length").props.onChange({
        target: { value: "30" }
      });
      await f.submit(f.render());
      const result = f.controller.getSnapshot().preferences.technicalIndicators[0];
      assert.equal(result.params.length, 30);
      assert.deepEqual(result.styles, previous);
      assert.equal(core.isTechnicalIndicatorInstance(result), true);
    }
});
test("settings live cost status explains affordable recovery and still permits valid expensive params without persisting a runtime flag", async () => {
  for (const locale of ["ru", "en"])
    for (const id of ["alma", "lsma"]) {
      const f = settings(id, locale);
      f.controller.getSnapshot().candles = Array(16000);
      let tree = f.render();
      assert.equal(walk(tree, (n) => n.props?.role === "status").length, 0);
      f.control(tree, locale === "ru" ? "Период" : "Length").props.onChange({
        target: { value: "10000" }
      });
      tree = f.render();
      const status = walk(tree, (n) => n.props?.role === "status")[0];
      assert.ok(status);
      assert.ok(
        text(status).includes(
          locale === "ru"
            ? "Уменьшите период или глубину истории"
            : "Reduce the period or history depth"
        )
      );
      assert.ok(!text(status).includes("warmup"));
      await f.submit(tree);
      const saved = f.controller.getSnapshot().preferences.technicalIndicators[0];
      assert.equal(saved.params.length, 10000);
      assert.equal(Object.hasOwn(saved, "unavailableReason"), false);
    }
  const f = settings("alma");
  f.controller.getSnapshot().candles = Array(16000);
  f.control(f.render(), "Период").props.onChange({ target: { value: "10000" } });
  assert.equal(walk(f.render(), (n) => n.props?.role === "status").length, 1);
  f.controller.getSnapshot().candles = Array(10000);
  assert.equal(walk(f.render(), (n) => n.props?.role === "status").length, 0);
  f.controller.getSnapshot().candles = Array(16000);
  f.control(f.render(), "Период").props.onChange({ target: { value: "9" } });
  assert.equal(walk(f.render(), (n) => n.props?.role === "status").length, 0);
});
test("actual price/lower legend rows use the same O1 status helper and clear status after history reduces", () => {
  for (const locale of ["ru", "en"])
    for (const pane of ["price", "lower"]) {
      const i = core.createTechnicalIndicatorInstance("alma", "limited", {
        params: { length: 10000 },
        pane: pane === "price" ? { kind: "overlay" } : { kind: "pane", id: "lower" }
      });
      const state = {
        candles: Array(16000),
        preferences: { locale, technicalIndicators: [i], technicalPaneLayout: [] }
      };
      const ui = createSourceLoader({
        react: { useRef: (v) => ({ current: v }) },
        "react/jsx-runtime": jsx,
        "screens/terminal/context.js": { useTerminal: () => ({ state, controller: {} }) },
        "screens/terminal/useIndicatorMenuAction.js": {
          useIndicatorMenuAction: () => ({ pending: false, run: () => {} })
        }
      })("screens/terminal/TechnicalIndicatorPanels.js");
      const expand = (n) => {
        if (Array.isArray(n)) return n.map(expand);
        if (!n || typeof n !== "object") return n;
        if (typeof n.type === "function") return expand(n.type(n.props));
        return { ...n, props: { ...n.props, children: expand(n.props?.children) } };
      };
      const render = () =>
        expand(pane === "price" ? ui.TechnicalPriceLegend() : ui.TechnicalObjectTree());
      assert.equal(walk(render(), (n) => n.props?.role === "status").length, 1);
      state.candles = Array(10000);
      assert.equal(walk(render(), (n) => n.props?.role === "status").length, 0);
    }
});
