import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides) {
  const context = vm.createContext({ console, Map, Date, Math, TextEncoder, TextDecoder }),
    modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`).runInContext(context)(
      (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}

async function fixture(fails = false) {
  const db = new Map(),
    events = [],
    owner = "owner",
    key = "RTSI:1d:kline:365",
    oldView = { camera: { barSpace: 9, rightOffsetBars: -42 } },
    incoming = {
      camera: { barSpace: 15, rightOffsetBars: 7 },
      anchor: { timestamp: 1700000000000, xFraction: 0.5 }
    },
    state = { owner, name: "Profile", chartRevision: 0 };
  let camera;
  const outgoing = { getView: () => oldView };
  const storage = {
    saveView: async (account, viewKey, value) => {
      events.push("view.save");
      const id = `view:${account}:${viewKey}`;
      db.set(id, { id, owner: account, value });
    },
    loadView: async (account, viewKey) => db.get(`view:${account}:${viewKey}`)?.value,
    importBackup: async (account, data) => {
      events.push("import");
      assert.equal(outgoing.persistView, false);
      if (fails) throw new Error("transaction failed");
      for (const view of data.views ?? []) {
        const id = `view:${account}:${view.key}`;
        db.set(id, { id, owner: account, value: view.value });
      }
      await camera.saveAdapterView(outgoing, account, key);
      return { drawings: 0, images: 0, history: 0 };
    },
    loadWatchlist: async () => undefined
  };
  const load = sources({
    "services/storage.ts": storage,
    "services/storage-db.ts": {
      get: async (_store, id) => db.get(id),
      all: async () => [...db.values()],
      put: async (_store, record) => {
        db.set(record.id, record);
      },
      transaction: async (_stores, action) =>
        action({ objectStore: () => ({ delete: (id) => db.delete(id) }) })
    }
  });
  camera = load("services/chart-camera.ts");
  const { importTerminalBackup } = load("screens/terminal/controller-import.ts");
  await camera.saveChartView(owner, "GAZP:1d:kline:365", oldView);
  await camera.saveChartView("owner:child", "GAZP:1d:kline:365", {
    camera: { barSpace: 21, rightOffsetBars: -11 }
  });
  db.set("layout:owner", { id: "layout:owner", owner, value: {} });
  events.length = 0;
  const bridge = {
    getState: () => state,
    getClient: () => null,
    getChart: () => outgoing,
    saveView: () => camera.saveAdapterView(outgoing, owner, key),
    editing: {
      flush: async () => {
        events.push("editing.flush");
      },
      reset: () => {
        events.push("editing.reset");
      }
    },
    session: {
      matches: () => true,
      prepareProfile: async () => {
        await camera.saveAdapterView(outgoing, owner, key);
        events.push("prepare");
      },
      applyBankState() {}
    },
    resetHistory: () => {
      events.push("history.reset");
    },
    update(patch) {
      Object.assign(state, patch);
    },
    loadHistory: async () => {},
    notify() {}
  };
  const backup = {
    application: "personal-terminal",
    schemaVersion: 1,
    drawings: [],
    images: [],
    views: [{ key, value: incoming }]
  };
  return {
    db,
    events,
    outgoing,
    camera,
    incoming,
    oldView,
    bridge,
    backup,
    importTerminalBackup,
    owner,
    key,
    state
  };
}

test("backup camera survives outgoing cleanup while only the importing owner's shared state is cleared", async () => {
  const f = await fixture();
  await f.importTerminalBackup(f.backup, f.bridge);
  assert.equal(f.outgoing.persistView, false);
  assert.equal(f.state.chartRevision, 1);
  assert.equal(f.events.slice(0, 3).join(","), "editing.flush,view.save,import");
  assert.equal(f.events.filter((event) => event === "view.save").length, 1);
  const restored = await f.camera.loadChartView(f.owner, f.key);
  assert.equal(restored.camera.barSpace, 15);
  assert.equal(restored.anchor.timestamp, 1700000000000);
  assert.equal(f.db.has("chart-camera:owner:kline:1d"), false);
  assert.equal(f.db.has("layout:owner"), true);
  assert.equal(f.db.has(`view:${f.owner}:${f.key}`), true);
  assert.equal(f.db.has("chart-camera:owner:child:kline:1d"), true);
  const other = await f.camera.loadChartView("owner:child", "RTSI:1d:kline:365");
  assert.equal(other.camera.barSpace, 21);
});

test("failed import restores outgoing persistence and retains the shared camera", async () => {
  const f = await fixture(true);
  await assert.rejects(f.importTerminalBackup(f.backup, f.bridge), /transaction failed/);
  assert.equal(f.outgoing.persistView, undefined);
  assert.equal(f.state.chartRevision, 0);
  await f.camera.saveAdapterView(f.outgoing, f.owner, f.key);
  assert.equal(f.events.filter((event) => event === "view.save").length, 2);
  assert.equal(f.events.includes("history.reset"), false);
  assert.equal(f.events.includes("editing.reset"), false);
  assert.equal(f.db.has("chart-camera:owner:kline:1d"), true);
});

test("invalid backup does not flush, retire the adapter, or reset history", async () => {
  const f = await fixture();
  await assert.rejects(
    f.importTerminalBackup({ application: "unsupported", schemaVersion: 1 }, f.bridge)
  );
  assert.equal(f.events.length, 0);
  assert.equal(f.outgoing.persistView, undefined);
  assert.equal(f.state.chartRevision, 0);
  assert.equal(f.db.has("chart-camera:owner:kline:1d"), true);
});
