import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
export const root = fileURLToPath(new URL("../", import.meta.url));
const tick = () => new Promise(setImmediate);
const hash = async (body) =>
  createHash("sha256")
    .update(Buffer.from(await body.arrayBuffer()))
    .digest("hex");
const backup = () => ({
  application: "personal-terminal",
  schemaVersion: 2,
  layout: { symbol: "SBER", timeframe: "1d", engine: "kline", chartSettings: { theme: "dark" } },
  watchlist: [],
  drawings: [],
  images: [],
  views: []
});
const indicator = () => ({
  schemaVersion: 1,
  id: "ema",
  definitionId: "ema",
  params: { length: 9, source: "close" },
  pane: { kind: "overlay" },
  visible: true,
  order: 0
});
function payload(kind) {
  const value = backup();
  if (kind === "envelope3") value.schemaVersion = 3;
  if (kind === "instance2") {
    const i = indicator();
    i.schemaVersion = 2;
    value.layout.technicalIndicators = [i];
  }
  if (kind === "style-key") {
    const i = indicator();
    i.styles = { value: { color: "#2962ff", width: 1, visible: true, colorMode: "auto" } };
    value.layout.technicalIndicators = [i];
  }
  if (kind === "unknown-keys") {
    value.futureRoot = "FUTURE-ROOT";
    value.layout.futureLayout = "FUTURE-LAYOUT";
  }
  return value;
}
function sourceLoader(root, overrides = {}, events = []) {
  const base = path.resolve(root, "src"),
    cache = new Map();
  function load(relative) {
    const file = path.resolve(base, relative).replace(/\.js$/, ".ts"),
      key = path.relative(base, file).replaceAll(path.sep, "/");
    assert.ok(file.startsWith(base + path.sep));
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      (specifier) => load(path.relative(base, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports
    );
    if (key === "model/backup-format.ts") {
      const validate = module.exports.validateBackup;
      module.exports.validateBackup = (value) => {
        events.push({
          op: "validateBackup",
          schema: value?.schemaVersion,
          hasFutureRoot: Object.hasOwn(value ?? {}, "futureRoot"),
          hasFutureLayout: Object.hasOwn(value?.layout ?? {}, "futureLayout")
        });
        return validate(value);
      };
    }
    return module.exports;
  }
  return load;
}
class Store {
  files = [];
  bodies = new Map();
  events = [];
  readHook;
  async list(kind) {
    this.events.push({ op: "list", kind });
    return this.files
      .filter((f) => f.appProperties.mtpKind === kind)
      .map((f) => structuredClone(f));
  }
  async read(file, max) {
    const body = this.bodies.get(file.id);
    assert.ok(body.size <= max);
    this.events.push({
      op: "read",
      kind: file.appProperties.mtpKind,
      id: file.id,
      bytes: body.size
    });
    await this.readHook?.(file);
    return body;
  }
  async seed(kind, key, sha, body) {
    const f = {
      id: crypto.randomUUID(),
      name: kind,
      size: body.size,
      appProperties: { mtpNamespace: "mtp-drive-v2", mtpKind: kind, mtpKey: key, mtpHash: sha }
    };
    this.files.push(f);
    this.bodies.set(f.id, body);
    return f;
  }
  async create(kind, key, sha, body) {
    this.events.push({ op: "UPLOAD", kind });
    return this.seed(kind, key, sha, body);
  }
  async snapshot(data, parents = [], protocol = 1) {
    const body = new Blob([JSON.stringify(data)], { type: "application/json" }),
      sha = await hash(body);
    const file = await this.seed("blob", sha, sha, body);
    const nodeId = crypto.randomUUID(),
      manifest = {
        protocol,
        nodeId,
        deviceId: crypto.randomUUID(),
        parents,
        createdAt: new Date().toISOString(),
        payload: { sha256: sha, size: body.size },
        images: []
      },
      manifestBody = new Blob([JSON.stringify(manifest)]);
    await this.seed("snapshot", nodeId, await hash(manifestBody), manifestBody);
    return { nodeId, payloadFile: file, manifest };
  }
}
async function harness(root, store, recordPatch = {}, automatic = false) {
  let local = backup(),
    state = {
      owner: "fake-profile",
      name: "Fixture",
      authenticated: true,
      chartRevision: 1,
      preferences: local.layout
    };
  const session = {},
    profile = { owner: "fake-profile", session, authenticated: true, blocked: false },
    events = [];
  const storage = {
    importBackup: async (owner, data, options) => {
      assert.ok(options.valid());
      events.push({ op: "LOCAL_WRITE", schema: data.schemaVersion });
      local = structuredClone(data);
      return { drawings: 0, images: 0, history: 0 };
    },
    loadWatchlist: async () => undefined
  };
  const load = sourceLoader(
    root,
    {
      "services/storage-v2.ts": storage,
      "services/chart-camera.ts": {
        resetSharedChartCamera: async () => {
          events.push({ op: "resetCamera" });
        }
      },
      "services/restore-recovery-journal.ts": {
        createNativeImportRecovery: owner => ({owner,operationId:crypto.randomUUID()}),
        beginRestoreRecovery: async (owner, preserve) => ({version:1,owner,operationId:"fixture-restore",mode:preserve?"shared-runtime":"import"}),
        completeRestoreRecovery: async () => {}
      }
    },
    events
  );
  const { DriveCoordinator } = load("services/drive/coordinator.ts"),
    { DriveSync } = load("services/drive/sync.ts"),
    { TerminalBackups } = load("screens/terminal/controller-backups.ts"),
    { driveBackupDigest } = load("services/drive/backup.ts");
  let record = {
    schemaVersion: 1,
    deviceId: crypto.randomUUID(),
    markerId: crypto.randomUUID(),
    baseHeads: [],
    automatic,
    ...recordPatch
  };
  const transfers = new TerminalBackups({
    getState: () => state,
    getClient: () => null,
    getChart: () => null,
    isAlive: () => true,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    notify: () => {},
    flush: async () => {},
    saveView: async () => {
      events.push({ op: "saveView" });
    },
    editing: {
      flush: async () => {
        events.push({ op: "editingFlush" });
      },
      reset: () => {}
    },
    resetHistory: () => {},
    loadHistory: async () => {},
    session: {
      matches: (value) => value === null,
      prepareProfile: async () => {},
      applyBankState: () => {}
    }
  });
  let authorization;
  const auth = {
    prepare: async () => {},
    restore: async () => undefined,
    suspend: () => authorization?.invalidate(),
    disconnect: async () => authorization?.invalidate(),
    connectFromUserGesture: () => {
      const abort = new AbortController();
      authorization = {
        connectionId: crypto.randomUUID(),
        signal: abort.signal,
        getAccessToken: () => "fake-in-memory-only",
        invalidate: () => abort.abort()
      };
      return Promise.resolve(authorization);
    }
  };
  const coordinator = new DriveCoordinator(
    {
      profile: () => profile,
      exportBackup: async () => {
        events.push({ op: "exportLocal" });
        return structuredClone(local);
      },
      importBackup: async (data, options) => {
        events.push({ op: "bridgeImport" });
        await transfers.import(data, options);
      }
    },
    {
      auth,
      online: () => true,
      sync: () => new DriveSync(store),
      load: async () => structuredClone(record),
      save: async (owner, value) => {
        events.push({
          op: "CHECKPOINT",
          heads: [...value.baseHeads],
          last: value.lastSyncedAt,
          digest: value.lastSyncedDigest
        });
        record = structuredClone(value);
      }
    }
  );
  coordinator.profileChanged();
  await tick();
  return {
    coordinator,
    events,
    store,
    load,
    transfers,
    digest: await driveBackupDigest(local),
    record: () => record,
    local: () => local,
    setLocal(value) {
      local = value;
    },
    async connect() {
      await coordinator.prepare();
      await coordinator.connect();
    },
    async automatic() {
      await new Promise((resolve, reject) => {
        let started = false;
        const unsubscribe = coordinator.subscribe(() => {
          const phase = coordinator.getSnapshot().phase;
          started ||= phase === "syncing";
          if (started && phase !== "syncing") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        });
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error("Automatic sync did not settle"));
        }, 10000);
        coordinator.localChanged();
      });
    },
    changeProfile(patch) {
      Object.assign(profile, patch);
      coordinator.profileChanged();
    },
    stop() {
      coordinator.disconnect();
    }
  };
}

export { tick, hash, backup, indicator, payload, sourceLoader, Store, harness };
