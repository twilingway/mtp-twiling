import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
function source(relative) {
  const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${code}\n})`, {
    filename: file
  }).runInThisContext()(
    (name) => source(path.relative(root, path.resolve(path.dirname(file), name))),
    module,
    module.exports
  );
  return module.exports;
}
const core = source("model/technical-indicators/index.js");
const averages = source("model/technical-indicators/averages/index.js");
const make = core.createTechnicalIndicatorInstance;
const bars = [2, 4, 6, 8].map((close, i) => ({
  timestamp: 1000 + i * 60_000,
  open: close - 0.5,
  high: close + 1,
  low: close - 1,
  close,
  volume: i + 1
}));
const equalSeries = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    expected[i] === null
      ? assert.equal(value, null)
      : assert.ok(Math.abs(value - expected[i]) < 1e-12, `${i}: ${value} != ${expected[i]}`)
  );
};

test("all42 registry definitions create validated instances with independently verified presets", () => {
  assert.equal(core.technicalIndicatorDefinitions.length, 45);
  const defaults = { wma: 9, vwma: 20, dema: 9, tema: 9, hma: 9, smma: 7 };
  for (const [id, length] of Object.entries(defaults)) {
    const instance = make(id, `instance-${id}`);
    assert.equal(instance.params.length, length);
    assert.equal(instance.params.source, "close");
    assert.deepEqual(instance.pane, { kind: "overlay" });
    assert.equal(core.isTechnicalIndicatorInstance(instance), true);
  }
  assert.throws(() => make("hma", "bad", { params: { length: 1 } }));
  assert.equal(make("hma", "minimum", { params: { length: 2 } }).params.length, 2);
});

test("runtime dispatches weighted averages with actual volume and explicit source selection", () => {
  const wma = core.calculateTechnicalIndicator(
    make("wma", "weighted", { params: { length: 2 } }),
    bars
  );
  equalSeries(wma.series.value, [null, 10 / 3, 16 / 3, 22 / 3]);
  const vwma = core.calculateTechnicalIndicator(
    make("vwma", "volume-weighted", { params: { length: 2 } }),
    bars
  );
  equalSeries(vwma.series.value, [null, 10 / 3, 26 / 5, 50 / 7]);
  const opened = core.calculateTechnicalIndicator(
    make("wma", "opening", { params: { length: 2, source: "open" } }),
    bars
  );
  equalSeries(opened.series.value, [null, 17 / 6, 29 / 6, 41 / 6]);
  const missing = bars.map((bar, i) => (i === 2 ? { ...bar, volume: null } : bar));
  const result = core.calculateTechnicalIndicator(
    make("vwma", "gap", { params: { length: 2 } }),
    missing
  );
  assert.equal(result.series.value[2], null);
  equalSeries(result.series.value, [null, 10 / 3, null, 20 / 3]);
  assert.deepEqual(
    result.timestamps,
    bars.map((bar) => bar.timestamp)
  );
});

test("composed runtime outputs match the tested math package and preserve its warmup/history contracts", () => {
  for (const id of ["dema", "tema", "hma", "smma"]) {
    const instance = make(id, `runtime-${id}`, { params: { length: 3 } });
    const result = core.calculateTechnicalIndicator(instance, bars);
    equalSeries(
      result.series.value,
      averages[id](
        bars.map((bar) => bar.close),
        3
      )
    );
    const metadata = averages.movingAverageMetadata(id, 3);
    assert.equal(result.warmupBars, metadata.warmupBars);
    assert.deepEqual(result.historyRequirement, metadata.historyRequirement);
  }
});

test("opacity and dash styles survive strict manual and Drive validation while invalid styles are rejected", () => {
  const style = { color: "#123456", width: 2, visible: true, opacity: 0.35, lineStyle: "dashed" };
  const instance = make("wma", "styled", { styles: { value: style } });
  const input = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: { technicalIndicators: [instance] },
    drawings: [],
    images: []
  };
  const backup = source("model/backup-format.js").validateBackup(JSON.parse(JSON.stringify(input)));
  const cloud = source("services/drive/backup.js").sanitizeDriveBackup(backup);
  assert.deepEqual(cloud.layout.technicalIndicators[0].styles.value, style);
  for (const invalid of [
    { opacity: 1.01 },
    { opacity: -1 },
    { opacity: NaN },
    { lineStyle: "script" }
  ]) {
    assert.equal(
      core.isTechnicalIndicatorInstance({
        ...instance,
        styles: { value: { ...style, ...invalid } }
      }),
      false
    );
  }
});
