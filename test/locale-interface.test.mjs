import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const accountName = "Личный аккаунт";
const avatarMarkup = `<span class="avatar" aria-hidden="true">${accountName.slice(0, 1).toLocaleUpperCase()}</span>`;
globalThis.window = { innerWidth: 1440 };
const nodeRequire = createRequire(import.meta.url),
  modules = new Map();
function load(relative) {
  let filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
  if (!existsSync(filename) && filename.endsWith(".ts")) filename += "x";
  assert.ok(filename.startsWith(sourceRoot));
  if (/services[/\\]storage(?:-db)?\.ts$/.test(filename)) return {};
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(
    (specifier) =>
      specifier.startsWith(".")
        ? load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)))
        : nodeRequire(specifier),
    module,
    module.exports
  );
  return module.exports;
}
const { setDisplayPreferences } = load("i18n/preferences.ts");
const { defaultPreferences } = load("screens/terminal/controller-bridge.ts");
const { TerminalContext } = load("screens/terminal/context.tsx");
const components = [
  ["Toolbar.tsx", "Toolbar"],
  ["ChartPanel.tsx", "ChartPanel"],
  ["RightPanel.tsx", "RightPanel"],
  ["DrawingToolbar.tsx", "DrawingToolbar"],
  ["AccountDialog.tsx", "AccountDialog"],
  ["ChartSettingsDialog.tsx", "ChartSettingsDialog"],
  ["InstrumentSearch.tsx", "InstrumentSearch"],
  ["ChartSettingsDialog.tsx", "IndicatorSettingsDialog"],
  ["drawings/DrawingSettingsDialog.tsx", "DrawingSettingsDialog"]
];
function render(file, name, locale) {
  const preferences = { ...defaultPreferences(), locale, timeZone: "Asia/Kathmandu" };
  setDisplayPreferences(preferences);
  const state = {
    preferences,
    rows: [],
    owner: "test-owner",
    name: accountName,
    candles: [],
    drawings: [],
    images: [],
    authenticated: false,
    pricesDirection: new Map(),
    chartRevision: 0,
    status: "offline",
    error: null,
    activeTool: null,
    historyHelp: "Подключите личный API-ключ",
    selectedObject: null,
    crosshairBar: null,
    editingIndicator: "mtp160",
    dialog: "drawing-settings"
  };
  if (name === "DrawingSettingsDialog") {
    state.selectedObject = "drawing-1";
    state.drawings = [
      {
        id: "drawing-1",
        name: "fibonacciLine",
        title: "Мой рисунок",
        points: [
          { timestamp: Date.parse("2026-07-15T12:00:00Z"), value: 10 },
          { timestamp: Date.parse("2026-07-15T13:00:00Z"), value: 12 }
        ]
      }
    ];
  }
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => null,
    subscribe: () => () => {},
    marketNow: () => Date.parse("2026-07-15T12:00:00Z"),
    tools: { scopeKey: () => "test" },
    panel: {},
    editing: {}
  };
  const Component = load(`screens/terminal/${file}`)[name];
  return renderToStaticMarkup(
    createElement(TerminalContext, { value: controller }, createElement(Component))
  );
}
test("main English UI and dialogs render translated text and tooltips while retaining user names", () => {
  for (const [file, name] of components) {
    const markup = render(file, name, "en");
    const allowed = markup
      .replaceAll(avatarMarkup, "")
      .replaceAll("Русский", "")
      .replaceAll(accountName, "")
      .replaceAll("Мой рисунок", "")
      .replaceAll("Т‑Инвестиции", "")
      .replaceAll("Т‑Банк", "")
      .replaceAll("Copyright (с)", "Copyright (c)");
    assert.doesNotMatch(
      allowed,
      /[А-ЯЁа-яё]/,
      `${name} contains untranslated interface text: ${allowed.match(/[А-ЯЁа-яё][^<>"{}]*/g)?.join("; ")}`
    );
  }
  const toolbar = render("Toolbar.tsx", "Toolbar", "en");
  assert.match(toolbar, /Личный аккаунт/);
  assert.ok(toolbar.includes(avatarMarkup), "the user's avatar initial remains untranslated");
});
test("Russian remains the default interface language", () => {
  assert.match(render("ChartSettingsDialog.tsx", "ChartSettingsDialog", "ru"), /Настройки графика/);
  assert.match(render("Toolbar.tsx", "Toolbar", "ru"), /Найти инструмент/);
});
