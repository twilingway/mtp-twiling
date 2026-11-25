import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise(setImmediate);
function sources(overrides) {
  const context = vm.createContext({
      console,
      Map,
      Date,
      Math,
      Promise,
      DOMException,
      TextEncoder,
      TextDecoder
    }),
    modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"),
      key = path.relative(root, file).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`).runInContext(context)(
      (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}

async function fixture() {
  const db = new Map(),
    events = [],
    patches = [],
    commits = new Set(),
    hooks = {},
    key = "SBER:1d:kline:365",
    viewA = { camera: { barSpace: 22, rightOffsetBars: 1.8495886 } },
    viewB = { camera: { barSpace: 22, rightOffsetBars: -7.01678 } },
    backupA = {
      application: "personal-terminal",
      schemaVersion: 1,
      drawings: [],
      images: [],
      views: [{ key, value: viewA }]
    };
  let state = {
      owner: "A",
      name: "Profile A",
      chartRevision: 0,
      backupBusy: false,
      importingBackup: false
    },
    client = { name: "client-A", rows: [], start: async () => ({}) },
    chart = { getView: () => viewB },
    alive = true,
    camera;
  const outgoing = chart;
  const storage = {
    saveView: async (owner, viewKey, value) => {
      events.push(`view.save:${owner}`);
      const id = `view:${owner}:${viewKey}`;
      db.set(id, { id, owner, value });
    },
    loadView: async (owner, viewKey) => db.get(`view:${owner}:${viewKey}`)?.value,
    loadWatchlist: async () => undefined,
    flush: async () => {
      events.push(`db.flush:${state.owner}`);
    },
    importBackup: async (owner, data, options = {}) => {
      events.push(`import.start:${owner}`);
      commits.add(owner);
      try {
        if (hooks.importGate) await hooks.importGate.promise;
        if (options.valid && !options.valid()) throw new DOMException("changed", "AbortError");
        if (hooks.importFailure) throw new Error("commit failed");
        for (const item of data.views ?? []) {
          const id = `view:${owner}:${item.key}`;
          db.set(id, { id, owner, value: item.value });
        }
        events.push(`import.commit:${owner}`);
        return { drawings: 0, images: 0, history: 0 };
      } finally {
        commits.delete(owner);
      }
    },
    createBackup: async (owner, options) => {
      events.push(`export.snapshot:${owner}`);
      return {
        application: "personal-terminal",
        schemaVersion: 1,
        drawings: [],
        images: [],
        views: [{ key, value: db.get(`view:${owner}:${key}`)?.value }],
        includeHistory: options.includeHistory
      };
    }
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
  await camera.saveChartView("A", key, viewB);
  events.length = 0;
  const bridge = {
    getState: () => state,
    getClient: () => client,
    getChart: () => chart,
    isAlive: () => alive,
    update: (patch) => {
      patches.push({ owner: state.owner, patch });
      state = { ...state, ...patch };
    },
    saveView: async () => {
      const owner = state.owner,
        captured = chart;
      events.push(`save.start:${owner}`);
      if (hooks.saveGate) await hooks.saveGate.promise;
      await camera.saveAdapterView(captured, owner, key);
    },
    editing: {
      flush: async () => {
        events.push(`editing.flush:${state.owner}`);
      },
      reset: () => {
        events.push("editing.reset");
      }
    },
    session: {
      matches: (captured) => alive && captured === client,
      prepareProfile: async () => {
        await hooks.prepare?.();
        if (hooks.prepareFailure) throw new Error("postcommit profile failed");
      },
      applyBankState() {}
    },
    resetHistory: () => {
      events.push("history.reset");
    },
    loadHistory: async () => {},
    notify() {}
  };
  bridge.flush = async () => {
    const owner = state.owner;
    assert.equal(
      commits.has(owner),
      false,
      "direct flush must not run during this owner's import commit"
    );
    events.push(`flush.start:${owner}`);
    if (hooks.flushGate) await hooks.flushGate.promise;
    await bridge.saveView();
    await storage.flush();
    events.push(`flush.end:${owner}`);
  };
  const { TerminalBackups } = load("screens/terminal/controller-backups.ts"),
    transfers = new TerminalBackups(bridge);
  return {
    transfers,
    bridge,
    hooks,
    events,
    patches,
    camera,
    db,
    key,
    viewA,
    viewB,
    backupA,
    outgoing,
    state: () => state,
    changeOwner(owner, replaceClient = true) {
      state = {
        ...state,
        owner,
        name: `Profile ${owner}`,
        backupBusy: false,
        importingBackup: false
      };
      if (replaceClient) client = { name: `client-${owner}`, rows: [], start: async () => ({}) };
      chart = { getView: () => viewB };
    },
    changeClient() {
      client = { name: "replacement-client", rows: [], start: async () => ({}) };
    },
    stop() {
      alive = false;
    }
  };
}

test("selected file reserves transfer order before asynchronous file reading finishes", async () => {
  const f = await fixture(),
    reading = deferred();
  const importing = f.transfers.importFile({ size: 100, text: () => reading.promise });
  await tick();
  assert.equal(f.state().backupBusy, true);
  const exporting = f.transfers.export(false);
  await tick();
  assert.equal(
    f.events.some((event) => event.startsWith("flush.start:")),
    false
  );
  reading.resolve(JSON.stringify(f.backupA));
  await importing;
  const result = await exporting;
  assert.deepEqual(structuredClone(result.views[0].value), f.viewA);
});

test("portable guard is checked after queued work and saveView, before retirement or commit", async () => {
  for (const phase of ["queue", "save"]) {
    const f = await fixture(); let current = true;
    const gate = deferred(); let earlier;
    if (phase === "queue") { f.hooks.flushGate = gate; earlier = f.transfers.export(false); }
    else f.hooks.saveGate = gate;
    const importing = f.transfers.import(f.backupA, { replacePortable: true, valid: () => current });
    const rejected = assert.rejects(importing, { name: "AbortError" });
    await tick(); current = false; gate.resolve(); await earlier; await rejected;
    assert.equal(f.events.includes("import.start:A"), false);
    assert.equal(f.outgoing.retired, undefined);
    assert.equal(f.state().importingBackup, false);
  }
});

test("onCommitted changes the guard phase before own restoration updates, with no second import", async () => {
  const f = await fixture(); let revision = 1, committed = false;
  f.hooks.prepare = async () => { revision++; };
  await f.transfers.import(f.backupA, { replacePortable: true,
    valid: () => committed || revision === 1,
    onCommitted: () => { assert.equal(f.events.includes("import.commit:A"), true); committed = true; } });
  assert.equal(committed, true); assert.equal(revision, 2);
  assert.equal(f.events.filter(event => event === "import.start:A").length, 1);
  assert.equal(f.state().importRecoveryRequired, false);
  assert.equal(f.outgoing.retired, true);
  assert.equal(f.state().backupBusy, false);
});

test("postcommit guard failure requires restoration recovery and never repeats a committed import", async () => {
  const f = await fixture(); let current = true;
  f.hooks.prepare = async () => { current = false; };
  await assert.rejects(f.transfers.import(f.backupA, { replacePortable: true, valid: () => current }), { name: "AbortError" });
  assert.equal(f.state().importRecoveryRequired, true);
  assert.equal(f.outgoing.retired, true);
  assert.equal(f.events.filter(event => event === "import.commit:A").length, 1);
  current = true; f.hooks.prepare = undefined; await f.transfers.recover();
  assert.equal(f.state().importRecoveryRequired, false);
  assert.equal(f.events.filter(event => event === "import.commit:A").length, 1);
});

test("file reading from an old profile cannot import into the new profile", async () => {
  const f = await fixture(),
    reading = deferred();
  const importing = f.transfers.importFile({ size: 100, text: () => reading.promise });
  await tick();
  f.changeOwner("B");
  reading.resolve(JSON.stringify(f.backupA));
  await assert.rejects(importing, { name: "AbortError" });
  assert.equal(
    f.events.some((event) => event.startsWith("import.start:")),
    false
  );
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
});

test("held import A blocks a queued export and every direct flush until commit finishes", async () => {
  const f = await fixture();
  f.hooks.importGate = deferred();
  const importing = f.transfers.import(f.backupA);
  await tick();
  assert.equal(f.state().backupBusy, true);
  assert.equal(f.state().importingBackup, true);
  assert.equal(f.outgoing.retired, true);
  const exporting = f.transfers.export(true);
  await tick();
  assert.equal(
    f.events.some((event) => event.startsWith("flush.start")),
    false
  );
  assert.equal(
    f.events.some((event) => event.startsWith("export.snapshot")),
    false
  );
  f.hooks.importGate.resolve();
  await importing;
  const exported = await exporting;
  assert.equal(exported.views[0].value.camera.rightOffsetBars, f.viewA.camera.rightOffsetBars);
  assert.equal(exported.includeHistory, true);
  assert.ok(f.events.indexOf("flush.start:A") > f.events.indexOf("import.commit:A"));
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
});

test("postcommit failure keeps the outgoing adapter retired and a queued export recovers with imported A", async () => {
  const f = await fixture();
  f.hooks.prepareFailure = true;
  const importing = f.transfers.import(f.backupA),
    rejected = assert.rejects(importing, /postcommit profile failed/),
    exporting = f.transfers.export(false);
  await rejected;
  assert.equal(f.outgoing.retired, true);
  assert.equal(f.outgoing.persistView, false);
  const exported = await exporting;
  assert.equal(exported.views[0].value.camera.rightOffsetBars, f.viewA.camera.rightOffsetBars);
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
});

test("a failed replacement import preserves recovery of the already committed profile", async () => {
  const f = await fixture();
  f.hooks.prepareFailure = true;
  await assert.rejects(f.transfers.import(f.backupA), /postcommit profile failed/);
  assert.equal(f.state().importRecoveryRequired, true);
  f.hooks.prepareFailure = false;
  f.hooks.importFailure = true;
  await assert.rejects(f.transfers.import(f.backupA), /commit failed/);
  assert.equal(f.state().importRecoveryRequired, true);
  f.hooks.importFailure = false;
  await f.transfers.recover();
  assert.equal(f.state().importRecoveryRequired, false);
});

test("queued A transfers are invalidated by either owner or client changes and never run as B", async () => {
  for (const kind of ["owner", "client"]) {
    const f = await fixture();
    f.hooks.importGate = deferred();
    const importing = f.transfers.import(f.backupA),
      oldImport = assert.rejects(importing, { name: "AbortError" });
    await tick();
    const exporting = f.transfers.export(false),
      oldExport = assert.rejects(exporting, { name: "AbortError" });
    if (kind === "owner") f.changeOwner("B");
    else f.changeClient();
    f.hooks.importGate.resolve();
    await oldImport;
    await oldExport;
    assert.equal(
      f.events.some((event) => event.startsWith("export.snapshot")),
      false
    );
    assert.equal(
      f.events.some((event) => event.startsWith("flush.start")),
      false
    );
    const fresh = await f.transfers.export(false);
    assert.equal(f.events.at(-1), `export.snapshot:${kind === "owner" ? "B" : "A"}`);
    assert.equal(fresh.includeHistory, false);
    assert.equal(f.state().backupBusy, false);
    assert.equal(f.state().importingBackup, false);
  }
});

test("owner change during initial saveView cannot install the import barrier on the new profile", async () => {
  const f = await fixture();
  f.hooks.saveGate = deferred();
  const importing = f.transfers.import(f.backupA),
    rejected = assert.rejects(importing, { name: "AbortError" });
  await tick();
  assert.equal(f.events.includes("save.start:A"), true);
  f.changeOwner("B");
  f.hooks.saveGate.resolve();
  await rejected;
  assert.equal(
    f.patches.some((entry) => entry.owner === "B" && entry.patch.importingBackup === true),
    false
  );
  assert.equal(
    f.events.some((event) => event.startsWith("import.start")),
    false
  );
  assert.equal(f.outgoing.retired, undefined);
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
});

test("failed commit restores original flags, clears busy/barrier, and does not poison the next export", async () => {
  const f = await fixture();
  f.hooks.importFailure = true;
  await assert.rejects(f.transfers.import(f.backupA), /commit failed/);
  assert.equal(f.outgoing.retired, undefined);
  assert.equal(f.outgoing.persistView, undefined);
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
  const exported = await f.transfers.export(false);
  assert.equal(exported.views[0].value.camera.rightOffsetBars, f.viewB.camera.rightOffsetBars);
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
});

test("invalid import clears busy state without editing, saving, retiring or blocking later transfers", async () => {
  const f = await fixture();
  await assert.rejects(f.transfers.import({ application: "unsupported", schemaVersion: 1 }));
  assert.equal(f.events.length, 0);
  assert.equal(f.outgoing.retired, undefined);
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
  await f.transfers.export(false);
  assert.equal(f.events.at(-1), "export.snapshot:A");
});

test("export calls direct flush without a self-deadlock and a queued import starts only afterwards", async () => {
  const f = await fixture();
  f.hooks.flushGate = deferred();
  const exporting = f.transfers.export(false);
  await tick();
  assert.equal(f.events.includes("flush.start:A"), true);
  const importing = f.transfers.import(f.backupA);
  await tick();
  assert.equal(f.events.includes("editing.flush:A"), false);
  f.hooks.flushGate.resolve();
  let timer;
  try {
    await Promise.race([
      Promise.all([exporting, importing]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("export/direct-flush deadlock")), 1000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.ok(f.events.indexOf("export.snapshot:A") < f.events.indexOf("editing.flush:A"));
  assert.equal(f.state().backupBusy, false);
  assert.equal(f.state().importingBackup, false);
});
