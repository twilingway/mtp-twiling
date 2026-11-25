import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(
    (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const { historyInstruments } = load("model/history-instruments.ts");
const { selectedHistory } = load("model/history-settings.ts");
const rows = [
  { uid: "bank", name: "Т-Технологии", symbol: "T" },
  { uid: "ordinary", name: "Ростелеком", ticker: "RTKM" },
  { uid: "other-board", name: "Ростелеком", ticker: "RTKM" },
  { uid: "oil", name: "Роснефть", ticker: "ROSN" },
  { uid: "yo", name: "Ёлка", ticker: "TREE" }
];
const group = (uid, timeframe, bars = 10, bytes = 480) => ({ uid, timeframe, bars, bytes, blocks: 1 });
const groups = [group("bank", "4h"), group("ordinary", "1d"), group("bank", "1d", 20, 960), group("bank", "1h"), group("other-board", "1d"), group("oil", "1d"), group("removed", "1w"), group("yo", "1M")];

test("history groups by instrument UID, totals its frames and orders frames without mutating input", () => {
  const before = structuredClone(groups);
  const result = historyInstruments(groups, rows, "", "ru-RU");
  const bank = result.find((item) => item.uid === "bank");
  assert.equal(bank.bars, 40);
  assert.equal(bank.bytes, 1920);
  assert.deepEqual(bank.groups.map((item) => item.timeframe), ["1h", "4h", "1d"]);
  assert.equal(result.filter((item) => item.ticker === "RTKM").length, 2);
  assert.equal(result.find((item) => item.uid === "removed").name, "removed");
  assert.deepEqual(groups, before);
});

test("storage search matches parts of name or ticker, case, whitespace and yo, not only full names", () => {
  assert.equal(historyInstruments(groups, rows, "технол", "ru-RU")[0].uid, "bank");
  assert.equal(historyInstruments(groups, rows, " rOsN ", "en-US")[0].uid, "oil");
  assert.equal(historyInstruments(groups, rows, "елк", "ru-RU")[0].uid, "yo");
  assert.equal(historyInstruments(groups, rows, " RTKM рост ", "ru-RU").length, 2);
  assert.equal(historyInstruments(groups, rows, "does-not-exist", "en-US").length, 0);
});

test("search does not narrow deletion scope; instrument selection includes all its frames", () => {
  const stats = { groups, bars: 90, bytes: 4320, blocks: 8 };
  const selection = { uid: "bank", timeframe: "all" };
  const before = selectedHistory(stats, selection);
  historyInstruments(groups, rows, "ROSN", "ru-RU");
  assert.deepEqual(selectedHistory(stats, selection), before);
  assert.equal(before.groups.length, 3);
  assert.equal(selectedHistory(stats, { uid: "bank", timeframe: "4h" }).groups.length, 1);
  assert.equal(selectedHistory(stats, { uid: "ordinary", timeframe: "all" }).groups.length, 1);
});
