import test from "node:test";
import assert from "node:assert/strict";
import * as jsx from "react/jsx-runtime";
import { settings, walk, text } from "./technical-state-oscillator-settings-fixture.mjs";
import {
  core,
  ids,
  defaults,
  custom,
  createSourceLoader,
  load
} from "./technical-trend-price-fixture.mjs";
const labels = {
  ru: {
    start: "Начальное ускорение",
    increment: "Шаг ускорения",
    maximum: "Максимальное ускорение",
    atrLength: "Период ATR",
    factor: "Множитель"
  },
  en: {
    start: "Start",
    increment: "Increment",
    maximum: "Maximum",
    atrLength: "ATR length",
    factor: "Factor"
  }
};
const saved = (f) => f.controller.getSnapshot().preferences.technicalIndicators[0];
const styleGroups = (tree) =>
  walk(tree, (node) => node.type === "div" && node.props.className === "technical-output-style");

test("RU/EN actual form inputs use exact defaults/bounds and submit custom params into price/own pane without styles", async () => {
  for (const locale of ["ru", "en"])
    for (const id of ids)
      for (const own of [false, true]) {
        const f = settings(id, locale),
          definition = core.getTechnicalIndicatorDefinition(id);
        let tree = f.render();
        for (const p of definition.parameters) {
          const input = f.control(tree, labels[locale][p.key]);
          assert.equal(input.props.type, "number");
          assert.equal(input.props.required, true);
          assert.equal(Number(input.props.value), defaults[id][p.key]);
          assert.equal(input.props.min, p.min);
          assert.equal(input.props.max, p.max);
          assert.equal(input.props.step, p.type === "integer" ? 1 : "any");
          input.props.onChange({ target: { value: String(custom[id][p.key]) } });
          tree = f.render();
        }
        f.control(tree, locale === "ru" ? "Расположение" : "Location").props.onChange({
          target: { value: own ? `pane:${id}` : "price" }
        });
        await f.submit(f.render());
        assert.equal(f.writes.length, 1);
        assert.deepEqual(saved(f).params, custom[id]);
        assert.deepEqual(saved(f).pane, own ? { kind: "pane", id } : { kind: "overlay" });
        assert.equal(Object.hasOwn(saved(f), "styles"), false);
        assert.equal(core.isTechnicalIndicatorInstance(saved(f)), true);
        const data = new (load("charts/technical-render-data.js").TechnicalRenderData)();
        assert.ok(
          data
            .compile([saved(f)])
            .outputs.every((o) => o.presentation.precisionPolicy === "native-price")
        );
      }
});

test("SAR cross form shows Size and plus preview, no Line selector, preserves imported dotted style on period and point edits", async () => {
  for (const locale of ["ru", "en"])
    for (const edit of ["parameter", "size", "color", "opacity"]) {
      const f = settings("parabolic-sar", locale),
        imported = {
          color: "#123456",
          width: 3,
          visible: false,
          opacity: 0.35,
          lineStyle: "dotted"
        };
      saved(f).styles = { value: { ...imported } };
      let tree = f.render(),
        group = styleGroups(tree)[0];
      assert.ok(text(group).includes(locale === "ru" ? "Размер" : "Size"));
      assert.ok(!text(group).includes(locale === "ru" ? "Толщина" : "Width"));
      assert.equal(walk(group, (n) => n.type === "select").length, 0);
      const preview = walk(group, (n) => n.type === "path")[0];
      assert.ok(preview.props.d.includes("V"));
      assert.equal(preview.props.strokeDasharray, undefined);
      if (edit === "parameter")
        f.control(tree, labels[locale].start).props.onChange({ target: { value: "0.15" } });
      else {
        const type = edit === "size" ? "number" : edit === "opacity" ? "range" : "color",
          input = walk(group, (n) => n.type === "input" && n.props.type === type)[0];
        input.props.onChange({
          target: { value: edit === "size" ? "4" : edit === "opacity" ? "75" : "#654321" }
        });
      }
      await f.submit(f.render());
      assert.equal(f.writes.length, 1);
      assert.deepEqual(saved(f).styles.value, {
        ...imported,
        ...(edit === "size"
          ? { width: 4 }
          : edit === "opacity"
            ? { opacity: 0.75 }
            : edit === "color"
              ? { color: "#654321" }
              : {})
      });
      const data = new (load("charts/technical-render-data.js").TechnicalRenderData)(),
        plot = data.compile([saved(f)]).outputs[0].presentation;
      assert.equal(plot.geometry.size.value, edit === "size" ? 4 : 3);
      assert.equal(
        plot.lineStyle,
        "dotted",
        "legacy data preserved although renderer cross has no dash"
      );
    }
});

test("Supertrend form exposes only two visible stroke controls, preserving unedited styles and no fill autosave", async () => {
  for (const locale of ["ru", "en"]) {
    const f = settings("supertrend", locale),
      manual = { color: "#123456", width: 2, visible: false, lineStyle: "dashed" };
    saved(f).styles = { downTrend: manual };
    let tree = f.render();
    const groups = styleGroups(tree);
    assert.equal(groups.length, 2);
    assert.ok(text(groups[0]).includes(locale === "ru" ? "Восходящий тренд" : "Up Trend"));
    assert.ok(text(groups[1]).includes(locale === "ru" ? "Нисходящий тренд" : "Down Trend"));
    assert.ok(groups.every((g) => walk(g, (n) => n.type === "select").length === 1));
    assert.ok(!text(tree).includes("bodyMiddle") && !text(tree).includes("direction"));
    walk(groups[0], (n) => n.type === "input" && n.props.type === "color")[0].props.onChange({
      target: { value: "#654321" }
    });
    await f.submit(f.render());
    assert.equal(f.writes.length, 1);
    assert.equal(saved(f).styles.downTrend, manual);
    assert.deepEqual(saved(f).styles.upTrend, {
      color: "#654321",
      width: 1,
      visible: true,
      opacity: 1,
      lineStyle: "solid"
    });
    assert.deepEqual(Object.keys(saved(f).styles), ["downTrend", "upTrend"]);
    assert.ok(!Object.hasOwn(saved(f), "fills"));
  }
});

test("actual form submit rejects out-of-bounds/non-numeric/fractional-period values without changing saved params", async () => {
  for (const id of ids)
    for (const p of core.getTechnicalIndicatorDefinition(id).parameters)
      for (const bad of [
        "unknown",
        String(p.min - 0.01),
        String(p.max + 0.01),
        ...(p.type === "integer" ? ["1.5"] : [])
      ]) {
        const f = settings(id, "en");
        f.control(f.render(), labels.en[p.key]).props.onChange({ target: { value: bad } });
        await f.submit(f.render());
        assert.equal(f.writes.length, 0);
        assert.deepEqual(saved(f).params, defaults[id]);
        assert.ok(
          walk(f.render(), (n) => n.props?.role === "alert").some((n) =>
            text(n).includes("Check parameters")
          )
        );
      }
});

test("actual local library exposes52 entries:48 technical with Volume and4 scripts; availability honors block", () => {
  for (const locale of ["ru", "en"]) {
    const state = { preferences: { locale, indicators: {}, technicalIndicators: [] } },
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
    const tree = reader("screens/terminal/TerminalIndicatorLibrary.js").TerminalIndicatorLibrary();
    assert.equal(tree.props.entries.filter((e) => e.available).length, 52);
    assert.equal(
      tree.props.entries.filter((e) => e.available && e.category === "technicals").length,
      48
    );
    assert.equal(
      tree.props.entries.filter((e) => e.available && e.category === "scripts").length,
      4
    );
  }
});
