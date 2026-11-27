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
    edit: () => {
      revision++;
      backup.layout.timeframe = "1h";
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
