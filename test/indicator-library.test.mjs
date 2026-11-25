import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function modules(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    if (relative === "react") return react;
    if (relative === "react/jsx-runtime") return jsx;
    const candidate = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      file = existsSync(candidate) ? candidate : candidate + "x";
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, {
      filename: file
    }).runInThisContext()(
      (specifier) =>
        specifier.startsWith(".")
          ? load(path.relative(root, path.resolve(path.dirname(file), specifier)))
          : load(specifier),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
const model = modules()("model/indicator-library.js");
const entries = Object.freeze([
  Object.freeze({
    id: "mtpAll",
    label: "MTP 0–640",
    aliases: ["МТП", "all"],
    category: "scripts",
    available: true
  }),
  Object.freeze({ id: "mtp160", label: "MTP 0–160", category: "scripts", available: true }),
  Object.freeze({
    id: "rsi",
    label: "Relative Strength Index",
    aliases: ["RSI", "Индекс силы"],
    category: "technicals",
    available: false,
    reason: "Расчёт недоступен"
  }),
  Object.freeze({
    id: "sma",
    label: "Simple Moving Average",
    aliases: ["SMA", "Скользящая средняя"],
    category: "technicals",
    available: true
  }),
  Object.freeze({
    id: "ema",
    label: "Exponential Moving Average",
    aliases: ["EMA"],
    description: "Not searchable metadata",
    category: "technicals",
    available: true
  })
]);

test("library search matches case-insensitive label/alias substrings within its section without mutation", () => {
  const before = JSON.stringify(entries),
    find = (category, query) =>
      model.filterIndicatorLibrary(entries, category, query).map((entry) => entry.id);
  assert.deepEqual(find("scripts", "  мтп  "), ["mtpAll"]);
  assert.deepEqual(find("scripts", "MTP"), ["mtpAll", "mtp160"]);
  assert.deepEqual(find("technicals", "moving"), ["sma", "ema"]);
  assert.deepEqual(find("technicals", "rSi"), ["rsi"]);
  assert.deepEqual(find("technicals", "ＲＳＩ"), ["rsi"]);
  assert.deepEqual(find("technicals", "средняя"), ["sma"]);
  assert.deepEqual(find("scripts", "rsi"), []);
  assert.deepEqual(find("technicals", "not searchable"), []);
  assert.deepEqual(find("scripts", ""), ["mtpAll", "mtp160"]);
  assert.equal(JSON.stringify(entries), before);
});

test("adding is enable-only, repeated active requests keep the same ID, unavailable entries never invoke caller", () => {
  const added = [];
  assert.equal(
    model.addIndicatorLibraryEntry(entries[0], (id) => added.push(id)),
    true
  );
  assert.equal(
    model.addIndicatorLibraryEntry(entries[0], (id) => added.push(id)),
    true
  );
  assert.equal(
    model.addIndicatorLibraryEntry(entries[2], (id) => added.push(id)),
    false
  );
  assert.deepEqual(added, ["mtpAll", "mtpAll"]);
});

function walk(node, predicate, result = []) {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, predicate, result));
    return result;
  }
  if (predicate(node)) result.push(node);
  walk(node.props?.children, predicate, result);
  return result;
}
function harness() {
  const state = ["scripts", ""],
    refs = [{ current: null }, { current: null }];
  let stateIndex = 0,
    refIndex = 0;
  const added = [],
    closes = [],
    hooks = {
      ...react,
      useState: (initial) => {
        const index = stateIndex++;
        return [
          state[index] ?? initial,
          (value) => {
            state[index] = value;
          }
        ];
      },
      useRef: () => refs[refIndex++],
      useEffect: () => {}
    };
  const { IndicatorLibraryDialog } = modules({ react: hooks })(
    "screens/terminal/IndicatorLibraryDialog.js"
  );
  const render = (locale = "ru") => {
    stateIndex = 0;
    refIndex = 0;
    return IndicatorLibraryDialog({
      entries,
      activeIds: new Set(["mtpAll"]),
      locale,
      onAdd: (id) => added.push(id),
      onClose: () => closes.push(true)
    });
  };
  return { render, refs, added, closes };
}

test("dialog has exactly two sections; section switch/search keeps disabled reason and prevents disabled selection", () => {
  const h = harness();
  let tree = h.render();
  const sections = walk(tree, (node) => node.type === "nav")[0];
  assert.equal(walk(sections, (node) => node.type === "button").length, 2);
  const scriptButtons = walk(tree, (node) => node.props?.["data-indicator-id"]);
  scriptButtons[0].props.onClick();
  scriptButtons[0].props.onClick();
  assert.deepEqual(h.added, ["mtpAll", "mtpAll"]);
  walk(sections, (node) => node.type === "button")[1].props.onClick();
  tree = h.render();
  const rsi = walk(tree, (node) => node.props?.["data-indicator-id"] === "rsi")[0];
  assert.equal(rsi.props.disabled, true);
  assert.ok(rsi.props["aria-describedby"]);
  rsi.props.onClick();
  assert.deepEqual(h.added, ["mtpAll", "mtpAll"]);
  const search = walk(tree, (node) => node.type === "input")[0];
  search.props.onChange({ target: { value: "sma" } });
  assert.deepEqual(
    walk(h.render(), (node) => node.props?.["data-indicator-id"]).map(
      (node) => node.props["data-indicator-id"]
    ),
    ["sma"]
  );
  search.props.onChange({ target: { value: "no matches" } });
  assert.equal(walk(h.render(), (node) => node.props?.role === "status").length, 1);
});

test("search ArrowDown targets enabled results; list navigation wraps and Escape routes once to onClose", () => {
  const h = harness(),
    tree = h.render(),
    focused = [];
  const buttons = [0, 1].map((index) => ({ focus: () => focused.push(index) }));
  h.refs[1].current = {
    querySelectorAll: (selector) => {
      assert.match(selector, /:not\(:disabled\)/);
      return buttons;
    }
  };
  let prevented = 0,
    stopped = 0;
  const search = walk(tree, (node) => node.type === "input")[0];
  search.props.onKeyDown({ key: "ArrowDown", preventDefault: () => prevented++ });
  const list = walk(tree, (node) => node.type === "section")[0];
  list.props.onKeyDown({ key: "ArrowUp", target: buttons[0], preventDefault: () => prevented++ });
  list.props.onKeyDown({ key: "Home", target: buttons[1], preventDefault: () => prevented++ });
  assert.deepEqual(focused, [0, 1, 0]);
  assert.equal(prevented, 3);
  const wrapper = tree.props.children;
  wrapper.props.onKeyDown({
    key: "Escape",
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++
  });
  assert.equal(h.closes.length, 1);
  assert.equal(stopped, 1);
  assert.equal(model.indicatorLibraryFocusIndex("ArrowDown", 0, 0), null);
  assert.equal(model.indicatorLibraryFocusIndex("Enter", 0, 2), null);
  assert.equal(model.indicatorLibraryFocusIndex("End", 0, 2), 1);
});

test("actual React SSR renders localized scripts and active badge without unsupported categories", () => {
  const { IndicatorLibraryDialog } = modules()("screens/terminal/IndicatorLibraryDialog.js");
  for (const locale of ["ru", "en"]) {
    const html = renderToStaticMarkup(
      react.createElement(IndicatorLibraryDialog, {
        entries,
        activeIds: ["mtpAll"],
        locale,
        onAdd: () => {},
        onClose: () => {}
      })
    );
    assert.match(html, /<dialog/);
    assert.match(html, locale === "ru" ? /Мои скрипты/ : /My scripts/);
    assert.match(html, locale === "ru" ? /Теханализ/ : /Technicals/);
    assert.match(html, locale === "ru" ? /Добавлен/ : /Added/);
    assert.match(html, /aria-label="(?:Поиск индикаторов|Search indicators)"/);
    assert.doesNotMatch(html, /Community|Fundamentals|Purchased|Стратегии|Покупки|Сообщество/);
  }
});
