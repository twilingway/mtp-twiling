import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const unreachableStorage = () => assert.fail("Must use injected local storage");
const load = sourceLoader({
  "services/storage-db.ts": {
    get: unreachableStorage,
    put: unreachableStorage,
    transaction: unreachableStorage
  }
});
const { GoogleSlotProvider } = load("services/drive/device-slot-provider.ts");
const { sanitizeLocalDriveBackup } = load("services/drive/reader-guard.ts");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const device = {
  owner: "device",
  cloudOwner: "legacy-google-owner",
  session: {},
  associationConflict: false,
  ready: true,
  blocked: false,
  revision: 0
};
const create = (options = {}) => {
  let state = {
    schemaVersion: 3,
    generation: 0,
    automatic: false,
    mode: "normal",
    baseHeads: [],
    enabled: options.enabled,
    ...(options.pending ? { pending: options.pending } : {})
  };
  const calls = [];
  const signals = [];
  const live = () => {
    const abort = new AbortController();
    signals.push(abort);
    return { signal: abort.signal, stored: true };
  };
  const host = {
    scope: () => device,
    capture: async () => {
      calls.push("capture");
      assert.fail("capture was unexpected");
    },
    apply: async () => assert.fail()
  };
  const provider = new GoogleSlotProvider(host, {
    auth: {
      prepare: async () => {
        calls.push("prepare");
      },
      restore: async (owner) => {
        calls.push(["restore", owner]);
        return options.restore ? options.restore(live) : undefined;
      },
      suspend: () => {
        for (const abort of signals) abort.abort();
      },
      connectFromUserGesture: async () => {
        calls.push("popup");
        return live();
      },
      forgetOwner: async (owner) => {
        calls.push(["forget", owner]);
      }
    },
    load: async () => state,
    save: async (_owner, prior, patch, signal) => {
      signal.throwIfAborted();
      assert.equal(prior.generation, state.generation);
      state = { ...state, ...patch, generation: state.generation + 1 };
      return state;
    },
    hasHistory: async () => !!options.hasHistory,
    fetch: async () => {
      calls.push("network");
      assert.fail("network was unexpected");
    },
    online: () => true
  });
  return { provider, calls, state: () => state };
};

test("a legacy inert record remains off and preference changes do not start Google requests", async () => {
  const { provider, calls } = create();
  provider.resume();
  await provider.prepare();
  provider.localChanged();
  await provider.sync();
  assert.deepEqual(calls, [["restore", device.cloudOwner]]);
  assert.equal(provider.getSnapshot().phase, "disabled");
  assert.equal(provider.getSnapshot().pendingChanges, false);
  provider.dispose();
});

test("Google shared client-mode alias preserves the saved choice, authorization and back-compatible mode field", async () => {
  const f = create({ enabled: true });
  try {
    f.provider.resume();
    await f.provider.prepare();
    const calls = structuredClone(f.calls);
    assert.equal(f.provider.getSnapshot().clientMode, "normal");
    await f.provider.setClientMode("test");
    assert.equal(f.provider.getSnapshot().clientMode, "test");
    assert.equal(f.provider.getSnapshot().mode, "test");
    assert.equal(f.provider.getSnapshot().clientLabel, "Тестирование");
    assert.equal(f.state().mode, "test");
    assert.deepEqual(f.calls, calls);
    await f.provider.setSlotMode("normal");
    assert.equal(f.provider.getSnapshot().clientMode, "normal");
    assert.equal(f.provider.getSnapshot().clientLabel, "Этот браузер");
    const blocked = create({ enabled: true, pending: { unknown: true } });
    try {
      blocked.provider.resume();
      await blocked.provider.prepare();
      await blocked.provider.setClientMode("test");
      assert.equal(blocked.state().mode, "normal");
      assert.deepEqual(blocked.state().pending, { unknown: true });
    } finally {
      blocked.provider.dispose();
    }
  } finally {
    f.provider.dispose();
  }
});

test("disposing a Google binding permits remount and stale uninstall cannot remove the new instance", () => {
  const {
    createTerminalGoogleSync,
    installTerminalGoogleSync,
    terminalGoogleRetention,
    uninstallTerminalGoogleSync
  } = load("screens/terminal/controller-drive.ts");
  const controller = {};
  const host = {
    scope: () => ({ ...device, ready: false }),
    capture: unreachableStorage,
    apply: unreachableStorage
  };
  const first = createTerminalGoogleSync(host);
  const replacement = createTerminalGoogleSync(host);
  installTerminalGoogleSync(controller, first);
  uninstallTerminalGoogleSync(controller, replacement);
  assert.equal(terminalGoogleRetention(controller), first);
  assert.throws(() => installTerminalGoogleSync(controller, replacement), /already installed/);

  first.dispose();
  uninstallTerminalGoogleSync(controller, first);
  assert.equal(terminalGoogleRetention(controller), undefined);
  installTerminalGoogleSync(controller, replacement);
  uninstallTerminalGoogleSync(controller, first);
  assert.equal(terminalGoogleRetention(controller), replacement);
  replacement.dispose();
  uninstallTerminalGoogleSync(controller, replacement);
});

test("disable invalidates a late saved connection, keeps the credential and hides warnings", async () => {
  let complete;
  const waiting = new Promise((resolve) => {
    complete = resolve;
  });
  const { provider, calls, state } = create({
    restore: async (live) => {
      const result = live();
      await waiting;
      return result;
    }
  });
  provider.resume();
  await tick();
  await provider.setEnabled(false);
  complete();
  await tick();
  await provider.prepare();
  await provider.sync();
  assert.equal(state().enabled, false);
  assert.equal(provider.getSnapshot().phase, "disabled");
  assert.equal(provider.getSnapshot().connected, false);
  assert.deepEqual(calls, [["restore", device.cloudOwner]]);
  provider.dispose();
});

test("existing linked legacy history remains enabled and forgetting affects just its alias", async () => {
  const { provider, calls } = create({ hasHistory: true });
  provider.resume();
  await provider.prepare();
  assert.equal(provider.getSnapshot().enabled, true);
  assert.equal(provider.getSnapshot().prepared, true);
  await provider.disconnect();
  assert.deepEqual(calls, [
    ["restore", device.cloudOwner],
    "prepare",
    ["forget", device.cloudOwner]
  ]);
  assert.equal(provider.getSnapshot().phase, "disabled");
  provider.dispose();
});

test("cloud capture strips the documented local fields and rejects unsupported portable data", () => {
  const input = {
    application: "personal-terminal",
    schemaVersion: 2,
    owner: "device",
    history: [],
    layout: { symbol: "SBER" },
    watchlist: [
      {
        symbol: "SBER",
        name: "Sber",
        uid: "instrument",
        price: 10,
        change: 0,
        availability: "available"
      }
    ],
    drawings: [],
    images: [],
    views: []
  };
  const backup = sanitizeLocalDriveBackup(input);
  assert.equal(backup.owner, undefined);
  assert.equal(backup.history, undefined);
  assert.equal(backup.watchlist[0].price, undefined);
  assert.equal(backup.watchlist[0].uid, "instrument");
  assert.throws(() => sanitizeLocalDriveBackup({ ...input, futurePortable: true }), {
    code: "unsupported-format"
  });
  assert.throws(() => sanitizeLocalDriveBackup({ ...input, history: [{}] }), {
    code: "unsupported-format"
  });
});
