import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { readFileSync } from "node:fs";
import {
  EXPECTED_LIBRARY_COUNT,
  EXPECTED_TECHNICAL_COUNT
} from "./technical-registry-expectation.mjs";
import { settings, walk, text } from "./technical-state-oscillator-settings-fixture.mjs";
import { core, defaults, createSourceLoader } from "./keltner-fixture.mjs";
const instance = (f) => f.controller.getSnapshot().preferences.technicalIndicators[0];
const labels = {
  ru: {
    length: "Период",
    multiplier: "Множитель",
    source: "Источник",
    useExponentialMa: "Экспоненциальная средняя",
    bandsStyle: "Тип диапазона",
    atrLength: "Период ATR"
  },
  en: {
    length: "Length",
    multiplier: "Multiplier",
    source: "Source",
    useExponentialMa: "Use Exponential MA",
    bandsStyle: "Bands Style",
    atrLength: "ATR length"
  }
};

test("RU/EN actual form exposes genuine16x16 checkbox and exact3 canonical choices, saves boolfalse without styles in price/own pane", async () => {
  const css = readFileSync(new URL("../public/technical-indicators.css", import.meta.url), "utf8");
  assert.match(
    css,
    /\.technical-settings input\[type="checkbox"\]\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/
  );
  for (const locale of ["ru", "en"])
    for (const choice of core.KELTNER_BANDS_STYLES)
      for (const own of [false, true]) {
        const f = settings("keltner-channels", locale);
        let tree = f.render();
        const groups = walk(tree, (node) => node.props?.className === "technical-output-style");
        assert.equal(groups.length, 3);
        if (locale === "ru")
          for (const title of ["Верхняя граница", "Основа", "Нижняя граница"])
            assert.ok(text(groups).includes(title));
        for (const [key, title] of Object.entries(labels[locale]))
          assert.ok(f.control(tree, title));
        const check = f.control(tree, labels[locale].useExponentialMa);
        assert.equal(check.props.type, "checkbox");
        assert.equal(check.props.checked, true);
        assert.equal(check.props.value, undefined);
        check.props.onChange({ target: { checked: false, value: "on" } });
        tree = f.render();
        assert.equal(f.control(tree, labels[locale].useExponentialMa).props.checked, false);
        const select = f.control(tree, labels[locale].bandsStyle),
          options = walk(select, (node) => node.type === "option");
        assert.deepEqual(
          options.map((o) => o.props.value),
          core.KELTNER_BANDS_STYLES
        );
        if (locale === "ru")
          assert.deepEqual(options.map(text), [
            "Средний истинный диапазон",
            "Истинный диапазон",
            "Диапазон"
          ]);
        select.props.onChange({ target: { value: choice } });
        tree = f.render();
        f.control(tree, labels[locale].length).props.onChange({ target: { value: "3" } });
        tree = f.render();
        f.control(tree, locale === "ru" ? "Расположение" : "Location").props.onChange({
          target: { value: own ? "pane:keltner-channels" : "price" }
        });
        await f.submit(f.render());
        assert.equal(f.writes.length, 1);
        assert.deepEqual(instance(f).params, {
          ...defaults,
          length: 3,
          useExponentialMa: false,
          bandsStyle: choice
        });
        assert.deepEqual(
          instance(f).pane,
          own ? { kind: "pane", id: "keltner-channels" } : { kind: "overlay" }
        );
        assert.equal(Object.hasOwn(instance(f), "styles"), false);
      }
});

test("bool change/revert and inputs/pane save preserve exact imported sparse styles; no fill settings materialized", async () => {
  for (const locale of ["ru", "en"]) {
    const f = settings("keltner-channels", locale),
      styles = { basis: { color: "#123456", width: 3, visible: false, lineStyle: "dotted" } };
    instance(f).styles = styles;
    let tree = f.render();
    for (const checked of [false, true]) {
      f.control(tree, labels[locale].useExponentialMa).props.onChange({ target: { checked } });
      tree = f.render();
    }
    f.control(tree, labels[locale].multiplier).props.onChange({ target: { value: "1.5" } });
    await f.submit(f.render());
    assert.equal(f.writes.length, 1);
    assert.deepEqual(instance(f).styles, styles);
    assert.equal(instance(f).params.useExponentialMa, true);
    assert.equal(Object.hasOwn(instance(f), "fills"), false);
    assert.deepEqual(Object.keys(instance(f).styles), ["basis"]);
  }
});

test("generic choices retain actual PVO EMA/SMA controls and all4 combinations while rejecting KC choices", async () => {
  for (const oscillatorAverage of ["EMA", "SMA"])
    for (const signalAverage of ["EMA", "SMA"]) {
      const f = settings("volume-oscillator", "en");
      let tree = f.render();
      for (const [label, value] of [
        ["Oscillator MA type", oscillatorAverage],
        ["Signal MA type", signalAverage]
      ]) {
        const select = f.control(tree, label);
        assert.deepEqual(
          walk(select, (n) => n.type === "option").map((o) => o.props.value),
          ["EMA", "SMA"]
        );
        select.props.onChange({ target: { value } });
        tree = f.render();
      }
      await f.submit(tree);
      assert.equal(f.writes.length, 1);
      assert.equal(instance(f).params.oscillatorAverage, oscillatorAverage);
      assert.equal(instance(f).params.signalAverage, signalAverage);
      assert.equal(Object.hasOwn(instance(f), "styles"), false);
    }
  const f = settings("volume-oscillator", "en");
  f.control(f.render(), "Oscillator MA type").props.onChange({ target: { value: "Range" } });
  await f.submit(f.render());
  assert.equal(f.writes.length, 0);
});

test("actual submit rejects unknown/fractional/nonnumeric band/input values and does not replace defaults", async () => {
  for (const [key, bad] of [
    ["bandsStyle", "Range "],
    ["bandsStyle", "EMA"],
    ["length", "1.5"],
    ["atrLength", "0"],
    ["multiplier", "unknown"]
  ]) {
    const f = settings("keltner-channels", "en");
    f.control(f.render(), labels.en[key]).props.onChange({ target: { value: bad } });
    await f.submit(f.render());
    assert.equal(f.writes.length, 0);
    assert.deepEqual(instance(f).params, defaults);
    assert.ok(
      walk(f.render(), (n) => n.props?.role === "alert").some((n) =>
        text(n).includes("Check parameters")
      )
    );
  }
});

test("KC live cost status recovers and never encodes the transient limit in saved instance", async () => {
  for (const locale of ["ru", "en"]) {
    const f = settings("keltner-channels", locale);
    f.controller.getSnapshot().candles = Array(1000001);
    let tree = f.render();
    assert.equal(walk(tree, (n) => n.props?.role === "status").length, 1);
    f.controller.getSnapshot().candles = Array(1000000);
    tree = f.render();
    assert.equal(walk(tree, (n) => n.props?.role === "status").length, 0);
    f.controller.getSnapshot().candles = Array(1000001);
    await f.submit(f.render());
    assert.equal(f.writes.length, 1);
    assert.equal(Object.hasOwn(instance(f), "unavailableReason"), false);
  }
});

test("actual local library includes KC and the reviewed implementation set; blocked state stays unavailable", () => {
  for (const locale of ["ru", "en"])
    for (const importingBackup of [false, true]) {
      const state = {
          preferences: { locale, indicators: {}, technicalIndicators: [] },
          importingBackup
        },
        reader = createSourceLoader({
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
      assert.equal(
        entries.filter((e) => e.available).length,
        importingBackup ? 0 : EXPECTED_LIBRARY_COUNT
      );
      assert.equal(
        entries.filter((e) => e.available && e.category === "technicals").length,
        importingBackup ? 0 : EXPECTED_TECHNICAL_COUNT
      );
    }
});
