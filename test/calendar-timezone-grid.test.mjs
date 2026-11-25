import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const context = vm.createContext({ Date, Intl });
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
  assert.ok(file.startsWith(root));
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${code}\n})`, { filename: file })
    .runInContext(context)(
      (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module, module.exports
    );
  return module.exports;
}
const { calendarAxisDisplay } = load("i18n/calendar-axis.ts");
const { calendarAxisTicks } = load("model/intervals/axis-ticks.ts");
const { paintCalendarGrid, paintCalendarAxis } = load("charts/lightweight-calendar-grid.ts");
const bars = (start, count, step) => Array.from({ length: count }, (_, i) => ({ timestamp: Date.parse(start) + i * step }));
const ticks = (data, timeframe, zone) => calendarAxisTicks(data, timeframe, {
  from: 0, to: data.length - 1, width: 1000, coordinate: (i) => 40 + i * 7,
  display: calendarAxisDisplay(timeframe, { timeZone: zone, locale: "en" })
});

test("hourly grid uses selected local midnight while UTC timestamps stay unchanged", () => {
  const data = bars("2026-03-03T00:00:00Z", 72, 3600000);
  const original = JSON.stringify(data);
  const moscow = Array.from(ticks(data, "1h", "Europe/Moscow"), (tick) => tick.value);
  const utc = Array.from(ticks(data, "1h", "UTC"), (tick) => tick.value);
  assert.ok(moscow.includes(Date.parse("2026-03-03T21:00:00Z")));
  assert.ok(!utc.includes(Date.parse("2026-03-03T21:00:00Z")));
  assert.ok(utc.includes(Date.parse("2026-03-04T00:00:00Z")));
  assert.equal(JSON.stringify(data), original);
});

test("DST changes day widths by real bar counts; daily trading dates ignore display zone", () => {
  const hourly = bars("2026-03-07T05:00:00Z", 96, 3600000);
  const starts = Array.from(ticks(hourly, "1h", "America/New_York"), (tick) => tick.value);
  const march8 = Date.parse("2026-03-08T05:00:00Z");
  const march9 = Date.parse("2026-03-09T04:00:00Z");
  assert.ok(starts.includes(march8));
  assert.ok(starts.includes(march9));
  assert.equal((march9 - march8) / 3600000, 23);
  const daily = bars("2026-01-01T00:00:00Z", 100, 86400000);
  const ny = Array.from(ticks(daily, "1d", "America/New_York"), (tick) => ({ ...tick }));
  const utc = Array.from(ticks(daily, "1d", "UTC"), (tick) => ({ ...tick }));
  assert.deepEqual(ny, utc);
});

test("calendar grid and painted axis labels use identical local boundary positions", () => {
  const data = bars("2026-03-03T00:00:00Z", 72, 3600000);
  const grid = [], labels = [];
  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {}, lineTo() {},
    moveTo(x) { grid.push(x); },
    measureText(text) { return { width: text.length * 6 }; },
    fillText(text, x) { labels.push({ text, x }); }
  };
  const options = {
    from: 0, to: data.length - 1, width: 1000, height: 26,
    coordinate: (i) => 40 + i * 7, color: "#999999", fontSize: 11, fontFamily: "Arial",
    display: calendarAxisDisplay("1h", { timeZone: "Europe/Moscow", locale: "en" })
  };
  paintCalendarGrid(ctx, data, "1h", options);
  paintCalendarAxis(ctx, data, "1h", options);
  assert.equal(grid.length, labels.length);
  assert.deepEqual(grid.map((x) => x - 0.5), labels.map((label) => label.x));
  assert.ok(labels.some((label) => label.text.includes("Mar")));
});
