import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides) {
  const context = vm.createContext({ console, Map, Date, Math, crypto, TextEncoder, TextDecoder, DOMException }),
    modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
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
  let camera, recoveryJournal;
  const controls = { resetFailure: false, onSharedReset: null };
  const outgoing = { getView: () => oldView };
  let currentChart = outgoing;
  const storage = {
    saveView: async (account, viewKey, value) => {
      events.push("view.save");
      const id = `view:${account}:${viewKey}`;
      db.set(id, { id, owner: account, value });
    },
    loadView: async (account, viewKey) => db.get(`view:${account}:${viewKey}`)?.value,
    importBackup: async (account, data, options = {}) => {
      events.push("import");
      assert.equal(outgoing.persistView, false);
      assert.equal(outgoing.retired, true);
      if (fails) throw new Error("transaction failed");
      if (options.restoreRecovery) {
        const record=recoveryJournal.nativeImportRecoveryRecord(account,options.restoreRecovery);
        db.set(record.id,record);
      }
      for (const view of data.views ?? []) {
        const id = `view:${account}:${view.key}`;
        db.set(id, { id, owner: account, value: view.value });
      }
      await camera.saveAdapterView(outgoing, account, key);
      controls.onImportReturn?.();
      return { drawings: 0, images: 0, history: 0 };
    },
    loadWatchlist: async () => undefined
  };
  const overrides = {
    "services/storage.ts": storage,
    "services/storage-db.ts": {
      get: async (_store, id) => db.get(id),
      all: async () => {
        controls.onSharedReset?.();
        if (controls.resetFailure) throw new Error("shared camera reset failed");
        return [...db.values()];
      },
      put: async (_store, record) => {
        db.set(record.id, record);
      },
      transaction: async (_stores, action) => {
        action({ objectStore: () => ({ delete: (id) => db.delete(id), get: (id) => {
          const request={};queueMicrotask(()=>{request.result=db.get(id);request.onsuccess?.();});return request;
        } }) });
        await Promise.resolve();
      }
    }
  };
  const load = sources(overrides);
  recoveryJournal=load("services/restore-recovery-journal.ts");
  camera = load("services/chart-camera.ts");
  const { importTerminalBackup, restoreImportedProfile } = load(
    "screens/terminal/controller-import.ts"
  );
  await camera.saveChartView(owner, "GAZP:1d:kline:365", oldView);
  await camera.saveChartView("owner:child", "GAZP:1d:kline:365", {
    camera: { barSpace: 21, rightOffsetBars: -11 }
  });
  db.set("layout:owner", { id: "layout:owner", owner, value: {} });
  events.length = 0;
  const bridge = {
    getState: () => state,
    getClient: () => null,
    getChart: () => currentChart,
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
    storage,
    events,
    outgoing,
    camera,
    incoming,
    oldView,
    bridge,
    backup,
    importTerminalBackup,
    restoreImportedProfile,
    coldRestore: () => sources(overrides)("screens/terminal/controller-import.ts").restoreImportedProfile,
    recoveryQueue: (cold = false) => {
      const {TerminalBackups}=(cold ? sources(overrides) : load)("screens/terminal/controller-backups.ts");
      return new TerminalBackups({ ...bridge, isAlive: () => true, flush: async () => { throw new Error("recovery must not export/flush stale state"); } });
    },
    controls,
    setChart: (chart) => {
      currentChart = chart;
    },
    owner,
    key,
    state
  };
}
for (const cold of [false,true]) for (const failure of ["prepare","client","history"]) {
  test(`failed shared refresh preserves canonical camera on ${cold?"cold":"UI default"} retry (${failure})`,async()=>{
    const f=await fixture(), sharedKey="chart-camera:profile-v2:owner:kline";
    const canonical={id:sharedKey,owner:"profile-v2:owner",value:{symbol:"GAZP",camera:{barSpace:23,rightOffsetBars:5}}};
    f.db.set(sharedKey,structuredClone(canonical));
    const prepare=f.bridge.session.prepareProfile;
    let failing=true;
    if(failure==="prepare")f.bridge.session.prepareProfile=async(...args)=>{await prepare(...args);if(failing)throw new Error("prepare failed");};
    if(failure==="client"){
      const client={rows:[],start:async()=>{if(failing)throw new Error("client failed");return {};}};
      f.bridge.getClient=()=>client;f.storage.loadWatchlist=async()=>[];
    }
    f.bridge.loadHistory=async()=>{if(failure==="history"&&failing)throw new Error("history failed");f.state.historyViewReady=true;};
    await assert.rejects(f.recoveryQueue().recover(true));
    assert.equal(f.state.importRecoveryRequired,true);
    assert.deepEqual(f.db.get(sharedKey),canonical);
    assert.equal(f.db.get("workspace-restore-recovery:owner").value.mode,"shared-runtime");
    failing=false;
    await f.recoveryQueue(cold).recover();
    assert.deepEqual(f.db.get(sharedKey),canonical);
    assert.equal(f.state.importRecoveryRequired,false);
    assert.equal(f.state.historyViewReady,true);
    assert.equal(f.db.has("workspace-restore-recovery:owner"),false);
    assert.equal(f.events.includes("import"),false);
    assert.equal(f.outgoing.retired,true);
  });
}
test("ordinary import recovery keeps its clearing behavior and completed shared mode never leaks into a new restore",async()=>{
  const f=await fixture(), sharedKey="chart-camera:profile-v2:owner:kline";
  let failing=true;
  f.bridge.loadHistory=async()=>{if(failing)throw new Error("restore failed");};
  await assert.rejects(f.importTerminalBackup(f.backup,f.bridge));
  assert.equal(f.db.get("workspace-restore-recovery:owner").value.mode,"import");
  const stale={id:sharedKey,owner:"profile-v2:owner",value:{symbol:"GAZP",camera:{barSpace:7,rightOffsetBars:5}}};
  f.db.set(sharedKey,stale);failing=false;
  await f.recoveryQueue(true).recover();
  assert.equal(f.db.has(sharedKey),false);
  assert.equal(f.db.has("workspace-restore-recovery:owner"),false);
  f.db.set(sharedKey,stale);await f.recoveryQueue().recover(true);
  assert.equal(f.db.has(sharedKey),true);
  f.db.set(sharedKey,stale);await f.recoveryQueue().recover();
  assert.equal(f.db.has(sharedKey),false,"successful shared restore must not leave a sticky preserve mode");
});

test("backup camera survives outgoing cleanup while only the importing owner's shared state is cleared", async () => {
  const f = await fixture();
  await f.importTerminalBackup(f.backup, f.bridge);
  assert.equal(f.outgoing.persistView, false);
  assert.equal(f.outgoing.retired, true);
  assert.equal(f.state.chartRevision, 2);
  assert.equal(f.events.slice(0, 3).join(","), "editing.flush,view.save,import");
  assert.equal(f.events.filter((event) => event === "view.save").length, 1);
  const restored = await f.camera.loadChartView(f.owner, f.key);
  assert.equal(restored.camera.barSpace, 15);
  assert.equal(restored.anchor.timestamp, 1700000000000);
  assert.equal(f.db.has("chart-camera:profile-v2:owner:kline"), false);
  assert.equal(f.db.has("layout:owner"), true);
  assert.equal(f.db.has(`view:${f.owner}:${f.key}`), true);
  assert.equal(f.db.has("chart-camera:profile-v2:owner:child:kline"), true);
  const other = await f.camera.loadChartView("owner:child", "RTSI:1d:kline:365");
  assert.equal(other.camera.barSpace, 21);
});

test("native commit notifies once before a late guard cancellation and leaves recoverable UI state", async () => {
  const f = await fixture();
  let current = true, commits = 0;
  f.controls.onImportReturn = () => { current = false; };
  await assert.rejects(f.importTerminalBackup(f.backup, f.bridge, {
    valid: () => current,
    onCommitted: () => { commits++; }
  }), { name: "AbortError" });
  assert.equal(commits, 1);
  assert.equal(f.state.importRecoveryRequired, true);
  assert.equal(f.events.filter((event) => event === "import").length, 1);
  assert.deepEqual(f.db.get(`view:${f.owner}:${f.key}`).value, f.incoming);
});

test("native commit during a bank transition reports the commit and restores later without repeating writes", async () => {
  const f = await fixture();
  let commits = 0;
  f.controls.onImportReturn = () => { f.state.profileTransition = true; };
  await f.importTerminalBackup(f.backup, f.bridge, { onCommitted: () => { commits++; } });
  assert.equal(commits, 1);
  assert.equal(f.state.importRecoveryRequired, true);
  assert.equal(f.events.includes("prepare"), false);
  f.state.profileTransition = false;
  await f.restoreImportedProfile(f.bridge);
  assert.equal(f.state.importRecoveryRequired, false);
  assert.equal(f.events.filter((event) => event === "import").length, 1);
  assert.deepEqual(await f.camera.loadChartView(f.owner, f.key), f.incoming);
});

test("failed import restores outgoing persistence and retains the shared camera", async () => {
  const f = await fixture(true);
  await assert.rejects(f.importTerminalBackup(f.backup, f.bridge), /transaction failed/);
  assert.equal(f.outgoing.persistView, undefined);
  assert.equal(f.outgoing.retired, undefined);
  assert.equal(f.state.chartRevision, 0);
  await f.camera.saveAdapterView(f.outgoing, f.owner, f.key);
  assert.equal(f.events.filter((event) => event === "view.save").length, 2);
  assert.equal(f.events.includes("history.reset"), false);
  assert.equal(f.events.includes("editing.reset"), false);
  assert.equal(f.db.has("chart-camera:profile-v2:owner:kline"), true);
});

test("invalid backup does not flush, retire the adapter, or reset history", async () => {
  const f = await fixture();
  await assert.rejects(
    f.importTerminalBackup({ application: "unsupported", schemaVersion: 1 }, f.bridge)
  );
  assert.equal(f.events.length, 0);
  assert.equal(f.outgoing.persistView, undefined);
  assert.equal(f.outgoing.retired, undefined);
  assert.equal(f.state.chartRevision, 0);
  assert.equal(f.db.has("chart-camera:profile-v2:owner:kline"), true);
});

test("successful import remains retired when late lifecycle/data work re-enables persistView", async () => {
  const f = await fixture();
  f.bridge.session.prepareProfile = async () => {
    f.outgoing.persistView = true;
    assert.equal(f.outgoing.retired, true);
    await f.camera.saveAdapterView(f.outgoing, f.owner, f.key);
  };
  await f.importTerminalBackup(f.backup, f.bridge);
  assert.equal(f.outgoing.retired, true);
  f.outgoing.persistView = true;
  await f.camera.saveAdapterView(f.outgoing, f.owner, f.key);
  assert.equal(f.events.filter((event) => event === "view.save").length, 1);
  const imported = await f.camera.loadChartView(f.owner, f.key);
  assert.equal(imported.camera.barSpace, f.incoming.camera.barSpace);
  assert.equal(imported.camera.rightOffsetBars, f.incoming.camera.rightOffsetBars);
  assert.equal(f.db.has("chart-camera:profile-v2:owner:kline:1d"), false);
});

test("failed import restores both original optional flags exactly", async () => {
  for (const flags of [
    {},
    { persistView: true, retired: false },
    { persistView: false, retired: true },
    { persistView: false },
    { retired: false }
  ]) {
    const f = await fixture(true);
    Object.assign(f.outgoing, flags);
    await assert.rejects(f.importTerminalBackup(f.backup, f.bridge), /transaction failed/);
    for (const key of ["persistView", "retired"]) {
      assert.equal(f.outgoing[key], flags[key]);
      assert.equal(Object.hasOwn(f.outgoing, key), Object.hasOwn(flags, key));
    }
    assert.equal(f.state.chartRevision, 0);
  }
});

test("shared-reset failure after commit invalidates immediately, retires newborns, and recovers without reimporting", async () => {
  const f = await fixture(),
    newborn = { persistView: true, getView: () => f.oldView };
  f.controls.resetFailure = true;
  f.controls.onSharedReset = () => {
    assert.equal(
      f.state.chartRevision,
      1,
      "commit must invalidate before the first postcommit await"
    );
    assert.equal(f.state.historyViewReady, false);
    assert.equal(f.events.includes("editing.reset"), true);
    assert.equal(f.events.includes("history.reset"), true);
    f.setChart(newborn);
  };
  await assert.rejects(f.importTerminalBackup(f.backup, f.bridge), /shared camera reset failed/);
  assert.equal(f.outgoing.retired, true);
  assert.equal(newborn.retired, true);
  assert.equal(newborn.persistView, false);
  assert.equal(f.state.importRecoveryRequired, true);
  assert.equal(f.state.historyViewReady, false);
  assert.equal(f.state.loading, false);
  assert.equal(f.state.candles.length, 0);
  assert.equal(f.state.chartRevision, 2);
  assert.match(f.state.historyHelp, /Данные импорта записаны.*Повторите восстановление/);
  newborn.persistView = true;
  await f.camera.saveAdapterView(newborn, f.owner, f.key);
  assert.equal(
    f.db.get(`view:${f.owner}:${f.key}`).value.camera.barSpace,
    f.incoming.camera.barSpace
  );
  const importedWrites = f.events.filter((event) => event === "import").length;
  f.controls.resetFailure = false;
  f.controls.onSharedReset = null;
  f.bridge.loadHistory = async () => {
    f.state.historyViewReady = true;
  };
  await f.restoreImportedProfile(f.bridge);
  assert.equal(f.events.filter((event) => event === "import").length, importedWrites);
  assert.equal(f.state.chartRevision, 3);
  assert.equal(f.state.importRecoveryRequired, false);
  assert.equal(f.state.historyViewReady, true);
  assert.equal(newborn.retired, true);
  assert.equal(f.outgoing.retired, true);
  assert.equal(f.db.has("chart-camera:profile-v2:owner:kline:1d"), false);
  const restored = await f.camera.loadChartView(f.owner, f.key);
  assert.equal(restored.camera.barSpace, f.incoming.camera.barSpace);
  assert.equal(restored.camera.rightOffsetBars, f.incoming.camera.rightOffsetBars);
});
