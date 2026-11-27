import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, config, localBackend, deferred } from "./helpers/yandex-source.mjs";
import { diskFixture } from "./helpers/yandex-disk.mjs";

const load = sourceLoader(),
  { YandexCoordinator } = load("services/yandex/coordinator.ts"),
  { YandexJournal } = load("services/yandex/journal.ts"),
  { encodeBundle, revisionName } = load("services/yandex/bundle.ts"),
  { prepareDriveBackup, restoreDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
const payloadDigest = async (payload) => driveBackupDigest(JSON.parse(await payload.text()));
async function fixture(enabled = true) {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    disk = diskFixture();
  await journal.saveSettings({ enabled, automatic: false }, new AbortController().signal);
  let revision = 0,
    applies = 0,
    restore = 0,
    callbacks = 0;
  let backup = {
    application: "personal-terminal",
    schemaVersion: 2,
    drawings: [],
    images: [],
    layout: { timeframe: "1d" }
  };
  const auth = {
    begin: async () => {},
    restore: async () => {
      restore++;
      return disk.auth;
    },
    completeCallback: async () => {
      callbacks++;
      return undefined;
    },
    suspend: () => {},
    disconnect: async () => {}
  };
  const session = {},
    host = {
      scope: () => ({
        owner: "device",
        cloudOwner: "device",
        ready: true,
        blocked: false,
        associationConflict: false,
        revision,
        session
      }),
      capture: async () => {
        const payload = new Blob([JSON.stringify(backup)]);
        return {
          backup: structuredClone(backup),
          prepared: await prepareDriveBackup(backup),
          digest: await payloadDigest(payload),
          revision
        };
      },
      decode: async (prepared) =>
        restoreDriveBackup(
          prepared.payload,
          prepared.images.map(({ body }) => body)
        ),
      apply: async (_, value, expected, guard, committed) => {
        assert.equal(guard.isCurrent(), true);
        assert.equal(expected, revision);
        guard.signal.throwIfAborted();
        applies++;
        backup = structuredClone(value);
        revision++;
        committed(revision);
      }
    };
  const options = {
    auth,
    journal,
    transport: (authorization) =>
      new (load("services/yandex/transport.ts").YandexTransport)(authorization, {
        fetch: disk.fetcher,
        sleep: async () => {},
        timeoutMs: 100
      }),
    lock: async (_, run) => run()
  };
  const make = () => new YandexCoordinator(host, config, options),
    coordinator = make();
  return {
    coordinator,
    make,
    backend,
    journal,
    disk,
    auth,
    host,
    restore: () => restore,
    callbacks: () => callbacks,
    applies: () => applies,
    edit: (timeframe = "1h") => {
      revision++;
      backup.layout.timeframe = timeframe;
    },
    revision: () => revision
  };
}
async function seedRemote(f) {
  const payload = new Blob([
    JSON.stringify({
      application: "personal-terminal",
      schemaVersion: 2,
      drawings: [],
      images: [],
      layout: { timeframe: "5m" }
    })
  ]);
  const encoded = await encodeBundle(
    { payload, images: [] },
    {
      revisionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      parents: [],
      createdAt: new Date().toISOString(),
      digest: await payloadDigest(payload)
    }
  );
  f.disk.files.set(revisionName(encoded.revision), encoded.body);
  return encoded.revision;
}
async function advancePeerSlots(f, intervals) {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    transport = new (load("services/yandex/transport.ts").YandexTransport)(f.disk.auth, {
      fetch: f.disk.fetcher,
      sleep: async () => {},
      timeoutMs: 5000
    }),
    revisions = new (load("services/yandex/revisions.ts").YandexRevisions)(
      transport, journal, f.disk.auth, config.clientId
    );
  await journal.saveSettings(
    { enabled: true, automatic: false, clientMode: "test" }, new AbortController().signal
  );
  for (const timeframe of intervals) {
    const value = {
      application: "personal-terminal", schemaVersion: 2, drawings: [], images: [], layout: { timeframe }
    };
    const before = await revisions.inspect(() => true);
    await revisions.publish(
      await prepareDriveBackup(value), await driveBackupDigest(value), before.heads, () => true, true
    );
    await journal.clearPending(config.clientId, f.disk.auth.accountId, f.disk.auth.signal);
  }
  return revisions.inspect(() => true);
}

async function committedPendingDraft(f) {
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "local" });
  for (const timeframe of ["5m", "15m", "30m"]) {
    f.edit(timeframe); f.coordinator.localIntent(); await f.coordinator.sync();
  }
  const base = await f.journal.association(config.clientId, f.disk.auth.accountId),
    fetcher = f.disk.fetcher;
  let fenced = false;
  f.disk.fetcher = async (target, init) => {
    const response = await fetcher(target, init), url = new URL(target);
    if (!fenced && url.pathname.endsWith("/move") && url.searchParams.get("path")?.includes("/slot_")) {
      fenced = true;
      f.edit("4h"); f.coordinator.localIntent();
    }
    return response;
  };
  try { f.edit("1h"); f.coordinator.localIntent(); await f.coordinator.sync(); }
  finally { f.disk.fetcher = fetcher; }
  const pending = await f.journal.pending(config.clientId, f.disk.auth.accountId);
  assert.equal(fenced, true);
  assert.ok(pending);
  assert.equal(f.disk.puts(), 5);
  assert.deepEqual((await f.journal.association(config.clientId, f.disk.auth.accountId)).heads, base.heads);
  assert.notEqual((await f.host.capture()).digest, pending.revision.digest);
  return { base, pending, fetcher };
}

test("a committed pending fifth snapshot becomes only a baseline while the sixth local draft publishes once", async () => {
  const f = await fixture();
  try {
    const { pending } = await committedPendingDraft(f);
    const observed = [];
    const stop = f.coordinator.subscribe(() => {
      const value = f.coordinator.getSnapshot();
      observed.push({ ...value });
    });
    await f.coordinator.sync(); stop();
    assert.equal(f.disk.puts(), 6);
    assert.equal(f.applies(), 0);
    assert.equal(f.coordinator.getSnapshot().phase, "idle");
    assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
    assert.equal((await f.host.capture()).backup.layout.timeframe, "4h");
    const association = await f.journal.association(config.clientId, f.disk.auth.accountId);
    assert.notEqual(association.heads[0], pending.revision.revisionId);
    assert.equal(association.digest, (await f.host.capture()).digest);
    assert.equal(await f.journal.pending(config.clientId, f.disk.auth.accountId), undefined);
    assert.ok(observed.some(({ phase, pendingChanges, choiceAction }) =>
      phase === "syncing" && pendingChanges === true && choiceAction === undefined));
    await f.coordinator.sync();
    assert.equal(f.disk.puts(), 6);
    assert.equal(f.coordinator.getSnapshot().conflict, undefined);
  } finally { f.coordinator.dispose(); }
});

for (const failure of ["baseline", "clear", "publish-six"]) {
  test(`confirmed pending recovery remains retryable after ${failure} failure and never marks draft six synced`, async () => {
    const f = await fixture();
    try {
      const { base, pending, fetcher } = await committedPendingDraft(f),
        accept = f.journal.accept.bind(f.journal), clear = f.journal.clearPending.bind(f.journal),
        previousChoice = f.coordinator.getSnapshot().choiceAction;
      if (failure === "baseline") f.journal.accept = async () => { throw new Error("local-save"); };
      if (failure === "clear") f.journal.clearPending = async () => { throw new Error("local-save"); };
      if (failure === "publish-six") f.disk.fetcher = async (target, init) =>
        new URL(target).hostname.startsWith("uploader") && !new URL(target).searchParams.get("name")?.startsWith("probe_")
          ? new Response(null, { status: 503 }) : fetcher(target, init);
      await f.coordinator.sync();
      assert.equal(f.coordinator.getSnapshot().pendingChanges, true);
      if (failure === "baseline") assert.equal(f.coordinator.getSnapshot().choiceAction, previousChoice);
      else assert.notEqual(f.coordinator.getSnapshot().choiceAction?.state, "confirmed");
      assert.equal(f.applies(), 0);
      assert.equal((await f.host.capture()).backup.layout.timeframe, "4h");
      const association = await f.journal.association(config.clientId, f.disk.auth.accountId);
      assert.deepEqual(association.heads, failure === "baseline" ? base.heads : [pending.revision.revisionId]);
      assert.notEqual(association.digest, (await f.host.capture()).digest);
      f.journal.accept = accept; f.journal.clearPending = clear; f.disk.fetcher = fetcher;
      await f.coordinator.sync();
      assert.equal(f.disk.puts(), 6);
      assert.equal(f.coordinator.getSnapshot().phase, "idle");
      assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
    } finally { f.coordinator.dispose(); }
  });
}

for (const mismatch of ["generation", "device", "mode", "account", "body", "head", "local-edit"]) {
  test(`pending recovery refuses ${mismatch} mismatch without retiring the old journal or importing`, async () => {
    const f = await fixture();
    try {
      const { base, pending } = await committedPendingDraft(f);
      if (mismatch === "generation") await f.journal.savePending(config.clientId,
        { ...pending, credentialGeneration: "different-generation" }, f.disk.auth.signal);
      if (mismatch === "device") f.backend.records.set("mtp:yandex:device:device-id", crypto.randomUUID());
      if (mismatch === "mode") await f.journal.saveSettings(
        { enabled: true, automatic: false, clientMode: "test" }, f.disk.auth.signal);
      if (mismatch === "account") {
        const key = `mtp:yandex:device:${config.clientId}:${f.disk.auth.accountId}:pending`;
        f.backend.records.set(key, { ...pending, accountId: "456" });
      }
      if (mismatch === "head") await seedRemote(f);
      if (mismatch === "body") {
        const [name, body] = [...f.disk.files].find(([name]) => name.endsWith("_5.mtp"));
        const bytes = new Uint8Array(await body.arrayBuffer());
        bytes[await load("services/yandex/slot-codec.ts").slotHeaderSize(body)] ^= 1;
        f.disk.files.set(name, new Blob([bytes]));
      }
      if (mismatch === "local-edit") {
        const fetcher = f.disk.fetcher;
        f.disk.fetcher = async (target, init) => {
          const response = await fetcher(target, init);
          if (new URL(target).hostname.startsWith("downloader") && !new Headers(init.headers).has("Range"))
            f.edit("1w");
          return response;
        };
      }
      const puts = f.disk.puts(), before = new Map(f.backend.records);
      await f.coordinator.sync();
      assert.equal(f.disk.puts(), puts);
      assert.equal(f.applies(), 0);
      assert.deepEqual(await f.journal.association(config.clientId, f.disk.auth.accountId), base);
      assert.deepEqual([...f.backend.records], [...before]);
    } finally { f.coordinator.dispose(); }
  });
}

test("inspection and a stale explicit selection never consume an exactly committed pending publication", async () => {
  const f = await fixture();
  try {
    const { base, pending } = await committedPendingDraft(f), before = new Map(f.backend.records);
    await f.coordinator.inspect();
    f.edit("1w"); f.coordinator.localIntent();
    await f.coordinator.choose({ kind: "local" });
    assert.equal(f.disk.puts(), 5);
    assert.equal(f.applies(), 0);
    assert.deepEqual([...f.backend.records], [...before]);
    assert.deepEqual(await f.journal.association(config.clientId, f.disk.auth.accountId), base);
    assert.equal((await f.journal.pending(config.clientId, f.disk.auth.accountId)).revision.revisionId, pending.revision.revisionId);
  } finally { f.coordinator.dispose(); }
});

for (const sameContent of [true, false]) {
  test(`verified slot ancestry advances a stale association after pruning (${sameContent ? "same" : "changed"} content) without repeated conflict or upload`, async () => {
    const f = await fixture();
    try {
      await f.coordinator.prepare();
      await f.coordinator.sync();
      await f.coordinator.choose({ kind: "local" });
      const base = await f.journal.association(config.clientId, f.disk.auth.accountId);
      const remote = await advancePeerSlots(f, ["5m", "15m", "30m", sameContent ? "1d" : "1h"]);
      const head = remote.remotes.find(({ revision }) => revision.revisionId === remote.heads[0]);
      assert.equal(remote.heads.length, 1);
      assert.ok(head.slot.accepted.some(({ revisionId }) => revisionId === base.heads[0]));
      const puts = f.disk.puts();
      f.coordinator.localIntent();
      await f.coordinator.sync();
      await f.coordinator.sync();
      assert.equal(f.coordinator.getSnapshot().phase, "idle");
      assert.equal(f.coordinator.getSnapshot().conflict, undefined);
      assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
      assert.equal(f.disk.puts(), puts);
      assert.equal(f.applies(), sameContent ? 0 : 1);
      assert.deepEqual((await f.journal.association(config.clientId, f.disk.auth.accountId)).heads, remote.heads);
    } finally { f.coordinator.dispose(); }
  });
}

test("slot ancestry never replaces local edits", async () => {
  const f = await fixture();
  try {
    await f.coordinator.prepare();
    await f.coordinator.sync();
    await f.coordinator.choose({ kind: "local" });
    const base = await f.journal.association(config.clientId, f.disk.auth.accountId);
    await advancePeerSlots(f, ["5m", "15m", "30m", "1d"]);
    f.edit("4h");
    f.coordinator.localIntent();
    const puts = f.disk.puts();
    await f.coordinator.sync();
    assert.equal(f.coordinator.getSnapshot().phase, "conflict");
    assert.equal(f.coordinator.getSnapshot().pendingChanges, true);
    assert.equal(f.applies(), 0);
    assert.equal(f.disk.puts(), puts);
    assert.deepEqual((await f.journal.association(config.clientId, f.disk.auth.accountId)).heads, base.heads);
  } finally { f.coordinator.dispose(); }
});

for (const change of ["local", "cloud", "body"]) {
  test(`same-content slot ancestry revalidates ${change} before accepting an association`, async () => {
    const f = await fixture();
    try {
      await f.coordinator.prepare();
      await f.coordinator.sync();
      await f.coordinator.choose({ kind: "local" });
      const base = await f.journal.association(config.clientId, f.disk.auth.accountId);
      await advancePeerSlots(f, ["5m", "15m", "30m", "1d"]);
      const decode = f.host.decode;
      f.host.decode = async (prepared) => {
        const backup = await decode(prepared);
        if (change === "local") f.edit("4h");
        else if (change === "cloud") await seedRemote(f);
        else backup.layout.timeframe = "4h";
        return backup;
      };
      const puts = f.disk.puts();
      await f.coordinator.sync();
      assert.equal(f.coordinator.getSnapshot().error, change === "body" ? "remote-invalid" : "local-changed");
      assert.equal(f.disk.puts(), puts);
      assert.equal(f.applies(), 0);
      assert.deepEqual(await f.journal.association(config.clientId, f.disk.auth.accountId), base);
    } finally { f.coordinator.dispose(); }
  });
}

test("matching inspected head content repairs a stale association digest by readback without upload", async () => {
  const f = await fixture();
  try {
    await f.coordinator.prepare();
    await f.coordinator.sync();
    await f.coordinator.choose({ kind: "local" });
    const base = await f.journal.association(config.clientId, f.disk.auth.accountId);
    await f.journal.accept(config.clientId, { ...base, digest: "a".repeat(64) }, f.disk.auth.signal);
    const puts = f.disk.puts();
    await f.coordinator.sync();
    assert.equal(f.coordinator.getSnapshot().phase, "idle");
    assert.equal(f.disk.puts(), puts);
    assert.equal(f.applies(), 0);
    assert.equal((await f.journal.association(config.clientId, f.disk.auth.accountId)).digest, base.digest);
  } finally { f.coordinator.dispose(); }
});

test("an unknown same-content head still requires direction and inspection creates no browser identity", async () => {
  const f = await fixture();
  try {
    await seedRemote(f);
    f.edit("5m");
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    assert.equal(f.backend.records.has("mtp:yandex:device:device-id"), false);
    await f.coordinator.sync();
    assert.equal(f.coordinator.getSnapshot().phase, "conflict");
    assert.equal(await f.journal.association(config.clientId, f.disk.auth.accountId), undefined);
    assert.equal(f.applies(), 0);
    assert.equal(f.disk.puts(), 0);
  } finally { f.coordinator.dispose(); }
});

test("a disabled preference from another tab fences a stale enabled writer inside its lock", async () => {
  const f = await fixture(), other = f.make();
  try {
    await f.coordinator.prepare();
    await other.prepare();
    await f.coordinator.sync();
    await f.coordinator.choose({ kind: "local" });
    await f.coordinator.setEnabled(false);
    assert.equal(other.getSnapshot().enabled, true);
    f.edit("5m");
    other.localIntent();
    const calls = f.disk.calls.length, puts = f.disk.puts();
    await other.sync();
    assert.equal(other.getSnapshot().enabled, false);
    assert.equal(other.getSnapshot().phase, "disabled");
    assert.equal(f.disk.calls.length, calls);
    assert.equal(f.disk.puts(), puts);
    assert.equal((await f.journal.settings()).enabled, false);
  } finally { f.coordinator.dispose(); other.dispose(); }
});

for (const change of ["disabled", "mode"]) {
  for (const cleanup of [false, true]) {
    test(`a stale synthetic probe (${change}, cleanup=${cleanup}) reads settings under the writer lock before any transport`, async () => {
      const f = await fixture(), other = f.make(), fetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("Unexpected synthetic transport"); };
      try {
        await f.coordinator.prepare();
        await other.prepare();
        const queued = deferred(), release = deferred();
        other.lock = async (_authorization, run) => {
          queued.resolve();
          await release.promise;
          return run();
        };
        const rejected = assert.rejects(other.runSyntheticProbe(cleanup), { code: "local-changed" });
        await queued.promise;
        if (change === "disabled") await f.coordinator.setEnabled(false);
        else await f.coordinator.setClientMode("test");
        assert.equal(other.getSnapshot().enabled, true);
        assert.equal(other.getSnapshot().clientMode, "normal");
        release.resolve();
        await rejected;
        assert.equal(calls, 0);
        assert.equal(f.disk.calls.length, 0);
        assert.equal(f.disk.files.size, 0);
      } finally {
        f.coordinator.dispose(); other.dispose(); globalThis.fetch = fetch;
      }
    });
  }
}

test("unrelated preference writes preserve another tab's disabled and automatic choices", async () => {
  const f = await fixture(), other = f.make();
  try {
    await f.coordinator.prepare();
    await other.prepare();
    await other.setEnabled(true);
    await f.coordinator.setEnabled(false);
    await other.setAutomatic(true);
    assert.deepEqual(await f.journal.settings(), { enabled: false, automatic: true, clientMode: "normal" });
    assert.equal(other.getSnapshot().enabled, false);
    await f.coordinator.setAutomatic(false);
    await other.setEnabled(true);
    assert.deepEqual(await f.journal.settings(), { enabled: true, automatic: false, clientMode: "normal" });
  } finally { f.coordinator.dispose(); other.dispose(); }
});

test("a stale automatic job adopts the other tab's opt-out while explicit manual sync remains available", async () => {
  const f = await fixture(), other = f.make(),
    jobs = new Map(), timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  let sequence = 0;
  globalThis.setTimeout = (run, delay, ...args) => {
    if (delay !== 750) return timeout(run, delay, ...args);
    const id = { job: ++sequence };
    jobs.set(id, () => run(...args));
    return id;
  };
  globalThis.clearTimeout = (id) => { if (!jobs.delete(id)) clear(id); };
  try {
    await f.coordinator.prepare();
    await other.prepare();
    await f.coordinator.sync();
    await f.coordinator.choose({ kind: "local" });
    await other.setAutomatic(true);
    await f.coordinator.setAutomatic(false);
    f.edit("5m");
    other.localIntent();
    const calls = f.disk.calls.length, puts = f.disk.puts();
    const pending = [...jobs.values()]; jobs.clear();
    assert.equal(pending.length, 1);
    for (const run of pending) run();
    for (let i = 0; i < 10; i++) await new Promise(setImmediate);
    assert.equal(other.getSnapshot().automatic, false);
    assert.equal(other.getSnapshot().phase, "idle");
    assert.equal(f.disk.calls.length, calls);
    assert.equal(f.disk.puts(), puts);
    await other.sync();
    assert.equal(other.getSnapshot().phase, "idle");
    assert.equal(f.disk.puts(), puts + 1);
  } finally {
    f.coordinator.dispose(); other.dispose();
    globalThis.setTimeout = timeout; globalThis.clearTimeout = clear;
  }
});

test("client mode persists across reload, clears only previews and preserves OAuth and automatic preferences", async () => {
  const f = await fixture();
  try {
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    const before = f.coordinator.getSnapshot(),
      restores = f.restore(),
      callbacks = f.callbacks();
    const signal = f.disk.auth.signal;
    assert.ok(before.comparison);
    const normal = await f.journal.deviceId();
    await f.coordinator.setClientMode("test");
    const after = f.coordinator.getSnapshot();
    assert.equal(after.clientMode, "test");
    assert.equal(after.clientLabel, "Тестирование");
    assert.equal(after.comparison, undefined);
    assert.equal(after.conflict, undefined);
    assert.equal(after.automatic, before.automatic);
    assert.equal(after.enabled, before.enabled);
    assert.equal(after.connected, true);
    assert.equal(f.restore(), restores);
    assert.equal(f.callbacks(), callbacks);
    assert.equal(signal.aborted, false);
    assert.equal(f.disk.puts(), 0);
    assert.equal(await f.journal.deviceId(), "00000000-0000-4000-8000-000000000001");
    await f.coordinator.setAutomatic(true);
    assert.equal((await f.journal.settings()).clientMode, "test");
    await f.coordinator.setAutomatic(false);
    const reopened = f.make();
    try {
      await reopened.prepare();
      assert.equal(reopened.getSnapshot().clientMode, "test");
      await reopened.setClientMode("normal");
      assert.equal(await f.journal.deviceId(), normal);
      assert.equal(reopened.getSnapshot().connected, true);
    } finally {
      reopened.dispose();
    }
  } finally {
    f.coordinator.dispose();
  }
});

test("a client mode change never discards a durable unresolved apply operation", async () => {
  const f = await fixture();
  try {
    await f.coordinator.prepare();
    const intent = {
      version: 1,
      operationId: crypto.randomUUID(),
      accountId: f.disk.auth.accountId,
      credentialGeneration: f.disk.auth.credentialGeneration,
      targetId: crypto.randomUUID(),
      heads: [],
      digest: "a".repeat(64)
    };
    await f.journal.saveApplyIntent(config.clientId, intent, new AbortController().signal);
    await assert.rejects(f.coordinator.setClientMode("test"), { code: "indeterminate" });
    assert.equal(f.coordinator.getSnapshot().clientMode, "normal");
    assert.equal((await f.journal.settings()).clientMode, "normal");
    assert.deepEqual(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId), intent);
    assert.equal(f.disk.auth.signal.aborted, false);
    assert.equal(f.disk.puts(), 0);
  } finally {
    f.coordinator.dispose();
  }
});
test("failed client-mode persistence cannot be adopted by a later unrelated preference write", async () => {
  const f = await fixture();
  try {
    await f.coordinator.prepare();
    const save = f.journal.saveSettings.bind(f.journal);
    f.journal.saveSettings = async () => {
      throw new DOMException("synthetic full", "QuotaExceededError");
    };
    await assert.rejects(f.coordinator.setClientMode("test"), { code: "local-save" });
    assert.equal(f.coordinator.getSnapshot().clientMode, "normal");
    f.journal.saveSettings = save;
    await f.coordinator.setAutomatic(true);
    assert.equal((await f.journal.settings()).clientMode, "normal");
    assert.equal(f.coordinator.getSnapshot().clientMode, "normal");
    assert.equal(f.disk.auth.signal.aborted, false);
    const saved = await f.journal.settings();
    await f.journal.saveSettings({ ...saved, clientMode: "test" }, new AbortController().signal);
    await f.coordinator.setAutomatic(false);
    assert.equal(
      (await f.journal.settings()).clientMode,
      "test",
      "an unrelated preference preserves another tab's explicit choice"
    );
    assert.equal(f.coordinator.getSnapshot().clientMode, "test");
  } finally {
    f.coordinator.dispose();
  }
});
test("a different tab's client-mode choice fences an old comparison before any transfer", async () => {
  const f = await fixture();
  try {
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    assert.ok(f.coordinator.getSnapshot().comparison);
    const settings = await f.journal.settings();
    await f.journal.saveSettings({ ...settings, clientMode: "test" }, new AbortController().signal);
    await f.coordinator.choose({ kind: "local" });
    assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
    assert.equal(f.coordinator.getSnapshot().error, "local-changed");
    assert.equal(f.disk.puts(), 0);
    assert.equal(f.applies(), 0);
    await f.coordinator.setClientMode("test");
    assert.equal(f.coordinator.getSnapshot().clientMode, "test");
    assert.equal(f.coordinator.getSnapshot().comparison, undefined);
    assert.equal(f.disk.auth.signal.aborted, false);
    await f.journal.saveSettings(
      { ...settings, clientMode: "normal" },
      new AbortController().signal
    );
    await f.coordinator.setAutomatic(true);
    assert.equal((await f.journal.settings()).clientMode, "normal");
    assert.equal(f.coordinator.getSnapshot().clientMode, "normal");
  } finally {
    f.coordinator.dispose();
  }
});
test("disabled reload prepares local state without auth/network and ignores sync/choose", async () => {
  const f = await fixture(false);
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "local" });
  assert.equal(f.restore(), 0);
  assert.equal(f.callbacks(), 0);
  assert.equal(f.disk.calls.length, 0);
  assert.equal(f.coordinator.getSnapshot().phase, "disabled");
  assert.equal(f.coordinator.getSnapshot().error, undefined);
  f.coordinator.dispose();
});
test("missing public config is honest and never launches OAuth or transport", async () => {
  const f = await fixture(),
    c = new YandexCoordinator(f.host, undefined, { auth: f.auth, journal: f.journal });
  await c.prepare();
  await c.connectFromUserGesture();
  assert.equal(c.getSnapshot().configured, false);
  assert.equal(c.getSnapshot().error, "configuration-required");
  assert.equal(f.restore(), 0);
  c.dispose();
  f.coordinator.dispose();
});
test("unknown empty account requires direction before verified publish, next sync is idempotent", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "conflict");
  assert.equal(f.disk.puts(), 0);
  await f.coordinator.choose({ kind: "local" });
  assert.equal(f.coordinator.getSnapshot().phase, "idle");
  assert.equal(f.disk.puts(), 1);
  assert.equal(await f.journal.pending(config.clientId, f.disk.auth.accountId), undefined);
  const association = await f.journal.association(config.clientId, f.disk.auth.accountId);
  assert.equal(association.heads.length, 1);
  await f.coordinator.sync();
  assert.equal(f.disk.puts(), 1);
  f.coordinator.dispose();
});
test("unknown cloud history requires explicit choice; remote commit receipt advances association at accepted revision", async () => {
  const f = await fixture(),
    payload = new Blob([
      JSON.stringify({
        application: "personal-terminal",
        schemaVersion: 2,
        drawings: [],
        images: [],
        layout: { timeframe: "5m" }
      })
    ]),
    encoded = await encodeBundle(
      { payload, images: [] },
      {
        revisionId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        parents: [],
        createdAt: new Date().toISOString(),
        digest: await payloadDigest(payload)
      }
    );
  f.disk.files.set(revisionName(encoded.revision), encoded.body);
  await f.coordinator.prepare();
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "conflict");
  assert.equal(f.applies(), 0);
  await f.coordinator.choose({ kind: "remote", id: encoded.revision.revisionId });
  assert.equal(f.applies(), 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
  assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
  assert.equal(f.disk.puts(), 0);
  f.coordinator.dispose();
});
test("portable edit invalidates previous remote preview before native mutation", async () => {
  const f = await fixture(),
    payload = (await f.host.capture()).prepared.payload,
    encoded = await encodeBundle(
      { payload, images: [] },
      {
        revisionId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        parents: [],
        createdAt: new Date().toISOString(),
        digest: await payloadDigest(payload)
      }
    );
  f.disk.files.set(revisionName(encoded.revision), encoded.body);
  await f.coordinator.prepare();
  await f.coordinator.sync();
  f.edit();
  f.coordinator.localIntent();
  await f.coordinator.choose({ kind: "remote", id: encoded.revision.revisionId });
  assert.equal(f.applies(), 0);
  assert.equal(f.coordinator.getSnapshot().error, "local-changed");
  f.coordinator.dispose();
});
test("disable during pending upload aborts transport and late response cannot accept or show error banner", async () => {
  const f = await fixture(),
    started = deferred(),
    finish = deferred();
  f.disk.hooks.before = async (url) => {
    if (url.hostname.startsWith("uploader")) {
      started.resolve();
      await finish.promise;
    }
  };
  await f.coordinator.prepare();
  await f.coordinator.sync();
  const running = f.coordinator.choose({ kind: "local" });
  await started.promise;
  await f.coordinator.setEnabled(false);
  finish.resolve();
  await running;
  assert.equal(f.coordinator.getSnapshot().phase, "disabled");
  assert.equal(f.coordinator.getSnapshot().error, undefined);
  assert.equal(await f.journal.association(config.clientId, f.disk.auth.accountId), undefined);
  assert.equal(f.applies(), 0);
  f.coordinator.dispose();
});
test("serialized preference writes honor last disable during delayed enable and produce no disabled banner", async () => {
  const f = await fixture(false);
  await f.coordinator.prepare();
  const original = f.journal.saveSettings.bind(f.journal),
    started = deferred(),
    finish = deferred();
  let count = 0;
  f.journal.saveSettings = async (...args) => {
    if (++count === 1) {
      started.resolve();
      await finish.promise;
    }
    return original(...args);
  };
  const enabling = f.coordinator.setEnabled(true);
  await started.promise;
  const disabling = f.coordinator.setEnabled(false);
  finish.resolve();
  await Promise.all([enabling, disabling]);
  assert.equal((await f.journal.settings()).enabled, false);
  assert.equal(f.restore(), 0);
  assert.equal(f.coordinator.getSnapshot().phase, "disabled");
  f.coordinator.dispose();
});
test("401 is visible auth-required instead of leaving the provider syncing forever", async () => {
  const f = await fixture();
  f.disk.fetcher = async () => new Response(null, { status: 401 });
  await f.coordinator.prepare();
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "auth-required");
  assert.equal(f.coordinator.getSnapshot().connected, false);
  f.coordinator.dispose();
});
test("known forward remote change pulls automatically while unchanged local state avoids echo upload", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "local" });
  const base = await f.journal.association(config.clientId, f.disk.auth.accountId),
    payload = new Blob([
      JSON.stringify({
        application: "personal-terminal",
        schemaVersion: 2,
        drawings: [],
        images: [],
        layout: { timeframe: "5m" }
      })
    ]),
    second = await encodeBundle(
      { payload, images: [] },
      {
        revisionId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        parents: base.heads,
        createdAt: new Date().toISOString(),
        digest: await payloadDigest(payload)
      }
    );
  f.disk.files.set(revisionName(second.revision), second.body);
  await f.coordinator.sync();
  assert.equal(f.applies(), 1);
  assert.equal(f.disk.puts(), 1);
  assert.equal(f.coordinator.getSnapshot().phase, "idle");
  assert.deepEqual((await f.journal.association(config.clientId, f.disk.auth.accountId)).heads, [
    second.revision.revisionId
  ]);
  f.coordinator.dispose();
});
test("removing previously associated cloud history requires new direction instead of silently recreating it", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "local" });
  f.disk.files.clear();
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "conflict");
  assert.equal(f.disk.puts(), 1);
  assert.equal(f.coordinator.getSnapshot().conflict.remotes.length, 0);
  f.coordinator.dispose();
});
test("automatic preference toggle preserves unresolved conflict and its preview", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.sync();
  const conflict = f.coordinator.getSnapshot().conflict;
  await f.coordinator.setAutomatic(true);
  assert.deepEqual(f.coordinator.getSnapshot().conflict, conflict);
  assert.equal(f.coordinator.getSnapshot().phase, "conflict");
  assert.equal(f.disk.puts(), 0);
  f.coordinator.dispose();
});
test("disconnect disables durably and removes only captured credential A while preserving concurrent B", async () => {
  const f = await fixture(),
    { EncryptedYandexVault } = load("services/yandex/auth-vault.ts"),
    { YandexAuth } = load("services/yandex/auth.ts"),
    vault = new EncryptedYandexVault(
      async () => f.backend,
      () => 1000000
    ),
    credential = {
      version: 1,
      generation: "A",
      clientId: config.clientId,
      accountId: "123",
      accessToken: "unit-yandex-A",
      issuedAt: 1000000,
      expiresAt: 2000000,
      scopes: ["cloud_api:disk.app_folder"]
    };
  await vault.save(credential, new AbortController().signal);
  const env = {
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    url: () => "http://localhost:5290/__dev/app/",
    now: () => 1000000,
    cleanUrl: () => {},
    navigate: () => {},
    fetch: async () => {
      throw new Error("No network");
    }
  };
  const auth = new YandexAuth(config, vault, () => env),
    c = new YandexCoordinator(f.host, config, { auth, journal: f.journal });
  await c.prepare();
  await vault.save(
    { ...credential, generation: "B", accessToken: "unit-yandex-B" },
    new AbortController().signal
  );
  await c.disconnect();
  assert.equal((await vault.load(config.clientId)).generation, "B");
  assert.equal((await f.journal.settings()).enabled, false);
  assert.equal(c.getSnapshot().phase, "disabled");
  assert.equal(c.getSnapshot().connected, false);
  c.dispose();
  f.coordinator.dispose();
});
test("failed disconnect persistence rejects local-save and never claims durable success", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  f.journal.saveSettings = async () => {
    throw new Error("quota");
  };
  await assert.rejects(f.coordinator.disconnect(), (error) => error.code === "local-save");
  assert.equal(f.coordinator.getSnapshot().phase, "disabled");
  assert.equal((await f.journal.settings()).enabled, true);
  assert.equal(f.coordinator.getSnapshot().error, undefined);
  f.coordinator.dispose();
});
test("resume bootstraps durable disabled flags locally without auth preparation or provider network", async () => {
  const f = await fixture(false);
  f.coordinator.resume();
  await new Promise(setImmediate);
  assert.equal(f.coordinator.getSnapshot().prepared, true);
  assert.equal(f.restore(), 0);
  assert.equal(f.callbacks(), 0);
  assert.equal(f.disk.calls.length, 0);
  assert.equal(f.coordinator.getSnapshot().phase, "disabled");
  f.coordinator.dispose();
});
test("postcommit restore failure retries the accepted receipt without a second native import", async () => {
  const f = await fixture(),
    payload = new Blob([
      JSON.stringify({
        application: "personal-terminal",
        schemaVersion: 2,
        drawings: [],
        images: [],
        layout: { timeframe: "5m" }
      })
    ]),
    encoded = await encodeBundle(
      { payload, images: [] },
      {
        revisionId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        parents: [],
        createdAt: new Date().toISOString(),
        digest: await payloadDigest(payload)
      }
    );
  f.disk.files.set(revisionName(encoded.revision), encoded.body);
  await f.coordinator.prepare();
  await f.coordinator.sync();
  const apply = f.host.apply;
  let once = true;
  f.host.apply = async (...args) => {
    await apply(...args);
    if (once) {
      once = false;
      throw Object.assign(new Error("UI restore"), { code: "local-save" });
    }
  };
  await f.coordinator.choose({ kind: "remote", id: encoded.revision.revisionId });
  assert.equal(f.applies(), 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "unconfirmed");
  assert.ok(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId));
  await f.coordinator.choose({ kind: "remote", id: encoded.revision.revisionId });
  assert.equal(f.applies(), 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
  assert.equal(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId), undefined);
  f.coordinator.dispose();
});
test("reload after native commit can finalize a durable apply intent from canonical digest without importing twice", async () => {
  const f = await fixture(),
    payload = new Blob([
      JSON.stringify({
        application: "personal-terminal",
        schemaVersion: 2,
        drawings: [],
        images: [],
        layout: { timeframe: "5m" }
      })
    ]),
    encoded = await encodeBundle(
      { payload, images: [] },
      {
        revisionId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        parents: [],
        createdAt: new Date().toISOString(),
        digest: await payloadDigest(payload)
      }
    );
  f.disk.files.set(revisionName(encoded.revision), encoded.body);
  await f.coordinator.prepare();
  await f.coordinator.sync();
  const apply = f.host.apply;
  f.host.apply = async (...args) => {
    await apply(...args);
    throw Object.assign(new Error("UI restore"), { code: "local-save" });
  };
  await f.coordinator.choose({ kind: "remote", id: encoded.revision.revisionId });
  assert.equal(f.applies(), 1);
  f.coordinator.dispose();
  const reloaded = f.make();
  await reloaded.prepare();
  await reloaded.sync();
  assert.equal(f.applies(), 1);
  assert.equal(reloaded.getSnapshot().phase, "idle");
  assert.equal(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId), undefined);
  reloaded.dispose();
});
test("known precommit quota failure retires its intent and a healthy remote retry commits exactly once", async () => {
  const f = await fixture(),
    remote = await seedRemote(f),
    apply = f.host.apply;
  let attempts = 0;
  f.host.apply = async (...args) => {
    if (++attempts === 1)
      throw Object.assign(new Error("quota before native commit"), { code: "local-save" });
    return apply(...args);
  };
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "remote", id: remote.revisionId });
  assert.equal(f.coordinator.getSnapshot().error, "local-save");
  assert.equal(f.applies(), 0);
  assert.equal(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId), undefined);
  assert.equal(await f.journal.association(config.clientId, f.disk.auth.accountId), undefined);
  await f.coordinator.choose({ kind: "remote", id: remote.revisionId });
  assert.equal(attempts, 2);
  assert.equal(f.applies(), 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
  f.coordinator.dispose();
});
test("reload after a definitive precommit failure can repreview and retry remote without choosing local", async () => {
  const f = await fixture(),
    remote = await seedRemote(f),
    apply = f.host.apply;
  let attempts = 0;
  f.host.apply = async (...args) => {
    if (++attempts === 1) throw Object.assign(new Error("quota"), { code: "local-save" });
    return apply(...args);
  };
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "remote", id: remote.revisionId });
  f.coordinator.dispose();
  const reloaded = f.make();
  await reloaded.prepare();
  await reloaded.sync();
  assert.equal(reloaded.getSnapshot().phase, "conflict");
  await reloaded.choose({ kind: "remote", id: remote.revisionId });
  assert.equal(attempts, 2);
  assert.equal(f.applies(), 1);
  assert.equal(reloaded.getSnapshot().choiceAction.state, "confirmed");
  reloaded.dispose();
});
test("an unknown crash intent stays indeterminate until a fresh guarded explicit remote decision", async () => {
  const f = await fixture(),
    remote = await seedRemote(f),
    operationId = crypto.randomUUID();
  await f.journal.saveApplyIntent(
    config.clientId,
    {
      version: 1,
      operationId,
      accountId: f.disk.auth.accountId,
      credentialGeneration: f.disk.auth.credentialGeneration,
      targetId: remote.revisionId,
      heads: [remote.revisionId],
      digest: remote.digest
    },
    new AbortController().signal
  );
  await f.coordinator.prepare();
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().error, "indeterminate");
  assert.ok(f.coordinator.getSnapshot().conflict);
  assert.equal(f.applies(), 0);
  assert.equal(
    (await f.journal.applyIntent(config.clientId, f.disk.auth.accountId)).operationId,
    operationId
  );
  f.edit();
  f.coordinator.localIntent();
  await f.coordinator.choose({ kind: "remote", id: remote.revisionId });
  assert.equal(f.coordinator.getSnapshot().error, "local-changed");
  assert.equal(f.applies(), 0);
  assert.equal(
    (await f.journal.applyIntent(config.clientId, f.disk.auth.accountId)).operationId,
    operationId
  );
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().error, "indeterminate");
  await f.coordinator.choose({ kind: "remote", id: remote.revisionId });
  assert.equal(f.applies(), 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
  assert.ok(
    [...f.backend.records.keys()].some((key) => key.endsWith(`unconfirmed-apply:${operationId}`))
  );
  assert.equal(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId), undefined);
  f.coordinator.dispose();
});
test("disable before a failed native attempt prevents late intent cleanup and permits fresh explicit recovery", async () => {
  const f = await fixture(),
    remote = await seedRemote(f),
    apply = f.host.apply;
  let attempts = 0;
  f.host.apply = async (...args) => {
    if (++attempts === 1) {
      await f.coordinator.setEnabled(false);
      throw Object.assign(new Error("cancelled before commit"), { code: "local-save" });
    }
    return apply(...args);
  };
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "remote", id: remote.revisionId });
  assert.equal(f.coordinator.getSnapshot().phase, "disabled");
  assert.equal(f.applies(), 0);
  assert.ok(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId));
  await f.coordinator.setEnabled(true);
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().error, "indeterminate");
  await f.coordinator.choose({ kind: "remote", id: remote.revisionId });
  assert.equal(attempts, 2);
  assert.equal(f.applies(), 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
  f.coordinator.dispose();
});

test("inspection preserves prior sync, dirty state, association, pending upload and apply recovery", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.sync();
  await f.coordinator.choose({ kind: "local" });
  const priorSync = f.coordinator.getSnapshot().lastSyncedAt;
  f.edit();
  f.coordinator.localIntent();
  const captured = await f.host.capture(),
    pending = await encodeBundle(captured.prepared, {
      revisionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      parents: [],
      createdAt: "2026-11-27T10:00:00Z",
      digest: captured.digest
    });
  await f.journal.savePending(
    config.clientId,
    {
      version: 1,
      accountId: f.disk.auth.accountId,
      credentialGeneration: f.disk.auth.credentialGeneration,
      name: revisionName(pending.revision),
      ...pending
    },
    new AbortController().signal
  );
  await f.journal.saveApplyIntent(
    config.clientId,
    {
      version: 1,
      accountId: f.disk.auth.accountId,
      credentialGeneration: f.disk.auth.credentialGeneration,
      operationId: crypto.randomUUID(),
      targetId: pending.revision.revisionId,
      heads: [pending.revision.revisionId],
      digest: captured.digest
    },
    new AbortController().signal
  );
  const records = structuredClone(f.backend.records),
    calls = f.disk.calls.length;
  for (const name of [
    "association",
    "applyIntent",
    "pending",
    "accept",
    "archivePending",
    "clearPending",
    "saveApplyIntent",
    "clearApplyIntent",
    "archiveApplyIntent"
  ])
    f.journal[name] = async () => {
      throw new Error(`Unexpected inspection journal call: ${name}`);
    };
  await f.coordinator.inspect();
  const status = f.coordinator.getSnapshot();
  assert.ok(status.comparison);
  assert.equal(status.phase, "idle");
  assert.equal(status.conflict, undefined);
  assert.equal(status.pendingChanges, true);
  assert.equal(status.lastSyncedAt, priorSync);
  assert.equal(f.applies(), 0);
  assert.equal(f.disk.puts(), 1);
  assert.deepEqual(f.backend.records, records);
  assert.ok(
    f.disk.calls.slice(calls).every(({ init }) => !["PUT", "POST", "DELETE"].includes(init.method))
  );
  f.coordinator.dispose();
});

test("empty inspection presents local summary without conflict, upload, apply or invented metadata", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  const status = f.coordinator.getSnapshot();
  assert.deepEqual(status.comparison.local, { instruments: 0, drawings: 0, images: 0 });
  assert.deepEqual(status.comparison.remotes, []);
  assert.ok(Number.isFinite(Date.parse(status.comparison.checkedAt)));
  assert.equal(status.comparison.local.date, undefined);
  assert.equal(status.conflict, undefined);
  assert.equal(status.lastSyncedAt, undefined);
  assert.equal(f.disk.puts(), 0);
  assert.equal(f.applies(), 0);
  f.coordinator.dispose();
});

for (const direction of ["local", "remote"]) {
  for (const change of ["local", "heads"]) {
    test(`${direction} decision with changed ${change} refreshes only; reviewed retry keeps its direction`, async () => {
      const f = await fixture(),
        remote = await seedRemote(f);
      await f.coordinator.prepare();
      await f.coordinator.inspect();
      if (change === "local") f.edit();
      else await seedRemote(f);
      const records = structuredClone(f.backend.records);
      const decide = () =>
        direction === "local"
          ? f.coordinator.choose({ kind: "local" })
          : f.coordinator.receive(remote.revisionId);
      await decide();
      assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
      assert.equal(f.coordinator.getSnapshot().error, "local-changed");
      assert.ok(f.coordinator.getSnapshot().comparison);
      assert.equal(f.applies(), 0);
      assert.equal(f.disk.puts(), 0);
      assert.deepEqual(f.backend.records, records);
      await decide();
      assert.equal(f.applies(), direction === "remote" ? 1 : 0);
      assert.equal(f.disk.puts(), direction === "local" ? 1 : 0);
      assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
      f.coordinator.dispose();
    });
  }
}

test("send requires a reviewed preview even before the first comparison", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.choose({ kind: "local" });
  assert.equal(f.disk.puts(), 0);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
  await f.coordinator.choose({ kind: "local" });
  assert.equal(f.disk.puts(), 1);
  assert.equal(f.applies(), 0);
  f.coordinator.dispose();
});

test("receiving a pinned version preserves every cloud branch and the unresolved conflict", async () => {
  const f = await fixture(),
    first = await seedRemote(f),
    second = await seedRemote(f);
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  const comparison = f.coordinator.getSnapshot().comparison;
  assert.equal(comparison.remotes.length, 2);
  assert.equal(comparison.remotes.find(({ id }) => id === first.revisionId).date, first.createdAt);
  assert.ok(comparison.remotes.every(({ deviceLabel }) => deviceLabel === undefined));
  assert.equal(f.coordinator.getSnapshot().conflict, undefined);
  const files = [...f.disk.files.keys()];
  await f.coordinator.receive(second.revisionId);
  assert.equal(f.applies(), 1);
  assert.equal(f.disk.puts(), 0);
  assert.deepEqual([...f.disk.files.keys()], files);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
  assert.equal(f.coordinator.getSnapshot().conflict.remotes.length, 2);
  assert.equal(f.coordinator.getSnapshot().phase, "conflict");
  await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "conflict");
  assert.equal(f.coordinator.getSnapshot().conflict.remotes.length, 2);
  assert.equal(f.disk.puts(), 0);
  f.coordinator.dispose();
});

test("local intent and disconnect invalidate comparison; disabled inspect/receive produce no traffic", async () => {
  const f = await fixture(),
    remote = await seedRemote(f);
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  f.coordinator.localIntent();
  assert.equal(f.coordinator.getSnapshot().comparison, undefined);
  await f.coordinator.receive(remote.revisionId);
  assert.equal(f.applies(), 0);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
  await f.coordinator.setEnabled(false);
  assert.equal(f.coordinator.getSnapshot().comparison, undefined);
  const calls = f.disk.calls.length;
  await f.coordinator.inspect();
  await f.coordinator.receive(remote.revisionId);
  assert.equal(f.disk.calls.length, calls);
  assert.equal(f.coordinator.getSnapshot().comparison, undefined);
  f.coordinator.dispose();
});

test("disconnect during inspection ignores a late result without changing recovery records", async () => {
  const f = await fixture(),
    remote = await seedRemote(f),
    started = deferred(),
    finish = deferred();
  await f.coordinator.prepare();
  f.disk.hooks.before = async (url) => {
    if (url.searchParams.has("limit")) {
      started.resolve();
      await finish.promise;
    }
  };
  const inspecting = f.coordinator.inspect();
  await started.promise;
  await f.coordinator.setEnabled(false);
  const records = structuredClone(f.backend.records);
  finish.resolve();
  await inspecting;
  assert.equal(f.coordinator.getSnapshot().phase, "disabled");
  assert.equal(f.coordinator.getSnapshot().comparison, undefined);
  assert.equal(f.applies(), 0);
  assert.equal(f.disk.puts(), 0);
  assert.deepEqual(f.backend.records, records);
  assert.ok(f.disk.files.has(revisionName(remote)));
  f.coordinator.dispose();
});

test("inspection does not reconcile a committed receipt; explicit retry still avoids a second import", async () => {
  const f = await fixture(),
    remote = await seedRemote(f),
    apply = f.host.apply;
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  f.host.apply = async (...args) => {
    await apply(...args);
    throw Object.assign(new Error("UI restore"), { code: "local-save" });
  };
  await f.coordinator.receive(remote.revisionId);
  const records = structuredClone(f.backend.records);
  assert.equal(f.applies(), 1);
  await f.coordinator.inspect();
  assert.deepEqual(f.backend.records, records);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "unconfirmed");
  await f.coordinator.receive(remote.revisionId);
  assert.equal(f.applies(), 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "confirmed");
  f.coordinator.dispose();
});

for (const direction of ["local", "remote"]) {
  test(`${direction} detects a changed header/file fingerprint under the same remote ID`, async () => {
    const f = await fixture(),
      remote = await seedRemote(f);
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    const payload = new Blob([
        JSON.stringify({
          application: "personal-terminal",
          schemaVersion: 2,
          drawings: [],
          images: [],
          layout: { timeframe: "1h" }
        })
      ]),
      changed = await encodeBundle(
        { payload, images: [] },
        {
          revisionId: remote.revisionId,
          deviceId: remote.deviceId,
          parents: remote.parents,
          createdAt: remote.createdAt,
          digest: await payloadDigest(payload)
        }
      ),
      fetcher = f.disk.fetcher;
    f.disk.files.set(revisionName(remote), changed.body);
    f.disk.fetcher = async (...args) => {
      const response = await fetcher(...args),
        url = new URL(args[0]);
      if (!url.searchParams.has("limit")) return response;
      const listing = await response.json();
      listing._embedded.items = listing._embedded.items.map((item) => ({
        ...item,
        md5: "b".repeat(32),
        modified: "2026-11-27T12:00:01Z"
      }));
      return Response.json(listing);
    };
    const records = structuredClone(f.backend.records);
    if (direction === "local") await f.coordinator.choose({ kind: "local" });
    else await f.coordinator.receive(remote.revisionId);
    assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
    assert.equal(f.coordinator.getSnapshot().error, "local-changed");
    assert.equal(f.applies(), 0);
    assert.equal(f.disk.puts(), 0);
    assert.deepEqual(f.backend.records, records);
    f.coordinator.dispose();
  });

  test(`${direction} refuses a local edit during remote decoding before publishing or importing`, async () => {
    const f = await fixture(),
      remote = await seedRemote(f),
      decode = f.host.decode;
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    f.host.decode = async (...args) => {
      const backup = await decode(...args);
      f.edit();
      return backup;
    };
    if (direction === "local") await f.coordinator.choose({ kind: "local" });
    else await f.coordinator.receive(remote.revisionId);
    assert.equal(f.coordinator.getSnapshot().error, "local-changed");
    assert.equal(f.applies(), 0);
    assert.equal(f.disk.puts(), 0);
    assert.equal(await f.journal.association(config.clientId, f.disk.auth.accountId), undefined);
    f.coordinator.dispose();
  });
}

test("session change clears comparison and ignores a late inspection result", async () => {
  const f = await fixture(),
    started = deferred(),
    finish = deferred(),
    scope = f.host.scope;
  await seedRemote(f);
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  f.disk.hooks.before = async (url) => {
    if (url.searchParams.has("limit")) {
      started.resolve();
      await finish.promise;
    }
  };
  const inspecting = f.coordinator.inspect();
  await started.promise;
  f.host.scope = () => ({ ...scope(), ready: false, session: {} });
  f.coordinator.profileChanged();
  finish.resolve();
  await inspecting;
  assert.equal(f.coordinator.getSnapshot().connected, false);
  assert.equal(f.coordinator.getSnapshot().comparison, undefined);
  assert.equal(f.applies(), 0);
  assert.equal(f.disk.puts(), 0);
  f.coordinator.dispose();
});

test("failed inspection removes stale comparison while preserving historical sync and dirty state", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  await f.coordinator.choose({ kind: "local" });
  const lastSyncedAt = f.coordinator.getSnapshot().lastSyncedAt;
  f.edit();
  f.coordinator.localIntent();
  await f.coordinator.inspect();
  f.disk.fetcher = async () => new Response(null, { status: 503 });
  await f.coordinator.inspect();
  assert.equal(f.coordinator.getSnapshot().comparison, undefined);
  assert.equal(f.coordinator.getSnapshot().error, "network");
  assert.equal(f.coordinator.getSnapshot().lastSyncedAt, lastSyncedAt);
  assert.equal(f.coordinator.getSnapshot().pendingChanges, true);
  assert.equal(f.applies(), 0);
  assert.equal(f.disk.puts(), 1);
  f.coordinator.dispose();
});

for (const direction of ["local", "remote"]) {
  test(`${direction} rechecks cloud heads after asynchronous remote decoding`, async () => {
    const f = await fixture(),
      remote = await seedRemote(f),
      decode = f.host.decode;
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    let changed = false;
    f.host.decode = async (...args) => {
      const result = await decode(...args);
      if (!changed) {
        changed = true;
        await seedRemote(f);
      }
      return result;
    };
    const records = structuredClone(f.backend.records);
    if (direction === "local") await f.coordinator.choose({ kind: "local" });
    else await f.coordinator.receive(remote.revisionId);
    assert.equal(f.applies(), 0);
    assert.equal(f.disk.puts(), 0);
    assert.equal(f.disk.files.size, 2);
    assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
    assert.equal(f.coordinator.getSnapshot().comparison.remotes.length, 2);
    assert.deepEqual(f.backend.records, records);
    f.coordinator.dispose();
  });
}

for (const stage of ["savePending", "metadata", "uploadLink"]) {
  test(`send fences a local edit during ${stage} before cloud PUT`, async () => {
    const f = await fixture();
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    if (stage === "savePending") {
      const save = f.journal.savePending.bind(f.journal);
      f.journal.savePending = async (...args) => {
        await save(...args);
        f.edit();
      };
    } else {
      let changed = false;
      f.disk.hooks.before = async (url, init) => {
        const metadata =
          !url.searchParams.has("limit") &&
          !url.pathname.endsWith("/upload") &&
          !url.pathname.endsWith("/download") &&
          init.method !== "PUT";
        if (!changed && (stage === "metadata" ? metadata : url.pathname.endsWith("/upload"))) {
          changed = true;
          f.edit();
        }
      };
    }
    await f.coordinator.choose({ kind: "local" });
    assert.equal(f.disk.puts(), 0);
    assert.equal(f.applies(), 0);
    assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
    assert.equal(f.coordinator.getSnapshot().error, "local-changed");
    assert.equal(await f.journal.association(config.clientId, f.disk.auth.accountId), undefined);
    assert.ok(await f.journal.pending(config.clientId, f.disk.auth.accountId));
    f.coordinator.dispose();
  });
}

for (const change of ["local", "remote"]) {
  test(`receive checks ${change} state again after saving its durable apply intent`, async () => {
    const f = await fixture(),
      remote = await seedRemote(f),
      save = f.journal.saveApplyIntent.bind(f.journal);
    await f.coordinator.prepare();
    await f.coordinator.inspect();
    f.journal.saveApplyIntent = async (...args) => {
      await save(...args);
      if (change === "local") f.edit();
      else await seedRemote(f);
    };
    await f.coordinator.receive(remote.revisionId);
    assert.equal(f.applies(), 0);
    assert.equal(f.disk.puts(), 0);
    assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
    assert.equal(f.coordinator.getSnapshot().error, "local-changed");
    assert.equal(await f.journal.association(config.clientId, f.disk.auth.accountId), undefined);
    assert.equal(await f.journal.applyIntent(config.clientId, f.disk.auth.accountId), undefined);
    f.coordinator.dispose();
  });
}

test("send rechecks remote state after saving a pending upload, before publishing", async () => {
  const f = await fixture(),
    save = f.journal.savePending.bind(f.journal);
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  f.journal.savePending = async (...args) => {
    await save(...args);
    await seedRemote(f);
  };
  await f.coordinator.choose({ kind: "local" });
  assert.equal(f.applies(), 0);
  assert.equal(f.disk.puts(), 0);
  assert.equal(f.disk.files.size, 1);
  assert.equal(f.coordinator.getSnapshot().choiceAction.state, "review");
  assert.equal(f.coordinator.getSnapshot().comparison.remotes.length, 1);
  assert.ok(await f.journal.pending(config.clientId, f.disk.auth.accountId));
  f.coordinator.dispose();
});

for (const existing of [true, false]) {
  test(`inspection ${existing ? "retains an already scheduled automatic job" : "does not schedule a new automatic job"}`, async () => {
    const f = await fixture(),
      started = deferred(),
      finish = deferred(),
      jobs = new Map(),
      timeout = globalThis.setTimeout,
      clear = globalThis.clearTimeout;
    let runs = 0,
      id = 0;
    globalThis.setTimeout = (fn, delay, ...args) => {
      if (delay !== 750) return timeout(fn, delay, ...args);
      const handle = { job: ++id };
      jobs.set(handle, () => fn(...args));
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      if (!jobs.delete(handle)) clear(handle);
    };
    const fire = () => {
      const batch = [...jobs.values()];
      jobs.clear();
      for (const fn of batch) fn();
    };
    try {
      await f.coordinator.prepare();
      const run = f.coordinator.run.bind(f.coordinator);
      f.coordinator.run = async (...args) => {
        if (args[2] === true) runs++;
        else return run(...args);
      };
      await f.coordinator.setAutomatic(true);
      assert.equal(jobs.size, 1);
      if (!existing) {
        fire();
        assert.equal(runs, 1);
        runs = 0;
      }
      f.disk.hooks.before = async (url) => {
        if (url.searchParams.has("limit")) {
          started.resolve();
          await finish.promise;
        }
      };
      const inspecting = f.coordinator.inspect();
      await started.promise;
      if (existing) fire();
      assert.equal(runs, 0);
      finish.resolve();
      await inspecting;
      assert.equal(jobs.size, existing ? 1 : 0);
      if (existing) fire();
      assert.equal(runs, existing ? 1 : 0);
    } finally {
      f.coordinator.dispose();
      globalThis.setTimeout = timeout;
      globalThis.clearTimeout = clear;
    }
  });
}

test("verified cloud save stays confirmed when cleanup fails; only generic sync retries pruning", async () => {
  const f = await fixture();
  await f.coordinator.prepare();
  await f.coordinator.inspect();
  await f.coordinator.choose({ kind: "local" });
  f.edit("1h");
  f.coordinator.localIntent();
  await f.coordinator.inspect();
  await f.coordinator.choose({ kind: "local" });
  const fetcher = f.disk.fetcher;
  f.disk.fetcher = async (target, init) => {
    const url = new URL(target),
      name = url.searchParams.get("path")?.split("/").at(-1);
    return init.method === "DELETE" && name?.startsWith("slot_")
      ? new Response(null, { status: 503 })
      : fetcher(target, init);
  };
  f.edit("5m");
  f.coordinator.localIntent();
  await f.coordinator.inspect();
  await f.coordinator.choose({ kind: "local" });
  let status = f.coordinator.getSnapshot();
  assert.equal(status.choiceAction.state, "confirmed");
  assert.equal(status.pendingChanges, false);
  assert.equal(status.retention.phase, "pending");
  assert.equal(status.retention.error, "network");
  assert.equal(status.error, undefined);
  assert.ok(status.lastSyncedAt);
  assert.ok(await f.journal.association(config.clientId, f.disk.auth.accountId));
  assert.equal(await f.journal.pending(config.clientId, f.disk.auth.accountId), undefined);
  assert.equal([...f.disk.files.keys()].filter((name) => name.startsWith("slot_")).length, 2);
  let calls = f.disk.calls.length;
  await f.coordinator.inspect();
  assert.equal(
    f.disk.calls.slice(calls).some(({ init }) => init.method === "DELETE"),
    false
  );
  const association = await f.journal.association(config.clientId, f.disk.auth.accountId);
  const previous = f.coordinator
    .getSnapshot()
    .comparison.remotes.find(({ id }) => !association.heads.includes(id));
  calls = f.disk.calls.length;
  await f.coordinator.receive(previous.id);
  assert.equal(
    f.disk.calls.slice(calls).some(({ init }) => init.method === "DELETE"),
    false
  );
  assert.equal(f.applies(), 1);
  f.disk.fetcher = fetcher;
  await f.coordinator.sync();
  status = f.coordinator.getSnapshot();
  assert.equal(status.retention.phase, "complete");
  assert.equal(status.retention.keptFiles, 1);
  assert.equal([...f.disk.files.keys()].filter((name) => name.startsWith("slot_")).length, 1);
  assert.equal(f.disk.puts(), 3);
  f.coordinator.dispose();
});
