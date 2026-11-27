import test from "node:test";
import assert from "node:assert/strict";
import { flowModules, deferred, tick } from "./helpers/workspace-identity-flow.mjs";

function fixture(options = {}) {
  const load = flowModules(),
    { DriveCoordinator } = load("services/drive/coordinator.ts");
  const { driveBackupDigest } = load("services/drive/backup.ts");
  let profile = {
    owner: "device",
    cloudOwner: "legacy-google",
    session: {},
    authenticated: true,
    blocked: false,
    transition: false,
    ...options
  };
  const calls = [],
    abort = new AbortController(),
    hooks = {};
  const authorization = {
    connectionId: "stable",
    stored: true,
    signal: abort.signal,
    getAccessToken: () => "test-only",
    invalidate: () => abort.abort()
  };
  const backup = {
    application: "personal-terminal",
    schemaVersion: 2,
    layout: { engine: "kline", rangeDays: 180 },
    watchlist: [],
    drawings: [],
    images: [],
    views: []
  };
  let record = {
    schemaVersion: 1,
    deviceId: crypto.randomUUID(),
    markerId: crypto.randomUUID(),
    baseHeads: [],
    automatic: false,
    pendingChanges: false
  };
  const auth = {
    async prepare() {},
    async restore(owner) {
      calls.push(["restore", owner]);
      return authorization;
    },
    connectFromUserGesture(owner) {
      calls.push(["connect", owner]);
      return Promise.resolve(authorization);
    },
    suspend() {
      calls.push(["suspend"]);
    },
    async disconnect() {
      calls.push(["disconnect"]);
      abort.abort();
    }
  };
  let publishes = 0;
  const remote = {
    async inspect() {
      await hooks.inspect?.();
      return { snapshots: [], heads: [], conflict: false };
    },
    async publish(_backup, context) {
      context.checkBeforeWrite();
      publishes++;
      return {
        nodeId: crypto.randomUUID(),
        inspection: { snapshots: [], heads: [], conflict: false }
      };
    },
    async download() {
      throw new Error("Unexpected download");
    }
  };
  const coordinator = new DriveCoordinator(
    {
      profile: () => profile,
      async exportBackup() {
        await hooks.export?.();
        return backup;
      },
      async importBackup() {
        throw new Error("Unexpected import");
      }
    },
    {
      auth,
      sync: () => remote,
      load: async (owner) => {
        calls.push(["load", owner]);
        return record;
      },
      save: async (owner, next) => {
        calls.push(["save", owner]);
        record = next;
      }
    }
  );
  return {
    coordinator,
    calls,
    hooks,
    authorization,
    profile: () => profile,
    record: () => record,
    publishes: () => publishes,
    async ready() {
      coordinator.resume();
      while (!coordinator.getSnapshot().connected) await tick();
    },
    change(patch) {
      profile = { ...profile, ...patch };
      coordinator.profileChanged();
    },
    digest: () => driveBackupDigest(backup)
  };
}

test("selected legacy association and credential owner survive API transitions without renewing or disconnecting Google", async () => {
  const f = fixture();
  try {
    await f.ready();
    const identity = structuredClone(f.record()),
      signal = f.authorization.signal;
    for (let i = 0; i < 3; i++) {
      f.change({ transition: true, blocked: true });
      f.change({ transition: false, blocked: false });
    }
    await tick();
    assert.deepEqual(f.record(), identity);
    assert.deepEqual(
      f.calls.filter(([kind]) => kind === "restore"),
      [["restore", "legacy-google"]]
    );
    assert.equal(
      f.calls.some(([kind]) => kind === "disconnect"),
      false
    );
    assert.equal(signal.aborted, false);
    assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
    assert.equal(f.publishes(), 0);
    await f.coordinator.setAutomatic(false);
    assert.deepEqual(f.calls.at(-1), ["save", "legacy-google"]);
  } finally {
    f.coordinator.suspend();
  }
});

test("bank transition fences a pending Drive operation without invalidating its authorization", async () => {
  const f = fixture(),
    gate = deferred();
  try {
    await f.ready();
    let entered = false;
    f.hooks.inspect = async () => {
      entered = true;
      await gate.promise;
    };
    const sync = f.coordinator.sync();
    while (!entered) await tick();
    f.change({ blocked: true, transition: true });
    gate.resolve();
    await sync;
    assert.equal(f.publishes(), 0);
    assert.equal(f.authorization.signal.aborted, false);
    assert.equal(f.coordinator.getSnapshot().phase, "idle");
    assert.equal(f.coordinator.getSnapshot().connected, true);
    f.change({ blocked: false, transition: false });
  } finally {
    gate.resolve();
    f.coordinator.suspend();
  }
});

test("ambiguous legacy associations do not restore an arbitrary account; explicit connect uses device and keeps the history choice", async () => {
  const f = fixture({ cloudOwner: "device", associationConflict: true });
  try {
    f.coordinator.resume();
    await tick();
    assert.equal(
      f.calls.some(([kind]) => kind === "restore" || kind === "load"),
      false
    );
    await f.coordinator.prepare();
    await f.coordinator.connect();
    assert.deepEqual(
      f.calls.find(([kind]) => kind === "connect"),
      ["connect", "device"]
    );
    assert.equal(
      f.calls.some(([, owner]) => owner === "legacy-google"),
      false
    );
  } finally {
    f.coordinator.suspend();
  }
});

test("cloud association changes cancel stale restoration and never combine legacy heads", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.change({ cloudOwner: "other-account", associationConflict: true });
    assert.equal(f.coordinator.getSnapshot().connected, false);
    assert.equal(
      f.calls.some(([kind]) => kind === "disconnect"),
      false
    );
    assert.equal(f.calls.filter(([kind]) => kind === "restore").length, 1);
  } finally {
    f.coordinator.suspend();
  }
});

test("terminal Drive bridge uses a stable cloud session in both API/Google orders even without market readiness", () => {
  class DriveCoordinator {
    constructor(bridge) {
      this.bridge = bridge;
    }
  }
  const load = flowModules({
    "services/drive/coordinator.ts": { DriveCoordinator },
    // This legacy bridge never constructs the optional v3 retention provider.
    "services/drive/device-slot-provider.ts": { GoogleSlotProvider: class {} },
    "services/drive/auth.ts": { DriveAuth: class {} },
    "services/drive/sync.ts": { DriveSync: class {} },
    "services/drive/transport.ts": { DriveTransport: class {} },
    "services/drive/local.ts": { loadDriveRecord() {}, saveDriveRecord() {} }
  });
  const { terminalDrive } = load("screens/terminal/controller-drive.ts");
  for (const bankFirst of [false, true]) {
    const cloudSession = {},
      binding = { owner: "device", cloudOwner: "legacy-google", conflicts: [] };
    let market = {},
      state = { owner: "device", authenticated: bankFirst, marketReady: false };
    const controller = {
      getSnapshot: () => state,
      sessionKey: () => market,
      cloudSessionKey: () => cloudSession,
      workspaceBinding: () => binding
    };
    const drive = terminalDrive(controller),
      initial = drive.bridge.profile();
    assert.equal(initial.authenticated, true);
    assert.equal(initial.cloudOwner, "legacy-google");
    assert.equal(initial.session, cloudSession);
    market = {};
    state = { ...state, authenticated: !bankFirst, marketReady: true, profileTransition: true };
    const transition = drive.bridge.profile();
    assert.equal(transition.session, initial.session);
    assert.equal(transition.cloudOwner, initial.cloudOwner);
    assert.equal(transition.transition, true);
    assert.equal(transition.blocked, true);
    state = { ...state, profileTransition: false, authenticated: false };
    assert.equal(drive.bridge.profile().authenticated, true);
  }
});
