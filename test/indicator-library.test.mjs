import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function modules(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    relative = relative.replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    if (relative === "react") return react;
    if (relative === "react/jsx-runtime") return jsx;
    const candidate = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      file = existsSync(candidate) ? candidate : candidate + "x";
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, {
      filename: file
    }).runInThisContext()(
      (specifier) =>
        specifier.startsWith(".")
          ? load(path.relative(root, path.resolve(path.dirname(file), specifier)))
          : load(specifier),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
const model = modules()("model/indicator-library.js");
const entries = Object.freeze([
  Object.freeze({
    id: "mtpAll",
    label: "MTP 0–640",
    aliases: ["МТП", "all"],
    category: "scripts",
    available: true
  }),
  Object.freeze({ id: "mtp160", label: "MTP 0–160", category: "scripts", available: true }),
  Object.freeze({
    id: "rsi",
    label: "Relative Strength Index",
    aliases: ["RSI", "Индекс силы"],
    category: "technicals",
    available: false,
    reason: "Расчёт недоступен"
  }),
  Object.freeze({
    id: "sma",
    label: "Simple Moving Average",
    aliases: ["SMA", "Скользящая средняя"],
    category: "technicals",
    available: true
  }),
  Object.freeze({
    id: "ema",
    label: "Exponential Moving Average",
    aliases: ["EMA"],
    description: "Not searchable metadata",
    category: "technicals",
    available: true
  })
]);

test("library search matches case-insensitive label/alias substrings within its section without mutation", () => {
  const before = JSON.stringify(entries),
    find = (category, query) =>
      model.filterIndicatorLibrary(entries, category, query).map((entry) => entry.id);
  assert.deepEqual(find("scripts", "  мтп  "), ["mtpAll"]);
  assert.deepEqual(find("scripts", "MTP"), ["mtpAll", "mtp160"]);
  assert.deepEqual(find("technicals", "moving"), ["sma", "ema"]);
  assert.deepEqual(find("technicals", "rSi"), ["rsi"]);
  assert.deepEqual(find("technicals", "ＲＳＩ"), ["rsi"]);
  assert.deepEqual(find("technicals", "средняя"), ["sma"]);
  assert.deepEqual(find("scripts", "rsi"), []);
  assert.deepEqual(find("technicals", "not searchable"), []);
  assert.deepEqual(find("scripts", ""), ["mtpAll", "mtp160"]);
  assert.equal(JSON.stringify(entries), before);
});

test("adding is enable-only, repeated active requests keep the same ID, unavailable entries never invoke caller", () => {
  const added = [];
  assert.equal(
    model.addIndicatorLibraryEntry(entries[0], (id) => added.push(id)),
    true
  );
  assert.equal(
    model.addIndicatorLibraryEntry(entries[0], (id) => added.push(id)),
    true
  );
  assert.equal(
    model.addIndicatorLibraryEntry(entries[2], (id) => added.push(id)),
    false
  );
  assert.deepEqual(added, ["mtpAll", "mtpAll"]);
});

function walk(node, predicate, result = []) {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, predicate, result));
    return result;
  }
  if (predicate(node)) result.push(node);
  walk(node.props?.children, predicate, result);
  return result;
}
function harness() {
  const state = ["scripts", ""],
    refs = [{ current: null }, { current: null }];
  let stateIndex = 0,
    refIndex = 0;
  const added = [],
    closes = [],
    hooks = {
      ...react,
      useState: (initial) => {
        const index = stateIndex++;
        return [
          state[index] ?? initial,
          (value) => {
            state[index] = value;
          }
        ];
      },
      useRef: () => refs[refIndex++],
      useEffect: () => {}
    };
  const { IndicatorLibraryDialog } = modules({ react: hooks })(
    "screens/terminal/IndicatorLibraryDialog.js"
  );
  const render = (locale = "ru") => {
    stateIndex = 0;
    refIndex = 0;
    return IndicatorLibraryDialog({
      entries,
      activeIds: new Set(["mtpAll"]),
      locale,
      onAdd: (id) => added.push(id),
      onClose: () => closes.push(true)
    });
  };
  return { render, refs, added, closes };
}

test("dialog has exactly two sections; section switch/search keeps disabled reason and prevents disabled selection", () => {
  const h = harness();
  let tree = h.render();
  const sections = walk(tree, (node) => node.type === "nav")[0];
  assert.equal(walk(sections, (node) => node.type === "button").length, 2);
  const scriptButtons = walk(tree, (node) => node.props?.["data-indicator-id"]);
  scriptButtons[0].props.onClick();
  scriptButtons[0].props.onClick();
  assert.deepEqual(h.added, ["mtpAll", "mtpAll"]);
  walk(sections, (node) => node.type === "button")[1].props.onClick();
  tree = h.render();
  const rsi = walk(tree, (node) => node.props?.["data-indicator-id"] === "rsi")[0];
  assert.equal(rsi.props.disabled, true);
  assert.ok(rsi.props["aria-describedby"]);
  rsi.props.onClick();
  assert.deepEqual(h.added, ["mtpAll", "mtpAll"]);
  const search = walk(tree, (node) => node.type === "input")[0];
  search.props.onChange({ target: { value: "sma" } });
  assert.deepEqual(
    walk(h.render(), (node) => node.props?.["data-indicator-id"]).map(
      (node) => node.props["data-indicator-id"]
    ),
    ["sma"]
  );
  search.props.onChange({ target: { value: "no matches" } });
  assert.equal(walk(h.render(), (node) => node.props?.role === "status").length, 1);
});

test("search ArrowDown targets enabled results; list navigation wraps and Escape routes once to onClose", () => {
  const h = harness(),
    tree = h.render(),
    focused = [];
  const buttons = [0, 1].map((index) => ({ focus: () => focused.push(index) }));
  h.refs[1].current = {
    querySelectorAll: (selector) => {
      assert.match(selector, /:not\(:disabled\)/);
      return buttons;
    }
  };
  let prevented = 0,
    stopped = 0;
  const search = walk(tree, (node) => node.type === "input")[0];
  search.props.onKeyDown({ key: "ArrowDown", preventDefault: () => prevented++ });
  const list = walk(tree, (node) => node.type === "section")[0];
  list.props.onKeyDown({ key: "ArrowUp", target: buttons[0], preventDefault: () => prevented++ });
  list.props.onKeyDown({ key: "Home", target: buttons[1], preventDefault: () => prevented++ });
  assert.deepEqual(focused, [0, 1, 0]);
  assert.equal(prevented, 3);
  const wrapper = tree.props.children;
  wrapper.props.onKeyDown({
    key: "Escape",
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++
  });
  assert.equal(h.closes.length, 1);
  assert.equal(stopped, 1);
  assert.equal(model.indicatorLibraryFocusIndex("ArrowDown", 0, 0), null);
  assert.equal(model.indicatorLibraryFocusIndex("Enter", 0, 2), null);
  assert.equal(model.indicatorLibraryFocusIndex("End", 0, 2), 1);
});

test("actual React SSR renders localized scripts and active badge without unsupported categories", () => {
  const { IndicatorLibraryDialog } = modules()("screens/terminal/IndicatorLibraryDialog.js");
  for (const locale of ["ru", "en"]) {
    const html = renderToStaticMarkup(
      react.createElement(IndicatorLibraryDialog, {
        entries,
        activeIds: ["mtpAll"],
        locale,
        onAdd: () => {},
        onClose: () => {}
      })
    );
    assert.match(html, /<dialog/);
    assert.match(html, locale === "ru" ? /Мои скрипты/ : /My scripts/);
    assert.match(html, locale === "ru" ? /Теханализ/ : /Technicals/);
    assert.match(html, locale === "ru" ? /Добавлен/ : /Added/);
    assert.match(html, /aria-label="(?:Поиск индикаторов|Search indicators)"/);
    assert.doesNotMatch(html, /Community|Fundamentals|Purchased|Стратегии|Покупки|Сообщество/);
  }
});

function memoryDatabase() {
  const stores = new Map();
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    get: async (name, key) => structuredClone(store(name).get(key)),
    all: async (name) => structuredClone([...store(name).values()]),
    put: async (name, record) => {
      store(name).set(record.id, structuredClone(record));
    },
    flush: async () => {},
    transaction: async (_names, action) =>
      action({
        objectStore: (name) => ({
          put: (record) => store(name).set(record.id, structuredClone(record)),
          delete: (id) => store(name).delete(id)
        })
      })
  };
}
function terminalFixture() {
  const database = memoryDatabase(),
    load = modules({ "services/storage-db.js": database });
  const { TerminalController } = load("screens/terminal/controller.js"),
    controller = new TerminalController();
  controller.update({ owner: "profile-A" });
  controller.saveView = async () => {};
  let reloads = 0;
  controller.loadHistory = async () => {
    reloads++;
  };
  return { controller, load, database, reloads: () => reloads };
}

test("library add enables original ranges and master without duplicating or disabling active MTP", async () => {
  const f = terminalFixture(),
    { changeMenuIndicator } = f.load("screens/terminal/indicator-menu-actions.js");
  await changeMenuIndicator(f.controller, "mtpAll", true);
  const combined = f.controller.getSnapshot().preferences.indicators;
  assert.equal(combined.mtpAll, true);
  assert.equal(combined.mtp160, false);
  assert.equal(combined.mtp440, false);
  assert.equal(combined.mtp640, false);
  await changeMenuIndicator(f.controller, "mtp160", true);
  await changeMenuIndicator(f.controller, "mtpAll", true);
  assert.equal(f.controller.getSnapshot().preferences.indicators, combined);
  assert.equal(f.reloads(), 1);
  await changeMenuIndicator(f.controller, "ma", true);
  await changeMenuIndicator(f.controller, "ma", true);
  assert.equal(f.controller.getSnapshot().preferences.indicators.ma, true);
  assert.equal(f.reloads(), 2);
  await changeMenuIndicator(f.controller, "mtp640");
  const partial = f.controller.getSnapshot().preferences.indicators;
  assert.equal(partial.mtpAll, false);
  assert.equal(partial.mtp640, false);
  assert.equal(partial.mtp160, true);
  assert.equal(partial.mtp440, true);
  await changeMenuIndicator(f.controller, "mtp640", true);
  assert.equal(
    f
      .load("model/indicator-flags.js")
      .mtpSelection(f.controller.getSnapshot().preferences.indicators).all,
    true
  );
});

test("collapse persists per owner through manual backup and Drive, while render config and camera stay identical", async () => {
  const f = terminalFixture(),
    { persistMtpMenuCollapsed } = f.load("screens/terminal/indicator-menu-actions.js");
  const storage = f.load("services/storage.js"),
    backup = f.load("model/backup-format.js");
  const key = f.load("charts/render-config.js").chartRenderConfigKey;
  const before = f.controller.getSnapshot().preferences,
    camera = { barSpace: 11, rightOffsetBars: -50 };
  f.controller.chart = { camera };
  await storage.savePreferences("profile-B", { chartSettings: { mtpMenuCollapsed: false } });
  await persistMtpMenuCollapsed(f.controller);
  const after = f.controller.getSnapshot().preferences;
  assert.equal(after.chartSettings.mtpMenuCollapsed, true);
  assert.equal(after.indicators, before.indicators);
  assert.equal(f.controller.chart.camera, camera);
  assert.equal(
    key(before.chartSettings, before.indicators),
    key(after.chartSettings, after.indicators)
  );
  assert.equal(f.reloads(), 0);
  const exported = backup.validateBackup(
    JSON.parse(JSON.stringify(await storage.createBackup("profile-A")))
  );
  await storage.importBackup("profile-C", exported);
  assert.equal((await storage.loadPreferences("profile-C")).chartSettings.mtpMenuCollapsed, true);
  assert.equal((await storage.loadPreferences("profile-B")).chartSettings.mtpMenuCollapsed, false);
  const drive = f.load("services/drive/backup.js"),
    prepared = await drive.prepareDriveBackup(exported);
  const restored = await drive.restoreDriveBackup(prepared.payload, []);
  assert.equal(restored.layout.chartSettings.mtpMenuCollapsed, true);
  assert.equal(backup.isProfilePreferences({ chartSettings: { mtpMenuCollapsed: "true" } }), false);
});

test("pending menu writes reject owner/import/revision changes including a boundary that has already bounced back", async () => {
  for (const action of ["add", "collapse"])
    for (const boundary of [
      "owner",
      "owner-bounce",
      "import",
      "import-finished",
      "revision",
      "preferences"
    ]) {
      const f = terminalFixture(),
        initial = f.controller.getSnapshot();
      let release;
      f.controller.saveView = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      const actions = f.load("screens/terminal/indicator-menu-actions.js");
      const pending =
        action === "add"
          ? actions.changeMenuIndicator(f.controller, "mtpAll", true)
          : actions.persistMtpMenuCollapsed(f.controller);
      if (boundary.startsWith("owner")) {
        f.controller.update({ owner: "profile-B" });
        if (boundary === "owner-bounce") f.controller.update({ owner: initial.owner });
      } else if (boundary.startsWith("import")) {
        f.controller.update({ importingBackup: true });
        if (boundary === "import-finished") f.controller.update({ importingBackup: false });
      } else if (boundary === "revision")
        f.controller.update({ chartRevision: initial.chartRevision + 1 });
      else
        f.controller.update({
          preferences: {
            ...initial.preferences,
            chartSettings: { ...initial.preferences.chartSettings, grid: false }
          }
        });
      release();
      await pending;
      assert.equal(
        f.controller.getSnapshot().preferences.chartSettings.mtpMenuCollapsed,
        undefined,
        `${action}/${boundary}`
      );
      assert.equal(
        f.controller.getSnapshot().preferences.indicators.mtpAll,
        false,
        `${action}/${boundary}`
      );
      assert.equal(await f.database.get("preferences", "layout:profile-B"), undefined);
      assert.equal(f.reloads(), 0);
    }
});

test("terminal library exposes only real native-ready entries and maps SMA to its legacy flag", async () => {
  const f = terminalFixture(),
    load = modules({
      "screens/terminal/context.js": {
        useTerminal: () => ({ controller: f.controller, state: f.controller.getSnapshot() })
      },
      "screens/terminal/useIndicatorMenuAction.js": {
        useIndicatorMenuAction: () => ({ pending: false, run: (action) => action() })
      }
    });
  const { TerminalIndicatorLibrary } = load("screens/terminal/TerminalIndicatorLibrary.js"),
    dialog = TerminalIndicatorLibrary();
  assert.deepEqual(
    dialog.props.entries.map((entry) => entry.id),
    ["mtpAll", "mtp160", "mtp440", "mtp640", "volume", "sma", "ema"]
  );
  assert.equal(
    dialog.props.entries.every((entry) => entry.available),
    true
  );
  dialog.props.onAdd("sma");
  await new Promise(setImmediate);
  assert.equal(f.controller.getSnapshot().preferences.indicators.ma, true);
  f.controller.update({ importingBackup: true });
  assert.equal(
    TerminalIndicatorLibrary().props.entries.every((entry) => !entry.available && entry.reason),
    true
  );
});

test("split controls route main click to library, chevron to quick panel, and dismiss shield consumes chart gestures", () => {
  const state = { preferences: { indicators: {}, chartSettings: {} } },
    calls = [],
    refs = [{ current: { focus: () => calls.push("focus") } }, { current: null }];
  let open = false,
    refIndex = 0;
  const load = modules({
    react: {
      ...react,
      useEffect: () => {},
      useState: () => [
        open,
        (value) => {
          open = value;
        }
      ],
      useRef: () => refs[refIndex++]
    },
    "screens/terminal/context.js": {
      useTerminal: () => ({ state, controller: { setDialog: (value) => calls.push(value) } })
    },
    "screens/terminal/useIndicatorMenuAction.js": {
      useIndicatorMenuAction: () => ({ pending: false, run: (action) => action() })
    }
  });
  const { TerminalIndicatorControls } = load("screens/terminal/TerminalIndicatorControls.js");
  const render = () => {
    refIndex = 0;
    return TerminalIndicatorControls();
  };
  let tree = render();
  walk(tree, (node) => node.props?.id === "indicators-button")[0].props.onClick();
  assert.deepEqual(calls, ["indicator-library"]);
  assert.equal(open, false);
  walk(tree, (node) => node.props?.id === "indicator-quick-button")[0].props.onClick();
  tree = render();
  assert.equal(walk(tree, (node) => node.props?.id === "indicators-panel").length, 1);
  const shield = walk(tree, (node) => node.props?.className === "indicator-menu-dismiss")[0];
  let stopped = 0,
    prevented = 0;
  const event = { preventDefault: () => prevented++, stopPropagation: () => stopped++ };
  shield.props.onPointerDown(event);
  assert.equal(open, true);
  shield.props.onClick(event);
  assert.equal(open, false);
  assert.equal(stopped, 2);
  assert.equal(prevented, 2);
  walk(render(), (node) => node.props?.id === "indicator-quick-button")[0].props.onClick();
  render().props.onKeyDown({ ...event, key: "Escape" });
  assert.equal(open, false);
});

test("quick menu Escape still dismisses after an async disabled control moves focus outside", (t) => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  const listeners = new Map(), cleanups = [];
  let open = true, focused = 0, refIndex = 0;
  const refs = [{ current: { focus: () => focused++ } }, { current: null }];
  const target = {
    addEventListener: (name, callback, capture) => listeners.set(name, { callback, capture }),
    removeEventListener: (name) => listeners.delete(name)
  };
  globalThis.window = target;
  globalThis.document = target;
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });
  const load = modules({
    react: { ...react,
      useEffect: (callback) => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); },
      useState: () => [open, (next) => { open = next; }],
      useRef: () => refs[refIndex++]
    },
    "screens/terminal/context.js": { useTerminal: () => ({ state: {
      preferences: { indicators: {}, chartSettings: {} }
    }, controller: {} }) },
    "screens/terminal/useIndicatorMenuAction.js": { useIndicatorMenuAction: () => ({ pending: true }) }
  });
  load("screens/terminal/TerminalIndicatorControls.js").TerminalIndicatorControls();
  const handler = listeners.get("keydown");
  assert.equal(handler.capture, true);
  let prevented = false, stopped = false;
  handler.callback({ key: "Escape", target: { tagName: "BODY" },
    preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(open, false);
  assert.equal(focused, 1);
  assert.equal(prevented && stopped, true);
});

test("pending indicator action catches failure, releases pending and suppresses errors after owner bounce", async () => {
  for (const bounce of [false, true]) {
    const f = terminalFixture(),
      changes = [],
      notices = [],
      refs = [];
    f.controller.notify = (message) => notices.push(message);
    const hook = modules({
      react: {
        ...react,
        useState: () => [false, (value) => changes.push(value)],
        useRef: (value) => {
          const ref = { current: value };
          refs.push(ref);
          return ref;
        },
        useEffect: (callback) => callback()
      }
    })("screens/terminal/useIndicatorMenuAction.js").useIndicatorMenuAction(f.controller);
    let reject;
    const pending = hook.run(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    if (bounce) {
      f.controller.update({ owner: "profile-B" });
      f.controller.update({ owner: "profile-A" });
    }
    reject(new Error("Save failed"));
    await pending;
    assert.deepEqual(changes, [true, false]);
    assert.deepEqual(notices, bounce ? [] : ["Save failed"]);
    assert.equal(refs[0].current, false);
  }
});
