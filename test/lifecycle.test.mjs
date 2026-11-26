import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Transpile the current production sources in memory. Only browser/network/DB
// boundaries are replaced; controller and helper implementations run unchanged.
function sourceModules(globals = {}, overrides = {}) {
  const context = vm.createContext({
    console,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    DOMException,
    Event,
    CustomEvent,
    EventTarget,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...globals
  });
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    const key = path.relative(sourceRoot, filename).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(filename)) return modules.get(filename).exports;
    assert.ok(!key.startsWith("../") && !path.isAbsolute(key), "source imports stay in src");
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: false
      }
    }).outputText;
    const execute = new vm.Script(`(function(require, module, exports) {\n${output}\n})`, {
      filename
    }).runInContext(context);
    execute(
      (specifier) => {
        assert.ok(specifier.startsWith("."), "unexpected external source dependency");
        return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)));
      },
      module,
      module.exports
    );
    return module.exports;
  }
  return { load };
}

const sampleBar = (timestamp = 1700000000000) => ({
  timestamp,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 3
});
const sampleRow = (name) => ({
  symbol: "GAZP",
  ticker: "GAZP",
  uid: `uid-${name}`,
  figi: null,
  name: "Gazprom",
  currency: "rub",
  color: "#008fc7",
  mark: "G",
  step: 0.01,
  price: null,
  previousClose: 10,
  availability: "pending"
});

test("portable mutation barrier blocks edits/recovery but allows exports and logout", async t => {
  let reloads = 0;
  const { controller, clients } = terminalFixture({ onLogout: () => { reloads++; } });
  t.after(() => controller.dispose()); await controller.start(); await controller.login(`t.${"b".repeat(40)}`, "B", false);
  for (const flag of ["importingBackup", "importRecoveryRequired"]) {
    controller.update({ [flag]: true }); const before = controller.getSnapshot().preferences;
    await controller.setPreferences({ locale: "en" }); await controller.setChartSettings({ theme: "light" }); await controller.toggleIndicator("ma");
    await controller.setDrawings([]); await controller.addInstrument({}); await controller.removeInstrument({ uid: "uid-B", symbol: "GAZP" });
    controller.setTool("segment");
    assert.equal(controller.getSnapshot().preferences, before); assert.equal(controller.getSnapshot().activeTool, null);
    controller.update({ [flag]: false });
  }
  controller.update({ backupBusy: true }); await controller.setPreferences({ locale: "en" });
  assert.equal(controller.getSnapshot().preferences.locale, "en");
  controller.update({ importingBackup: true }); const logout = controller.logout();
  assert.equal(controller.getSnapshot().authenticated, false, "logout signals Google abort synchronously");
  await logout; assert.equal(reloads, 0); assert.equal(clients[0].closed, true);
  assert.equal(controller.getSnapshot().owner, "public");
  assert.equal(controller.getSnapshot().marketReady, true);
});

test("settings handlers recheck import ownership after awaiting saveView", async t => {
  const { controller } = terminalFixture(); t.after(() => controller.dispose());
  await controller.start(); await controller.login(`t.${"b".repeat(40)}`, "B", false);
  for (const action of [() => controller.setPreferences({ locale: "en" }), () => controller.setChartSettings({ theme: "light" }), () => controller.toggleIndicator("ma")]) {
    const gate = deferred(), before = controller.getSnapshot().preferences;
    controller.saveView = () => gate.promise;
    const pending = action(); controller.update({ importingBackup: true }); gate.resolve(); await pending;
    assert.equal(controller.getSnapshot().preferences, before);
    controller.update({ importingBackup: false });
  }
});

test("native timeframe changes preserve history lookback, instrument UID and favorites", async (t) => {
  const { controller, modules } = terminalFixture();
  t.after(() => controller.dispose());
  await controller.start();
  await controller.login(`t.${"b".repeat(40)}`, "B", false);
  await controller.setPreferences({
    rangeDays: 180,
    favoriteIntervals: ["1m", "1M"],
    indicatorPaneLayout: { volume: { heightRatio: 0.35 } },
    chartSettings: { ...controller.getSnapshot().preferences.chartSettings, legendCollapsed: true }
  });
  const uid = controller.getSnapshot().preferences.instrumentUid;
  const ids = modules.load("model/intervals/native-timeframes.ts").NATIVE_TIMEFRAMES;
  for (const timeframe of ids) {
    await controller.setTimeframe(timeframe);
    const state = controller.getSnapshot();
    assert.equal(state.preferences.timeframe, timeframe);
    assert.equal(state.preferences.rangeDays, 180);
    assert.equal(state.preferences.indicatorPaneLayout.volume.heightRatio, 0.35);
    assert.equal(state.preferences.chartSettings.legendCollapsed, true);
    assert.equal(state.preferences.instrumentUid, uid);
    assert.deepEqual([...state.preferences.favoriteIntervals], ["1m", "1M"]);
  }
  await assert.rejects(controller.setTimeframe("3M"), { name: "RangeError" });
  assert.equal(controller.getSnapshot().preferences.timeframe, "1M");
});

test("latest asynchronous symbol selection wins and concurrent sidebar width does not cancel it", async (t) => {
  const { controller } = terminalFixture();
  t.after(() => controller.dispose());
  await controller.start();
  await controller.login(`t.${"b".repeat(40)}`, "B", false);
  const old = deferred();
  let saves = 0;
  controller.saveView = () => (++saves === 1 ? old.promise : Promise.resolve());
  const olderSelection = controller.setPreferences({ symbol: "SBER" });
  const latestSelection = controller.setPreferences({ symbol: "RTSI" });
  await controller.setPreferences({ sidebarWidth: 380 });
  old.resolve();
  await Promise.all([olderSelection, latestSelection]);
  assert.equal(controller.getSnapshot().preferences.symbol, "RTSI");
  assert.equal(controller.getSnapshot().preferences.sidebarWidth, 380);
  const delayed = deferred();
  let hold = true;
  controller.saveView = () => {
    if (hold) {
      hold = false;
      return delayed.promise;
    }
    return Promise.resolve();
  };
  const newest = controller.setPreferences({ symbol: "SBER" });
  await controller.setPreferences({ sidebarWidth: 400 });
  delayed.resolve();
  await newest;
  assert.equal(controller.getSnapshot().preferences.symbol, "SBER");
  assert.equal(controller.getSnapshot().preferences.sidebarWidth, 400);
});

test("indicator preference writes revalidate after await when the same owner imports, revision changes, adapter retires or owner changes", async (t) => {
  for (const mode of ["import", "revision", "retired", "owner"]) {
    const { controller, modules } = terminalFixture();
    t.after(() => controller.dispose());
    await controller.start();
    await controller.login(`t.${"b".repeat(40)}`, "B", false);
    const pending = deferred(),
      entered = deferred(),
      initial = controller.getSnapshot();
    const adapter = { retired: false };
    controller.chart = adapter;
    controller.saveView = () => {
      entered.resolve();
      return pending.promise;
    };
    const valid = () => {
      const state = controller.getSnapshot();
      return (
        state.owner === initial.owner &&
        state.chartRevision === initial.chartRevision &&
        !state.importingBackup &&
        !state.backupBusy &&
        !state.importRecoveryRequired &&
        !adapter.retired
      );
    };
    const save = modules.load(
      "screens/terminal/indicator-preferences.ts"
    ).persistIndicatorPaneLayout;
    const writing = save(controller, { volume: { heightRatio: 0.6 } }, valid);
    await entered.promise;
    if (mode === "import") controller.update({ importingBackup: true, backupBusy: true });
    if (mode === "revision") controller.update({ chartRevision: initial.chartRevision + 1 });
    if (mode === "retired") adapter.retired = true;
    if (mode === "owner") controller.update({ owner: "another-owner" });
    pending.resolve();
    await writing;
    assert.equal(controller.getSnapshot().preferences.indicatorPaneLayout, undefined, mode);
    controller.chart = null;
  }
});
test("delayed legend collapse cannot overwrite newer chart settings or imported settings", async (t) => {
  const { controller, modules } = terminalFixture();
  t.after(() => controller.dispose());
  await controller.start();
  await controller.login(`t.${"b".repeat(40)}`, "B", false);
  const pending = deferred(),
    entered = deferred();
  controller.saveView = () => {
    entered.resolve();
    return pending.promise;
  };
  const save = modules.load("screens/terminal/indicator-preferences.ts").persistLegendCollapsed;
  const writing = save(controller, true);
  await entered.promise;
  const current = controller.getSnapshot();
  controller.update({
    preferences: {
      ...current.preferences,
      chartSettings: { ...current.preferences.chartSettings, upColor: "#123456" }
    }
  });
  pending.resolve();
  await writing;
  assert.equal(controller.getSnapshot().preferences.chartSettings.upColor, "#123456");
  assert.equal(controller.getSnapshot().preferences.chartSettings.legendCollapsed, undefined);
});

test("saveView rejects an adapter from another route, owner, or replaced UID before capturing it", async (t) => {
  const { controller } = terminalFixture();
  t.after(() => controller.dispose());
  await controller.start();
  await controller.login(`t.${"b".repeat(40)}`, "B", false);
  const state = controller.getSnapshot(),
    p = state.preferences,
    source = {
      owner: state.owner,
      viewKey: `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`,
      uid: state.rows.find((row) => row.symbol === p.symbol).uid
    };
  let captures = 0;
  controller.chart = {
    source,
    getView: () => {
      captures++;
      return null;
    }
  };
  await controller.saveView();
  assert.equal(captures, 1);
  for (const stale of [
    { ...source, owner: "other-owner" },
    { ...source, viewKey: `RTSI:${p.timeframe}:${p.engine}:${p.rangeDays}` },
    { ...source, uid: "old-uid" }
  ]) {
    controller.chart.source = stale;
    await controller.saveView();
  }
  assert.equal(captures, 1, "stale adapters must not contribute a view to the new selected route");
  controller.chart.source = source;
  controller.chart.persistView = false;
  await controller.saveView();
  assert.equal(captures, 1, "retired import adapters must not capture a view");
  controller.chart = null;
});

test("live candles follow the selected UID when another row has the same symbol", async (t) => {
  const { controller, clients, modules } = terminalFixture();
  t.after(() => controller.dispose());
  await controller.start();
  await controller.login(`t.${"b".repeat(40)}`, "B", false);
  const client = clients[0];
  client.rows.push(sampleRow("other"));
  client.dispatchEvent(new CustomEvent("state", { detail: client.snapshot() }));
  await controller.setPreferences({ symbol: "GAZP", instrumentUid: "uid-other" });
  const interval = modules.load("model/history-codec.ts").TIMEFRAMES["1d"].stream;
  const original = controller.getSnapshot().candles;
  const bar = { ...sampleBar(), close: 99, high: 99 };
  client.dispatchEvent(new CustomEvent("candle", { detail: { uid: "uid-B", interval, bar } }));
  assert.equal(controller.getSnapshot().candles, original);
  client.dispatchEvent(new CustomEvent("candle", { detail: { uid: "uid-other", interval, bar } }));
  assert.equal(controller.getSnapshot().candles.at(-1).close, 99);
  assert.equal(controller.getSnapshot().preferences.instrumentUid, "uid-other");
});

function terminalFixture({ restore = async () => null, candles, importBackup, onLogout } = {}) {
  const clients = [],
    savedSessions = [];
  const storage = {
    PUBLIC_OWNER: "public",
        adoptLegacyGuestWorkspace: async () => "source-empty",
    prepareProfileV2: async () => {},
    copyPublicProfile: async () => ({ conflict: false, count: 0 }),
    loadWatchlist: async () => undefined,
    migrateLegacy: async () => {},
    lastProfile: async () => undefined,
    restoreSession: restore,
    loadPreferences: async () => ({}),
    loadMarket: async () => undefined,
    loadDrawings: async () => [],
    loadImages: async () => [],
    loadView: async () => undefined,
    savePreferences: async () => {},
    saveView: async () => {},
    flush: async () => {},
    clearSession: async () => {},
    saveSession: async (session) => {
      savedSessions.push(session);
    },
    importBackup: (...args) => importBackup(...args)
  };
  class BankBoundary extends EventTarget {
    constructor(token, name) {
      super();
      this.name = name;
      this.owner = token ? `owner-${name}` : "public";
      this.rows = token ? [sampleRow(name)] : [];
      this.authenticated = Boolean(token);
      this.closed = false;
      if (token) clients.push(this);
    }
    snapshot() {
      return {
        authenticated: this.authenticated,
        marketReady: true,
        rows: this.rows,
        status: "connected",
        error: null,
        accountName: this.name,
        profileKey: this.owner,
        updatedAt: null,
        transport: "websocket"
      };
    }
    async start() {
      return this.snapshot();
    }
    async prepareOwner() { return this.owner; }
    candles(symbol, timeframe, range, options) {
      return candles
        ? candles(symbol, timeframe, range, options)
        : Promise.resolve({
            symbol,
            ticker: symbol,
            timeframe,
            candles: [sampleBar()],
            cached: true,
            requests: 0,
            source: "cache"
          });
    }
    async flush() {}
    async close() {
      this.closed = true;
    }
    connect() {}
  }
  const modules = sourceModules(
    {
      window: new EventTarget(),
      navigator: { onLine: true },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      location: { reload: () => onLogout ? onLogout() : assert.fail("unexpected reload") }
    },
    {
      "services/storage.ts": storage,
      "services/chart-camera.ts": {
        loadChartView: async () => undefined,
        saveChartView: storage.saveView,
        resetSharedChartCamera: async () => {}
      },
      "services/tbank-client.ts": { TBankClient: BankBoundary },
      "services/market-client.ts": { MarketClient: BankBoundary }
    }
  );
  const { TerminalController } = modules.load("screens/terminal/controller.ts");
  return { controller: new TerminalController(), clients, savedSessions, modules };
}

test("manual login wins over an older delayed remembered-session restore", async (t) => {
  const enteredRestore = deferred(),
    remembered = deferred();
  const { controller, clients, savedSessions } = terminalFixture({
    restore: () => {
      enteredRestore.resolve();
      return remembered.promise;
    }
  });
  t.after(() => controller.dispose());
  const bootstrap = controller.start();
  await enteredRestore.promise;

  await controller.login(`t.${"b".repeat(40)}`, "B", false);
  assert.equal(controller.getSnapshot().owner, "owner-B");
  assert.equal(controller.getSnapshot().ready, true);

  remembered.resolve({ token: `t.${"a".repeat(40)}`, owner: "owner-A", name: "A" });
  await bootstrap;
  assert.equal(controller.getSnapshot().owner, "owner-B");
  assert.equal(controller.getSnapshot().name, "B");
  assert.equal(clients.length, 1, "the stale restore must not activate another client");
  assert.equal(clients[0].name, "B");
  assert.equal(clients[0].closed, false);
  assert.equal(savedSessions.length, 1);
  assert.equal(savedSessions[0].owner, "owner-B");
});

test("an invalid backup leaves the current history request alive and able to finish", async (t) => {
  const pendingHistory = deferred(),
    enteredHistory = deferred();
  let holdHistory = false,
    historySignal,
    validateBackup,
    validationCalls = 0;
  const { controller, modules } = terminalFixture({
    candles: (symbol, timeframe, _range, options) => {
      if (holdHistory) {
        historySignal = options.signal;
        enteredHistory.resolve();
        return pendingHistory.promise;
      }
      return Promise.resolve({
        symbol,
        ticker: symbol,
        timeframe,
        candles: [sampleBar()],
        cached: true,
        requests: 0,
        source: "cache"
      });
    },
    importBackup: async (_owner, input) => {
      validationCalls++;
      return validateBackup(input);
    }
  });
  ({ validateBackup } = modules.load("model/backup-format.ts"));
  t.after(() => controller.dispose());
  await controller.start();
  await controller.login(`t.${"b".repeat(40)}`, "B", false);
  holdHistory = true;
  const loading = controller.loadHistory();
  await enteredHistory.promise;
  assert.equal(controller.getSnapshot().loading, true);

  await assert.rejects(controller.importBackup({ application: "unsupported", schemaVersion: 1 }));
  assert.equal(validationCalls, 0, "invalid input must fail before the storage import boundary");
  assert.equal(historySignal.aborted, false, "validation failure must not cancel active history");
  assert.equal(controller.getSnapshot().loading, true);

  pendingHistory.resolve({
    symbol: "GAZP",
    ticker: "GAZP",
    timeframe: "1d",
    candles: [sampleBar(), sampleBar(1700086400000)],
    cached: false,
    requests: 1,
    source: "bank boundary"
  });
  await loading;
  assert.equal(controller.getSnapshot().loading, false);
  assert.equal(controller.getSnapshot().candles.length, 2);
  assert.equal(controller.getSnapshot().candles[1].timestamp, 1700086400000);
  assert.equal(controller.getSnapshot().owner, "owner-B");
});

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    if (options?.signal?.aborted) return;
    super.addEventListener(type, listener, options);
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    options?.signal?.addEventListener("abort", () => listeners.delete(listener), { once: true });
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(type)?.delete(listener);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

function pwaElements() {
  class Element extends TrackedTarget {
    dataset = {};
    hidden = true;
    disabled = false;
    textContent = "";
  }
  class Button extends Element {}
  const install = new Button();
  install.hidden = false;
  const nodes = new Map([
    ["app-version", new Element()],
    ["update-banner", new Element()],
    ["install-actions", new Element()],
    ["install-app", install],
    ["update-now", new Button()],
    ["update-later", new Button()]
  ]);
  const window = new TrackedTarget(),
    document = new TrackedTarget();
  window.isSecureContext = true;
  document.baseURI = "https://example.test/quotes/";
  document.hidden = false;
  document.getElementById = (id) => nodes.get(id);
  return { nodes, window, document, Element, Button };
}

test("browser shell advertises an installable web app", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<link\b[^>]*\brel="manifest"[^>]*\bhref="\.\/manifest\.webmanifest"/);
  const manifest = JSON.parse(
    readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")
  );
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
});

test("browser shell offers updates after saving", async (t) => {
  const { nodes, window, document, Element, Button } = pwaElements();
  const serviceWorker = new TrackedTarget(),
    registration = new TrackedTarget(),
    banner = nodes.get("update-banner"),
    update = nodes.get("update-now"),
    pendingSave = deferred(),
    calls = [],
    notices = [];
  let saveAttempts = 0;
  serviceWorker.controller = {};
  serviceWorker.register = async () => registration;
  registration.waiting = {
    postMessage: (message) => calls.push(message.type)
  };
  const { setupPwa } = sourceModules(
    {
      HTMLElement: Element,
      HTMLButtonElement: Button,
      window,
      document,
      navigator: { serviceWorker },
      location: { reload: () => calls.push("reload") },
      setInterval: () => 1,
      clearInterval: () => {}
    },
    { "generated/app-version.ts": { APP_VERSION: "source-only", BUILD_ID: "source-only" } }
  ).load("services/pwa.ts");
  const dispose = await setupPwa({
    notify: (notice) => notices.push(notice),
    flush: async () => {
      calls.push("save");
      if (++saveAttempts === 1) throw new Error("Save failed");
      await pendingSave.promise;
    }
  });
  t.after(dispose);
  assert.deepEqual(calls, []);
  assert.deepEqual(notices, []);
  assert.equal(banner.hidden, false);

  update.dispatchEvent(new Event("click"));
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["save"]);
  assert.deepEqual(notices, ["Не удалось завершить сохранение. Обновление отложено."]);
  assert.equal(update.disabled, false);
  assert.equal(banner.hidden, false);

  update.dispatchEvent(new Event("click"));
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  assert.deepEqual(calls, ["save", "save"]);
  assert.equal(update.disabled, true);
  pendingSave.resolve();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["save", "save", "ACTIVATE_UPDATE"]);
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  assert.deepEqual(calls, ["save", "save", "ACTIVATE_UPDATE", "reload"]);
});

test("PWA installation consumes one prompt, shows a replacement and clears the actions on dispose", async (t) => {
  const { nodes, window, document, Element, Button } = pwaElements();
  const actions = nodes.get("install-actions"),
    install = nodes.get("install-app"),
    serviceWorker = new TrackedTarget(),
    calls = [],
    notices = [];
  serviceWorker.register = async () => new TrackedTarget();
  const { setupPwa } = sourceModules(
    {
      HTMLElement: Element,
      HTMLButtonElement: Button,
      window,
      document,
      navigator: { serviceWorker },
      setInterval: () => 1,
      clearInterval: () => {}
    },
    { "generated/app-version.ts": { APP_VERSION: "source-only", BUILD_ID: "source-only" } }
  ).load("services/pwa.ts");
  const dispose = await setupPwa({
    notify: (notice) => notices.push(notice),
    flush: async () => {}
  });
  t.after(dispose);
  const capturePrompt = (name) => {
    const choice = deferred();
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => calls.push(name),
      userChoice: choice.promise
    });
    assert.equal(window.dispatchEvent(event), false);
    return choice;
  };
  const click = () => install.dispatchEvent(new Event("click"));

  assert.equal(actions.hidden, true);
  const first = capturePrompt("first");
  assert.equal(actions.hidden, false);
  click();
  click();
  assert.equal(actions.hidden, true);
  assert.equal(install.hidden, false);
  assert.deepEqual(calls, ["first"]);
  first.resolve({ outcome: "dismissed" });
  await new Promise(setImmediate);
  assert.equal(actions.hidden, true);
  assert.deepEqual(notices, []);

  const second = capturePrompt("second");
  click();
  const fresh = capturePrompt("fresh");
  assert.equal(actions.hidden, true);
  click();
  assert.deepEqual(calls, ["first", "second"]);
  second.resolve({ outcome: "dismissed" });
  await new Promise(setImmediate);
  assert.equal(actions.hidden, false);
  click();
  assert.deepEqual(calls, ["first", "second", "fresh"]);
  window.dispatchEvent(new Event("appinstalled"));
  fresh.resolve({ outcome: "accepted" });
  await new Promise(setImmediate);
  assert.equal(actions.hidden, true);
  assert.deepEqual(notices, ["Приложение установлено."]);

  capturePrompt("before disposal");
  assert.equal(actions.hidden, false);
  dispose();
  assert.equal(actions.hidden, true);
  assert.equal(window.listenerCount, 0);
  click();
  window.dispatchEvent(new Event("appinstalled"));
  assert.deepEqual(calls, ["first", "second", "fresh"]);
  assert.deepEqual(notices, ["Приложение установлено."]);
});

test("aborting PWA setup during registration removes listeners and prevents late checks", async () => {
  const { nodes, window, document, Element, Button } = pwaElements();
  const pendingRegistration = deferred(),
    serviceWorker = new TrackedTarget();
  let registerCalls = 0,
    updateCalls = 0,
    fetchCalls = 0,
    flushCalls = 0;
  let reloadCalls = 0,
    intervalCalls = 0,
    activationCalls = 0;
  const notices = [];
  serviceWorker.controller = {};
  serviceWorker.register = (url, options) => {
    registerCalls++;
    assert.equal(url.href, "https://example.test/quotes/service-worker.js");
    assert.equal(options.scope, "/quotes/");
    return pendingRegistration.promise;
  };
  const registration = new TrackedTarget();
  registration.waiting = {
    postMessage: () => {
      activationCalls++;
    }
  };
  registration.installing = null;
  registration.update = async () => {
    updateCalls++;
  };
  const modules = sourceModules({
    HTMLElement: Element,
    HTMLButtonElement: Button,
    window,
    document,
    navigator: { serviceWorker, onLine: true },
    fetch: async () => {
      fetchCalls++;
    },
    location: {
      reload: () => {
        reloadCalls++;
      }
    },
    setInterval: () => {
      intervalCalls++;
      return 1;
    },
    clearInterval: () => {}
  }, { "generated/app-version.ts": { APP_VERSION: "source-only", BUILD_ID: "source-only" } });
  const { setupPwa } = modules.load("services/pwa.ts");
  const parent = new AbortController();
  const setup = setupPwa({
    signal: parent.signal,
    notify: (notice) => notices.push(notice),
    flush: async () => {
      flushCalls++;
    }
  });
  assert.equal(registerCalls, 1);
  assert.equal(window.listenerCount, 2);
  assert.equal(nodes.get("update-now").listenerCount, 1);
  parent.abort();
  assert.equal(window.listenerCount, 0);
  assert.equal(
    [...nodes.values()].reduce((total, node) => total + node.listenerCount, 0),
    0
  );

  pendingRegistration.resolve(registration);
  const dispose = await setup;
  assert.equal(document.listenerCount, 0);
  assert.equal(serviceWorker.listenerCount, 0);
  assert.equal(registration.listenerCount, 0);
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("appinstalled"));
  nodes.get("update-now").dispatchEvent(new Event("click"));
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  await Promise.resolve();
  assert.equal(updateCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(intervalCalls, 0);
  assert.equal(flushCalls, 0);
  assert.equal(activationCalls, 0);
  assert.equal(reloadCalls, 0);
  assert.equal(notices.length, 0);
  dispose();
});
