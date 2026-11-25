import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}) {
  const require = createRequire(import.meta.url);
  const modules = new Map();
  function load(relative) {
    let file = path.resolve(root, relative).replace(/\.js$/, ".ts");
    if (!file.endsWith(".tsx") && !existsSync(file) && existsSync(file + "x")) file += "x";
    const key = path.relative(root, file).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(specifier => specifier.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(file), specifier))) : require(specifier), module, module.exports);
    return module.exports;
  }
  return load;
}
const load = sources(), { WelcomeModel } = load("model/welcome.ts"), { HistorySettingsModel, selectedHistory } = load("model/history-settings.ts");
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const stats = { bytes: 4800, bars: 100, blocks: 3, groups: [
  { uid: "one", timeframe: "1m", bytes: 2400, bars: 50, blocks: 1 },
  { uid: "one", timeframe: "1d", bytes: 1440, bars: 30, blocks: 1 },
  { uid: "two", timeframe: "1m", bytes: 960, bars: 20, blocks: 1 }
] };

test("actual welcome/account components render English, official links and compact sections without bank login", () => {
  const modules = sources({ "services/storage-db.ts": { get: async () => undefined, put: async () => {} } });
  const preferences = modules("i18n/preferences.ts"); preferences.setDisplayPreferences({ locale: "en" });
  const { TerminalContext } = modules("screens/terminal/context.tsx"), { WelcomeGate } = modules("screens/terminal/WelcomeDialog.tsx"), { AccountDialog } = modules("screens/terminal/AccountDialog.tsx");
  let state = { owner: "guest", dialog: "welcome", ready: true, authenticated: false, name: "", status: "offline", error: null, historyHelp: "", preferences: { locale: "en" }, rows: [] };
  const controller = { getSnapshot: () => state, subscribe: () => () => {}, sessionKey: () => null, getStorageStats: async () => ({ candles: stats, browser: {} }), clearHistory: async () => {} };
  const render = component => renderToStaticMarkup(React.createElement(TerminalContext, { value: controller }, React.createElement(component)));
  const welcome = render(WelcomeGate);
  for (const link of ["https://developer.tbank.ru/invest/intro/intro/token", "https://www.tbank.ru/invest/settings/", "https://github.com/twilingway/mtp-twiling", "./privacy.html"]) assert.ok(welcome.includes(link));
  assert.ok(welcome.includes("The installed app stores data on your device.")); assert.ok(welcome.includes("only on this device")); assert.ok(welcome.includes("personal Google Drive")); assert.ok(welcome.includes("welcome-do-not-show"));
  assert.equal(/[А-Яа-яЁё]/u.test(welcome), false);
  state = { ...state, dialog: "account" }; const account = render(AccountDialog);
  assert.ok(account.includes('id="account-section-drive" hidden=""'));
  assert.ok(account.includes('id="account-section-storage" hidden=""'));
  assert.ok(account.includes('id="account-section-transfer" hidden=""'));
  assert.ok(account.includes('id="open-welcome"')); assert.ok(account.includes('id="google-drive-connect"'));
  // The existing license attribution uses a Cyrillic copyright letter in both locales.
  assert.equal(/[А-Яа-яЁё]/u.test(account.replace("Copyright (с) 2025 TradingView, Inc.", "")), false);
});

test("welcome dismissal is device-level IDB data, works before bank login and reopens without losing preference", async () => {
  const preferences = new Map(), calls = [];
  const repository = sources({ "services/storage-db.ts": {
    async get(store, id) { calls.push(["get", store, id]); return preferences.get(id); },
    async put(store, record) { calls.push(["put", store, record]); preferences.set(record.id, record); }
  } })("services/welcome-preferences.ts");
  const first = new WelcomeModel({ load: repository.loadWelcomeHidden, save: repository.saveWelcomeHidden });
  await first.load(); assert.equal(first.getSnapshot().hidden, false); assert.equal(await first.finish(true), true);
  const reloaded = new WelcomeModel({ load: repository.loadWelcomeHidden, save: repository.saveWelcomeHidden });
  await reloaded.load(); assert.equal(reloaded.getSnapshot().hidden, true);
  assert.equal(await reloaded.finish(true), true, "manual reopening keeps the saved choice");
  assert.equal(calls.filter(call => call[0] === "put").length, 1);
  const record = [...preferences.values()][0]; assert.equal(record.owner, undefined); assert.equal(record.viewKey, undefined);
  assert.equal(await reloaded.finish(false), true); assert.equal(await repository.loadWelcomeHidden(), false);
  assert.ok(calls.every(call => call[1] === "preferences"));
});

test("welcome read/save failures are visible and never claim dismissal persisted", async () => {
  let failSave = true;
  const model = new WelcomeModel({ load: async () => { throw new Error("IDB unavailable"); }, save: async () => { if (failSave) throw new Error("quota"); } });
  await model.load(); assert.equal(model.getSnapshot().ready, true); assert.equal(model.getSnapshot().error, "load");
  assert.equal(await model.finish(false), true, "continuing without saving is possible");
  assert.equal(await model.finish(true), false); assert.equal(model.getSnapshot().hidden, false); assert.equal(model.getSnapshot().error, "save");
  failSave = false; assert.equal(await model.finish(true), true); assert.equal(model.getSnapshot().hidden, true);
});

test("corrupt welcome preference does not suppress the first-run information", async () => {
  const repository = sources({ "services/storage-db.ts": { get: async () => ({ value: { schemaVersion: 2, hidden: true } }) } })("services/welcome-preferences.ts");
  assert.equal(await repository.loadWelcomeHidden(), false);
});

function panelFixture() {
  let identity = { owner: "A", session: {} }, blocked = false;
  const hooks = {}, clears = [];
  const model = new HistorySettingsModel({ identity: () => identity, blocked: () => blocked,
    stats: async () => hooks.stats ? hooks.stats() : { candles: structuredClone(stats), browser: { usage: 10000, quota: 100000 } },
    clear: async (uid, timeframe) => { clears.push({ owner: identity.owner, uid, timeframe }); await hooks.clear?.(); }
  });
  return { model, clears, hooks, change(patch) { identity = { ...identity, ...patch }; }, block(value) { blocked = value; } };
}

test("history selection starts empty, calculates exact selected scope and requires confirmation", async () => {
  const f = panelFixture(); await f.model.refresh();
  f.model.requestClear(); await f.model.confirmClear(); assert.equal(f.clears.length, 0);
  assert.equal(selectedHistory(stats, { uid: "", timeframe: "all" }), null);
  f.model.select("one", "1d"); f.model.requestClear();
  assert.equal(f.model.getSnapshot().confirmation.bytes, 1440); assert.equal(f.model.getSnapshot().confirmation.bars, 30);
  await f.model.confirmClear(); assert.deepEqual(f.clears, [{ owner: "A", uid: "one", timeframe: "1d" }]);
  assert.equal(f.model.getSnapshot().confirmation, null);
});

test("selecting all is explicit and changing the selection cancels the old confirmation", async () => {
  const f = panelFixture(); await f.model.refresh(); f.model.select("all", "1m"); f.model.requestClear();
  assert.equal(f.model.getSnapshot().confirmation.bytes, 3360); assert.equal(f.model.getSnapshot().confirmation.groups.length, 2);
  f.model.select("two", "1m"); assert.equal(f.model.getSnapshot().confirmation, null); await f.model.confirmClear(); assert.equal(f.clears.length, 0);
  f.model.select("all", "all"); f.model.requestClear(); assert.equal(f.model.getSnapshot().confirmation.bars, 100);
  await f.model.confirmClear(); assert.deepEqual(f.clears[0], { owner: "A", uid: null, timeframe: null });
});

test("import/recovery barrier blocks deletion and normal statistics remain usable", async () => {
  const f = panelFixture(); await f.model.refresh(); f.model.select("one", "1m"); f.block(true); f.model.requestClear();
  assert.equal(f.model.getSnapshot().confirmation, null);
  f.block(false); f.model.requestClear(); f.block(true); await f.model.confirmClear(); assert.equal(f.clears.length, 0);
});

test("owner or bank session switch invalidates pending clear confirmation", async () => {
  for (const patch of [{ owner: "B" }, { session: {} }]) {
    const f = panelFixture(); await f.model.refresh(); f.model.select("one", "1m"); f.model.requestClear(); f.change(patch);
    await f.model.confirmClear(); assert.equal(f.clears.length, 0); assert.equal(f.model.getSnapshot().error, "changed");
    await f.model.refresh(); assert.deepEqual(f.model.getSnapshot().selection, { uid: "", timeframe: "" }); assert.equal(f.model.getSnapshot().confirmation, null);
  }
});

test("late statistics and in-flight clear cannot publish old data into a new owner", async () => {
  const f = panelFixture(), oldRead = deferred(); f.hooks.stats = () => oldRead.promise;
  const reading = f.model.refresh(); f.change({ owner: "B", session: {} });
  f.hooks.stats = async () => ({ candles: { ...stats, bytes: 999 }, browser: {} }); await f.model.refresh(); oldRead.resolve({ candles: stats, browser: {} }); await reading;
  assert.equal(f.model.getSnapshot().owner, "B"); assert.equal(f.model.getSnapshot().stats.candles.bytes, 999);
  const gate = deferred(); f.hooks.clear = () => gate.promise; f.model.select("one", "1m"); f.model.requestClear(); const clearing = f.model.confirmClear();
  f.change({ owner: "C", session: {} }); await f.model.refresh(); gate.resolve(); await clearing;
  assert.equal(f.model.getSnapshot().owner, "C"); assert.equal(f.model.getSnapshot().phase, "ready"); assert.equal(f.clears[0].owner, "B");
});

test("stats/clear failures expose retry without permitting an unconfirmed deletion", async () => {
  const f = panelFixture(); f.hooks.stats = async () => { throw new Error("read failed"); }; await f.model.refresh();
  assert.equal(f.model.getSnapshot().phase, "error"); f.model.select("all", "all"); f.model.requestClear(); await f.model.confirmClear(); assert.equal(f.clears.length, 0);
  f.hooks.stats = undefined; await f.model.refresh(); f.model.requestClear(); f.hooks.clear = async () => { throw new Error("transaction failed"); };
  await f.model.confirmClear(); assert.equal(f.model.getSnapshot().error, "clear"); assert.equal(f.model.getSnapshot().confirmation, null);
  f.hooks.clear = undefined; await f.model.refresh(); assert.equal(f.model.getSnapshot().phase, "ready");
});

function historyDatabase() {
  const stores = Object.fromEntries(["history", "coverage", "drawings", "images", "preferences", "vault"].map(name => [name, new Map()]));
  const cursor = (store, queue) => {
    const request = {}, records = [...store.values()]; let index = 0;
    const advance = () => { const record = records[index]; request.result = record ? { value: record, delete: () => store.delete(record.id), continue: () => { index++; queue(advance); } } : null; request.onsuccess(); };
    queue(advance); return request;
  };
  const database = { db: { transaction: name => ({ objectStore: () => ({ openCursor: () => cursor(stores[name], queueMicrotask) }) }) },
    get: async (name, id) => stores[name].get(id), track: value => value,
    transaction: async (names, action) => {
      assert.deepEqual(names, ["history", "coverage"]);
      const queue = [], copies = Object.fromEntries(names.map(name => [name, new Map(stores[name])]));
      action({ objectStore: name => ({ openCursor: () => cursor(copies[name], action => queue.push(action)) }) });
      while (queue.length) queue.shift()();
      for (const name of names) stores[name] = copies[name];
    }
  };
  for (const owner of ["A", "B"]) for (const uid of ["one", "two"]) for (const timeframe of ["1m", "1d"]) {
    const id = `${owner}:${uid}:${timeframe}:2026-11-25`, record = { id, owner, uid, timeframe, day: "2026-11-25", data: new ArrayBuffer(48 * 10) };
    stores.history.set(id, record); stores.coverage.set(id, { ...record, ranges: [] });
  }
  for (const name of ["drawings", "images", "preferences", "vault"]) stores[name].set("A", { id: "A", owner: "A", data: `${name}-must-stay` });
  return { stores, history: sources({ "services/storage-db.ts": database })("services/storage-history.ts") };
}

test("actual history storage deletes only selected owner/UID/timeframe and coverage, preserving drawings/images/settings/key", async () => {
  const f = historyDatabase(); assert.equal((await f.history.historyStats("A")).bars, 40);
  const removed = await f.history.clearHistory("A", { uid: "one", timeframe: "1m" });
  assert.equal(removed.blocks, 1); assert.equal(removed.bytes, 480); assert.equal((await f.history.historyStats("A")).bars, 30);
  assert.equal(f.stores.history.has("A:one:1d:2026-11-25"), true); assert.equal(f.stores.coverage.has("A:one:1m:2026-11-25"), false);
  assert.equal((await f.history.historyStats("B")).bars, 40);
  for (const name of ["drawings", "images", "preferences", "vault"]) assert.equal(f.stores[name].get("A").data, `${name}-must-stay`);
  await f.history.clearHistory("A", {}); assert.equal((await f.history.historyStats("A")).bars, 0); assert.equal((await f.history.historyStats("B")).bars, 40);
});
