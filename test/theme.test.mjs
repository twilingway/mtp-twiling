import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
function load(relative) {
  const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
  assert.ok(filename.startsWith(sourceRoot));
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const evaluate = vm.runInThisContext(`(function(require,module,exports){${output}\n})`, {
    filename
  });
  evaluate(
    (specifier) => {
      assert.ok(specifier.startsWith("."));
      return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)));
    },
    module,
    module.exports
  );
  return module.exports;
}

const { terminalTheme, chartBackground, chartPalette, withTheme, THEME_PALETTES } =
  load("model/theme.ts");
const { validateBackup } = load("model/backup-format.ts");
const { defaultPreferences } = load("screens/terminal/controller-bridge.ts");
const { migrateCandlePalette } = load("model/candle-palette.ts");
const backup = (chartSettings) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  layout: { chartSettings },
  drawings: [],
  images: []
});

test("older settings and backups without a theme keep their dark appearance", () => {
  assert.equal(terminalTheme({}), "dark");
  assert.equal(chartBackground({}), THEME_PALETTES.dark.background);
  assert.equal(validateBackup(backup({})).layout.chartSettings.theme, undefined);
  assert.equal(chartBackground({ theme: "light" }), THEME_PALETTES.light.background);
});

test("theme-only light backup resolves to a white chart after merging profile defaults", () => {
  const imported = validateBackup(backup({ theme: "light" })).layout.chartSettings;
  const settings = { ...defaultPreferences().chartSettings, ...migrateCandlePalette(imported) };
  assert.equal(terminalTheme(settings), "light");
  assert.equal(chartBackground(settings), "#ffffff");
  assert.equal(chartBackground(defaultPreferences().chartSettings), "#131722");
});

test("standard background follows theme changes in either direction", () => {
  for (const original of [
    {},
    { background: "#131722" },
    { background: "#131722", theme: "dark" }
  ]) {
    const light = withTheme(original, "light");
    assert.equal(light.theme, "light");
    assert.equal(chartBackground(light), THEME_PALETTES.light.background);
    const dark = withTheme(light, "dark");
    assert.equal(dark.theme, "dark");
    assert.equal(chartBackground(dark), THEME_PALETTES.dark.background);
  }
  assert.equal(withTheme({ theme: "light", background: "#FFFFFF" }, "dark").background, "#131722");
});

test("theme changes preserve custom colors, indicators, drawing templates and toolbar state", () => {
  const original = Object.freeze({
    background: "#345678",
    upColor: "#123456",
    downColor: "#654321",
    wickUpColor: "#abcdef",
    wickDownColor: "#fedcba",
    borderUpColor: "#135790",
    borderDownColor: "#246801",
    scaleFontSize: 14,
    indicatorOptions: Object.freeze({ ma: Object.freeze({ color: "#876543", width: 3 }) }),
    drawingTemplates: Object.freeze({
      "default:segment": Object.freeze({ settings: Object.freeze({ color: "#987654", width: 4 }) })
    }),
    drawingTools: Object.freeze({ magnet: "strong" })
  });
  const changed = withTheme(original, "light");
  assert.notEqual(changed, original);
  const { theme, ...unchanged } = changed;
  assert.equal(theme, "light");
  assert.deepEqual(unchanged, original);
  assert.equal(changed.indicatorOptions, original.indicatorOptions);
  assert.equal(changed.drawingTemplates, original.drawingTemplates);
  assert.equal(chartBackground(withTheme(changed, "dark")), original.background);
  assert.equal(
    validateBackup(backup(changed)).layout.chartSettings.background,
    original.background
  );
});

test("selecting the existing theme keeps the current custom background", () => {
  const settings = { theme: "light", background: "#131722" };
  assert.deepEqual(withTheme(settings, "light"), settings);
  assert.equal(chartPalette(settings).text, THEME_PALETTES.dark.text);
  assert.equal(
    chartPalette({ theme: "dark", background: "#ffffff" }).text,
    THEME_PALETTES.light.text
  );
});

test("both theme values survive backup serialization; unsupported values are rejected", () => {
  for (const theme of ["dark", "light"]) {
    const parsed = JSON.parse(JSON.stringify(backup({ theme })));
    assert.equal(validateBackup(parsed).layout.chartSettings.theme, theme);
  }
  for (const theme of ["auto", "Light", "", null, 0, {}, []]) {
    assert.throws(() => validateBackup(backup({ theme })), /Некорректная структура/);
  }
});

test("chart text and scale labels remain readable on custom dark, light and midtone backgrounds", () => {
  const luminance = (hex) => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((part) => {
      const value = Number.parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const theme of ["dark", "light"]) {
    for (const background of [
      "#000000",
      "#131722",
      "#ffffff",
      "#eeeeee",
      "#666666",
      "#888888",
      "#345678"
    ]) {
      const palette = chartPalette({ theme, background });
      assert.equal(palette.background, background);
      for (const color of [palette.text, palette.muted]) {
        const values = [luminance(background), luminance(color)].sort((a, b) => a - b);
        assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, `${color} on ${background}`);
      }
    }
  }
});
