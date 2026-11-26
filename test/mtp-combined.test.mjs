import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { MtpModel, MTP_DEFINITIONS, MTP_COMBINED_PERIODS, activeMtpPeriods } from "../public/mtp.js";
import { validateBackup } from "../public/backup-format.js";

async function pureModule(name) {
  const source = readFileSync(new URL(`../src/model/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const off = { ma: false, ema: false, volume: true, mtp160: false, mtp440: false, mtp640: false };

test("combined MTP keeps every original Pine period exactly once even with overlapping flags", () => {
  const expected = Object.values(MTP_DEFINITIONS).flatMap((definition) => {
    const pine = readFileSync(new URL(`../reference/mtp/${definition.name}.pine`, import.meta.url), "utf8");
    return [...pine.matchAll(/sma\(src,\s*(\d+)\)/g)].map((match) => Number(match[1]));
  });
  assert.deepEqual([...MTP_COMBINED_PERIODS], expected);
  assert.equal(expected.length, 151);
  assert.equal(new Set(expected).size, expected.length);
  assert.deepEqual(activeMtpPeriods({ mtpAll: true, mtp160: true, mtp640: true }), expected);
  assert.equal(Math.min(...expected), 4);
  assert.equal(Math.max(...expected), 640);
});

test("combined SMA computes independent slice means, warmup and live updates", () => {
  const bars = Array.from({ length: 700 }, (_, i) => ({ close: 100 + Math.sin(i / 7) * 10 + i / 8 }));
  const model = new MtpModel();
  model.reset(bars, activeMtpPeriods({ mtpAll: true }));
  for (const period of MTP_COMBINED_PERIODS) {
    assert.equal(model.sma(period - 2, period), null);
    const expected = bars.slice(-period).reduce((sum, bar) => sum + bar.close, 0) / period;
    assert.ok(Math.abs(model.sma(699, period) - expected) < 1e-8);
  }
  bars[699] = { close: 42 };
  model.update(bars);
  assert.ok(Math.abs(model.sma(699, 640) - bars.slice(-640).reduce((s, b) => s + b.close, 0) / 640) < 1e-8);
});

test("one style applies to every combined line and legacy group styles remain independent", () => {
  const model = new MtpModel();
  model.reset(Array.from({ length: 650 }, (_, i) => ({ close: i + 100 })), MTP_COMBINED_PERIODS);
  model.styles = {
    mtpAll: { color: "#123456", width: 3, opacity: 0.4 },
    mtp160: { color: "#abcdef", width: 2, opacity: 0.9 }
  };
  const strokes = [];
  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { strokes.push([this.strokeStyle, this.lineWidth, this.globalAlpha]); }
  };
  model.styleKey = "mtpAll";
  model.draw(ctx, 640, 649, (i) => i, (price) => price);
  assert.equal(strokes.length, 151);
  assert.ok(strokes.every((style) => JSON.stringify(style) === JSON.stringify(["#123456", 3, 0.4])));
  strokes.length = 0;
  model.styleKey = undefined;
  model.draw(ctx, 640, 649, (i) => i, (price) => price);
  assert.deepEqual(strokes[0], ["#abcdef", 2, 0.9]);
  assert.ok(strokes.some(([color]) => color === "#1e90ff"));
});

test("combined toggle does not resurrect old groups, and separate toggle exits combined mode", async () => {
  const { toggleIndicatorFlags } = await pureModule("indicator-flags");
  const combined = toggleIndicatorFlags({ ...off, mtp160: true, mtp440: true }, "mtpAll");
  assert.deepEqual(combined, { ...off, mtpAll: true });
  assert.deepEqual(toggleIndicatorFlags(combined, "mtpAll"), { ...off, mtpAll: false });
  assert.deepEqual(toggleIndicatorFlags(combined, "mtp640"), { ...off, mtp160: true, mtp440: true, mtpAll: false });
  assert.equal(toggleIndicatorFlags(combined, "volume").mtpAll, true);
});

test("MTP master checkbox shows partial ranges and clears all individually selected ranges", async () => {
  const { toggleIndicatorFlags, mtpSelection } = await pureModule("indicator-flags");
  assert.deepEqual(mtpSelection({ ...off, mtp160: true }), { all: false, partial: true });
  const allParts = { ...off, mtp160: true, mtp440: true, mtp640: true };
  assert.deepEqual(mtpSelection(allParts), { all: true, partial: false });
  assert.deepEqual(toggleIndicatorFlags(allParts, "mtpAll"), { ...off, mtpAll: false });
  assert.deepEqual(mtpSelection(toggleIndicatorFlags(allParts, "mtp440")), { all: false, partial: true });
  assert.deepEqual(mtpSelection({ ...off, mtpAll: true }), { all: true, partial: false });
});

test("combined legend shows one MTP entry and backup roundtrip accepts optional new data", async () => {
  const { indicatorLegendKeys } = await pureModule("indicator-legend");
  assert.deepEqual(indicatorLegendKeys({}, { ...off, mtpAll: true }), ["volume", "mtpAll"]);
  assert.deepEqual(indicatorLegendKeys({}, off), ["volume"]);
  assert.deepEqual(indicatorLegendKeys({}, { ...off, mtp440: true }), [
    "volume", "mtp640", "mtp440", "mtp160"
  ]);
  assert.equal(indicatorLegendKeys({ removedIndicators: ["mtpAll"] }, { ...off, mtpAll: true }).includes("mtpAll"), false);
  const old = { application: "personal-terminal", schemaVersion: 1, layout: { indicators: off }, drawings: [], images: [] };
  assert.equal(validateBackup(old), old);
  const backup = { ...old, layout: {
    indicators: { ...off, mtpAll: true },
    chartSettings: { indicatorOptions: { mtpAll: { color: "#123456", width: 3, opacity: 0.4 } }, removedIndicators: ["mtp160"] }
  } };
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(backup))), backup);
  assert.throws(() => validateBackup({ ...backup, layout: { indicators: { mtpAll: "yes" } } }));
});
