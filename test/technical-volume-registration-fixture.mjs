import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
export function createSourceLoader(
  overrides = {},
  readSource = (relative, file) => readFileSync(file, "utf8")
) {
  const cache = new Map();
  function load(relative) {
    relative = relative.replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    const candidate = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    const file = existsSync(candidate) ? candidate : candidate + "x";
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(
      readSource(path.relative(sourceRoot, file).replaceAll(path.sep, "/"), file),
      {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, {
      filename: file
    }).runInThisContext()(
      (specifier) =>
        specifier.startsWith(".")
          ? load(path.relative(sourceRoot, path.resolve(path.dirname(file), specifier)))
          : load(specifier),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
export const load = createSourceLoader();
export const core = load("model/technical-indicators/index.js");
export const defaults = {
  cmf: { length: 20 },
  "chaikin-oscillator": { fastLength: 3, slowLength: 10 },
  efi: { length: 13 },
  eom: { length: 14, divisor: 10000 },
  "volume-oscillator": {
    fastLength: 12,
    slowLength: 26,
    signalLength: 9,
    oscillatorAverage: "EMA",
    signalAverage: "EMA"
  },
  nvi: { emaLength: 255 },
  pvi: { emaLength: 255 }
};
export const ids = Object.keys(defaults);
export const candle = (close, volume = 1, high = close, low = close, i = 0) => ({
  timestamp: 1710000000123 + i * 71999,
  open: close,
  high,
  low,
  close,
  volume
});
export const candles = (prices, volumes) =>
  prices.map((price, i) => candle(price, volumes ? volumes[i] : 1, price, price, i));
export const calculate = (id, bars, params = {}) =>
  core.calculateTechnicalIndicator(core.createTechnicalIndicatorInstance(id, id, { params }), bars);
export function legacyContract(model) {
  const definitions = model.technicalIndicatorDefinitions.slice(0, 35);
  const instances = definitions.map((definition, order) =>
    model.createTechnicalIndicatorInstance(definition.id, `legacy-${definition.id}`, { order })
  );
  const regular = Array.from({ length: 40 }, (_, i) =>
    candle(10 + (i % 7), i % 6, 12 + (i % 7), 8 + (i % 7), i)
  );
  const cases = [
    [],
    regular,
    regular.map((bar) => ({ ...bar, volume: null })),
    regular.map((bar, i) =>
      i % 5 === 2 ? { ...bar, open: null, high: null, low: null, close: null, volume: null } : bar
    )
  ];
  return {
    definitions,
    instances,
    results: cases.map((bars) =>
      instances.map((instance) =>
        model.calculateTechnicalIndicator(instance, bars, {
          historicalVolatilityPeriodsPerYear: 365
        })
      )
    )
  };
}
