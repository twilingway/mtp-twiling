import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({ "services/storage-db.ts": {} });
const { DriveAuth } = load("services/drive/auth.ts");
const { EncryptedDriveAuthVault } = load("services/drive/auth-vault.ts");
const { driveCredentialId } = load("services/drive/auth-credential-id.ts");
const { GoogleSlotProvider } = load("services/drive/device-slot-provider.ts");
const { googleSlotStorageOwner } = load("services/drive/workspace-binding.ts");
const { DRIVE_SCOPE, DRIVE_CLIENT_ID } = load("services/drive/types.ts");
const { prepareDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
const { DEVICE_SLOT_NAMESPACE, deviceSlotKey } = load("services/drive/device-slot-model.ts");
const { prepareDeviceSlotVersion, encodeDeviceSlotPackage } = load(
  "services/drive/device-slot-package.ts"
);

const workspaceId = "00000000-0000-4000-8000-000000000010";
const deviceId = "00000000-0000-4000-8000-000000000011";
const revisionId = "00000000-0000-4000-8000-000000000012";
const selectedToken = "synthetic-new-Google-account";
const legacyOwners = ["legacy-A", "legacy-B", "device"];
const backup = (symbol) => ({
  application: "personal-terminal",
  schemaVersion: 2,
  layout: { symbol },
  watchlist: [],
  drawings: [],
  images: [],
  views: []
});

async function fixture(t, hasRemote) {
  const now = Date.now();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
  const sealed = new Map();
  const vaultReads = [];
  const vaultWrites = [];
  const vault = new EncryptedDriveAuthVault(
    async () => ({
      key: async () => key,
      read: async (id) => {
        vaultReads.push(id);
        return sealed.get(id);
      },
      write: async (record) => {
        vaultWrites.push(record.id);
        sealed.set(record.id, structuredClone(record));
      },
      remove: async (id, credentialId) => {
        vaultWrites.push(id);
        if (!credentialId || sealed.get(id)?.credentialId === credentialId) sealed.delete(id);
      }
    }),
    () => now
  );
  for (const owner of legacyOwners) {
    await vault.save(
      {
        version: 1,
        credentialId: crypto.randomUUID(),
        owner,
        clientId: DRIVE_CLIENT_ID,
        token: `synthetic-legacy-${owner}`,
        issuedAt: now,
        expiresAt: now + 60000,
        scopes: [DRIVE_SCOPE]
      },
      new AbortController().signal
    );
  }
  const before = structuredClone(sealed);
  vaultWrites.length = 0;

  const records = new Map(
    legacyOwners.map((owner) => [
      owner,
      {
        schemaVersion: 3,
        generation: 5,
        enabled: true,
        automatic: true,
        mode: "normal",
        baseHeads: []
      }
    ])
  );
  const originalRecords = structuredClone(records);
  const scope = {
    owner: "device",
    session: {},
    cloudOwner: "device",
    ready: true,
    blocked: false,
    associationConflict: true,
    revision: 1
  };
  const explicitOwner = googleSlotStorageOwner(scope);
  const newRecord = () => ({
    schemaVersion: 3,
    generation: 0,
    automatic: false,
    mode: "normal",
    baseHeads: []
  });
  let local = backup("SBER");
  let popup;
  let reads = 0;
  let applies = 0;
  const version = await prepareDeviceSlotVersion(await prepareDriveBackup(backup("GAZP")));
  const revision = { deviceId, seq: 1, revisionId };
  const media = encodeDeviceSlotPackage(
    {
      protocol: 3,
      previous: null,
      current: {
        protocol: 3,
        workspaceId,
        legacyArchive: null,
        ...revision,
        previousRevisionId: null,
        accepted: [revision],
        payload: version.reference
      }
    },
    version,
    null
  );
  const file = {
    id: "synthetic-remote",
    size: String(media.size),
    appProperties: {
      mtpNamespace: DEVICE_SLOT_NAMESPACE,
      mtpKind: "device-slot",
      mtpKey: deviceSlotKey(workspaceId, deviceId)
    }
  };
  const calls = [];
  const makeProvider = () => {
    const auth = new DriveAuth(
      async () => ({
        initTokenClient(config) {
          popup = config;
          return {
            requestAccessToken: (options) => assert.deepEqual(options, { prompt: "select_account" })
          };
        }
      }),
      () => now,
      vault
    );
    const provider = new GoogleSlotProvider(
      {
        scope: () => scope,
        capture: async () => ({
          backup: local,
          digest: await driveBackupDigest(local),
          prepared: await prepareDriveBackup(local),
          revision: scope.revision
        }),
        apply: async (id, data, expectedRevision, guard, committed) => {
          assert.equal(id, "google-drive");
          assert.equal(scope.revision, expectedRevision);
          assert.equal(guard.isCurrent(), true);
          local = data;
          applies++;
          committed(++scope.revision);
        }
      },
      {
        auth,
        load: async (owner) => {
          assert.equal(owner, explicitOwner);
          return records.get(owner) ?? newRecord();
        },
        save: async (owner, prior, patch) => {
          assert.equal(owner, explicitOwner);
          assert.equal(prior.generation, (records.get(owner) ?? newRecord()).generation);
          const next = { ...prior, ...patch, generation: prior.generation + 1 };
          records.set(owner, next);
          return next;
        },
        hasHistory: () => assert.fail("Ambiguous history cannot discover a legacy account"),
        online: () => true,
        fetch: async (input, init) => {
          const headers = new Headers(init.headers);
          assert.equal(headers.get("Authorization"), `Bearer ${selectedToken}`);
          const url = new URL(input);
          const method = init.method ?? "GET";
          calls.push(method);
          assert.equal(method, "GET", "This selected-history fixture never writes cloud data");
          reads++;
          if (url.searchParams.get("alt") === "media")
            return new Response(media, { headers: { ETag: '"v1"' } });
          const v3 = url.searchParams.get("q").includes(DEVICE_SLOT_NAMESPACE);
          return Response.json({ files: hasRemote && v3 ? [file] : [] });
        }
      }
    );
    t.after(() => provider.dispose());
    return provider;
  };
  const assertLegacyUnchanged = async () => {
    for (const owner of legacyOwners) {
      const id = driveCredentialId(owner);
      assert.deepEqual(
        sealed.get(id),
        before.get(id),
        "Encrypted bytes and AAD owner remain unchanged"
      );
      assert.deepEqual(records.get(owner), originalRecords.get(owner));
      assert.ok(!vaultWrites.includes(id));
    }
  };
  const connect = async (provider, cancelled = false) => {
    await provider.prepare();
    const promise = provider.connectFromUserGesture();
    if (cancelled) popup.error_callback({ type: "popup_closed" });
    else popup.callback({ access_token: selectedToken, expires_in: 3600, scope: DRIVE_SCOPE });
    await promise;
  };
  return {
    device: makeProvider(),
    makeProvider,
    connect,
    explicitOwner,
    records,
    assertLegacyUnchanged,
    vaultReads,
    vaultWrites,
    calls,
    reads: () => reads,
    applies: () => applies
  };
}

test("ambiguous aliases do not auto-restore and cancelling explicit OAuth preserves exact old vault data", async (t) => {
  const f = await fixture(t, true);
  f.device.resume();
  await f.device.prepare();
  await f.device.sync();
  assert.equal(f.device.getSnapshot().enabled, false);
  assert.deepEqual(f.vaultReads, []);
  assert.deepEqual(f.calls, []);
  await f.device.setEnabled(true);
  await f.connect(f.device, true);
  assert.equal(f.device.getSnapshot().connected, false);
  assert.equal(f.records.get(f.explicitOwner).explicitGoogleCredential, undefined);
  assert.deepEqual(f.vaultReads, []);
  assert.deepEqual(f.vaultWrites, []);
  assert.deepEqual(f.calls, []);
  await f.assertLegacyUnchanged();
});

test("explicit OAuth pins the credential, awaits history choice and resumes the same account after reload", async (t) => {
  const f = await fixture(t, true);
  await f.device.setEnabled(true);
  await f.connect(f.device);
  const link = f.records.get(f.explicitOwner).explicitGoogleCredential;
  assert.ok(link);
  assert.deepEqual(f.vaultWrites, [
    driveCredentialId(f.explicitOwner),
    driveCredentialId(f.explicitOwner)
  ]);

  await f.device.sync();
  const preview = f.device.getSnapshot().conflict;
  assert.deepEqual(
    preview.remotes.map(({ id }) => id),
    [revisionId]
  );
  assert.equal(f.applies(), 0);
  f.device.dispose();

  const reloaded = f.makeProvider();
  reloaded.resume();
  await reloaded.prepare();
  await reloaded.sync();
  assert.equal(reloaded.getSnapshot().connected, true);
  assert.equal(f.applies(), 0);
  await reloaded.choose({ kind: "remote", id: revisionId });
  assert.equal(reloaded.getSnapshot().phase, "idle");
  assert.equal(f.applies(), 1);
  assert.deepEqual(f.records.get(f.explicitOwner).baseHeads, [revisionId]);

  const next = f.makeProvider();
  reloaded.dispose();
  next.resume();
  await next.prepare();
  await next.sync();
  assert.equal(next.getSnapshot().phase, "idle");
  assert.equal(f.applies(), 1);
  assert.equal(f.records.get(f.explicitOwner).explicitGoogleCredential, link);
  assert.deepEqual(f.vaultReads, [
    driveCredentialId(f.explicitOwner),
    driveCredentialId(f.explicitOwner)
  ]);
  await f.assertLegacyUnchanged();
});

test("newly linked empty Google account awaits consent to publish the local version", async (t) => {
  const f = await fixture(t, false);
  await f.device.setEnabled(true);
  await f.connect(f.device);
  await f.device.sync();
  assert.equal(f.device.getSnapshot().phase, "conflict");
  assert.deepEqual(f.device.getSnapshot().conflict.remotes, []);
  assert.equal(f.records.get(f.explicitOwner).scope, undefined);
  assert.ok(f.reads() > 0);
  await f.assertLegacyUnchanged();
});

test("a stale credential generation is rejected both in a live tab and after reload", async (t) => {
  const f = await fixture(t, true);
  await f.device.setEnabled(true);
  await f.connect(f.device);
  const prior = f.records.get(f.explicitOwner);
  f.records.set(f.explicitOwner, {
    ...prior,
    generation: prior.generation + 1,
    explicitGoogleCredential: crypto.randomUUID()
  });

  await f.device.sync();
  assert.equal(f.device.getSnapshot().connected, false);
  assert.equal(f.device.getSnapshot().phase, "auth-required");
  assert.deepEqual(f.calls, []);

  const reloaded = f.makeProvider();
  reloaded.resume();
  await reloaded.prepare();
  await reloaded.sync();
  assert.equal(reloaded.getSnapshot().connected, false);
  assert.deepEqual(f.calls, []);
  await f.assertLegacyUnchanged();
});
