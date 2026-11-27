import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
    const key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      specifier => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module, module.exports
    );
    return module.exports;
  }
  return load;
}
const load = sources();
const { validateBackup } = load("model/backup-format.ts");
const { sanitizeDriveBackup } = load("services/drive/backup.ts");
const { isInstrumentSymbol } = load("model/instrument-symbol.ts");
const { watchlistFlagKey, isWatchlistFlagKey } = load("model/watchlist-flags.ts");
const { parseChartViewKey } = load("charts/view-camera.ts");
const { encodeDrawingClipboard, parseObjectClipboard } = load("model/drawing-editing.ts");
const fx = { uid: "00000000-0000-4000-8000-000000000001", symbol: "EUR/USD", ticker: "EUR/USD", name: "Euro / US Dollar" };
const drawing = { id: "fx-line", name: "horizontalStraightLine", points: [{ timestamp: 1700000000, value: 1.05 }] };
function backup() {
  return { application: "personal-terminal", schemaVersion: 1,
    layout: { symbol: fx.symbol, instrumentUid: fx.uid, watchlistFlags: { [`uid:${fx.uid}`]: "green", "legacy:EUR/USD": "blue" } },
    watchlist: [fx], drawings: [{ symbol: fx.symbol, items: [drawing] }],
    images: [{ id: "fx-image", symbol: fx.symbol, type: "image/png", data: btoa("fixture"), width: 100, point: { timestamp: 1700000000, value: 1.05 } }],
    views: [{ key: "EUR/USD:1d:kline:365", value: { camera: { barSpace: 8, rightOffsetBars: 5 } } }]
  };
}

test("FX symbols survive JSON and Drive backups, drawings, images, views and flags unchanged", () => {
  const data = JSON.parse(JSON.stringify(backup()));
  assert.deepEqual(validateBackup(data), data);
  assert.deepEqual(sanitizeDriveBackup(data), data);
  assert.equal(watchlistFlagKey(fx), `uid:${fx.uid}`);
  assert.equal(watchlistFlagKey({ ...fx, uid: null }), "legacy:EUR/USD");
  assert.equal(isWatchlistFlagKey("uid:EUR/USD"), false);
  assert.equal(parseChartViewKey(data.views[0].key).symbol, fx.symbol);
  const clipboard = encodeDrawingClipboard(drawing, "fixture", { symbol: fx.symbol, points: [{ x: 10, y: 20 }] });
  assert.equal(parseObjectClipboard(clipboard).placement.symbol, fx.symbol);
  for (const symbol of ["T", "BR-12.26", "USD000UTSTOM", "EUR_RUB__TOM", "SPX.P", "SiZ6", "EUR/USD", "IMOEX!", "Газпром", "A+B@C:D", "BAS@DE", "AZN LN", "Aqua Metals", "RXN_old", "LCOc1", "HOODperpA", "A".repeat(100)]) {
    assert.equal(isInstrumentSymbol(symbol), true, symbol);
    const roundtrip = backup();
    roundtrip.layout.symbol = symbol;
    roundtrip.layout.watchlistFlags = { [`legacy:${symbol}`]: "blue" };
    roundtrip.watchlist = [{ ...fx, symbol, ticker: symbol }];
    roundtrip.drawings[0].symbol = symbol;
    roundtrip.images[0].symbol = symbol;
    roundtrip.views[0].key = `${symbol}:1d:kline:365`;
    assert.deepEqual(sanitizeDriveBackup(validateBackup(JSON.parse(JSON.stringify(roundtrip)))), roundtrip);
    assert.equal(parseChartViewKey(roundtrip.views[0].key).symbol, symbol);
  }
  for (const symbol of ["/EUR", "EUR/", "EUR//USD", "../EUR", "EUR/../USD", "EUR\\USD", " EUR", "EUR ", "EUR\nUSD", "EUR\u0000USD", "EUR\u202eUSD", "A".repeat(101)]) {
    assert.equal(isInstrumentSymbol(symbol), false, symbol);
    const bad = backup(); bad.watchlist[0] = { ...fx, symbol };
    assert.throws(() => validateBackup(bad));
    assert.throws(() => sanitizeDriveBackup(bad));
    const badView = backup(); badView.views[0].key = `${symbol}:1d:kline:365`;
    assert.throws(() => validateBackup(badView));
    assert.equal(parseChartViewKey(badView.views[0].key), null);
  }
});

function terminalFixture(t) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const events = [], drive = {
    resume() { events.push("resume"); }, profileChanged() { events.push("profile"); },
    localChanged() { events.push("local"); }, localIntent() {}, suspend() { events.push("suspend"); },
    getSnapshot: () => ({ automatic: false }), async sync() {}
  };
  const candles = [], saved = [];
  const localLoad = sources({
    "services/storage.ts": { async savePreferences(owner, value) { saved.push({ owner, value }); }, async loadDrawings() { return []; }, async loadImages() { return []; } },
    "services/chart-camera.ts": { async loadChartView() {} },
    "services/drive/local.ts": { async loadDriveRecord() {}, async saveDriveRecord() {} },
    "services/drive/coordinator.ts": { DriveCoordinator: class { constructor() { return drive; } } },
    "services/storage-db.ts": {
      db: { transaction() { assert.fail("The controller fixture provides its own storage."); } }
    }
  });
  const { TerminalController } = localLoad("screens/terminal/controller.ts");
  const { startTerminalDrive } = localLoad("screens/terminal/controller-drive.ts");
  const controller = new TerminalController();
  const client = { async addInstrument() { return fx; }, snapshot: () => ({ rows: [fx], authenticated: true, marketReady: true, status: "online" }),
    async candles(symbol, timeframe, range, options) { candles.push({ symbol, timeframe, uid: options.uid }); return { candles: [{ timestamp: range.to, open: 1, high: 1, low: 1, close: 1, volume: 1 }], requests: 1 }; },
    async close() {} };
  controller.session.client = client;
  controller.update({ owner: "fixture-owner", authenticated: true });
  const stop = startTerminalDrive(controller);
  t.after(() => { stop(); controller.dispose(); globalThis.window = oldWindow; globalThis.document = oldDocument; });
  return { controller, drive, events, candles, saved };
}

test("real controller with Drive observer adds EUR/USD and continues history, preferences and account updates", async t => {
  const f = terminalFixture(t);
  await f.controller.addInstrument(fx);
  assert.equal(f.controller.getSnapshot().preferences.symbol, fx.symbol);
  assert.equal(f.controller.getSnapshot().preferences.instrumentUid, fx.uid);
  assert.equal(f.controller.getSnapshot().rows[0].symbol, fx.symbol);
  assert.equal(f.candles.length, 1);
  assert.equal(f.candles[0].uid, fx.uid);
  await f.controller.setPreferences({ timeframe: "1d" }, true);
  assert.equal(f.candles.length, 2);
  assert.ok(f.saved.length >= 2);
  f.controller.setDialog("account");
  f.controller.notify("account remains usable");
  assert.equal(f.controller.getSnapshot().dialog, "account");
  assert.equal(f.controller.getSnapshot().toast, "account remains usable");
  assert.equal(f.events.includes("suspend"), false);
});

test("corrupt optional portable state pauses once and never interrupts controller listeners or history", async t => {
  const f = terminalFixture(t);
  let updates = 0;
  f.controller.subscribe(() => { updates++; });
  f.controller.update({ rows: [{ ...fx, symbol: "CORRUPT\u0000SYMBOL" }] });
  assert.equal(f.events.filter(x => x === "suspend").length, 1);
  await new Promise(setImmediate);
  assert.match(f.controller.getSnapshot().toast, /Google/);
  const priorEvents = f.events.length;
  f.controller.setDialog("account");
  f.controller.notify("still usable");
  await f.controller.addInstrument(fx);
  assert.equal(f.candles.length, 1);
  assert.equal(f.events.length, priorEvents);
  assert.ok(updates >= 5);
  assert.equal(f.controller.getSnapshot().preferences.symbol, fx.symbol);
});

test("a queued optional failure warning cannot leak into another owner session", async t => {
  const f = terminalFixture(t);
  f.controller.update({ rows: [{ ...fx, symbol: "INVALID\u0000SYMBOL" }] });
  f.controller.update({ owner: "second-owner", rows: [] });
  await new Promise(setImmediate);
  assert.equal(f.controller.getSnapshot().toast, "");
  assert.equal(f.events.filter(x => x === "suspend").length, 1);
  assert.ok(f.events.filter(x => x === "profile").length >= 2);
});

test("reentrant failing Drive status observer cannot recurse through terminal notifications", async t => {
  const f = terminalFixture(t);
  let calls = 0;
  f.drive.localChanged = () => {
    calls++;
    f.controller.notify("nested optional status");
    throw new Error("optional status subscriber failed");
  };
  await f.controller.addInstrument(fx);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(f.candles.length, 1);
  f.controller.setDialog("account");
  assert.equal(f.controller.getSnapshot().dialog, "account");
  assert.equal(f.events.filter(x => x === "suspend").length, 1);
});
