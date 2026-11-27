import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({ "services/storage-db.ts": {} });
const { DriveAuth } = load("services/drive/auth.ts");
const { EncryptedDriveAuthVault } = load("services/drive/auth-vault.ts");
const { driveCredentialId } = load("services/drive/auth-credential-id.ts");
const { GoogleSlotProvider } = load("services/drive/device-slot-provider.ts");
const { googleSlotStorageOwner, GOOGLE_SLOT_ACTIVE_OWNER } = load(
  "services/drive/workspace-binding.ts"
);
const { DRIVE_SCOPE, DRIVE_CLIENT_ID } = load("services/drive/types.ts");
const { prepareDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
const { DEVICE_SLOT_NAMESPACE, deviceSlotKey } = load("services/drive/device-slot-model.ts");
const { prepareDeviceSlotVersion, encodeDeviceSlotPackage } = load(
  "services/drive/device-slot-package.ts"
);

const workspaceId = "00000000-0000-4000-8000-000000000010";
const deviceId = "00000000-0000-4000-8000-000000000011";
const revisionId = "00000000-0000-4000-8000-000000000012";
const workspaceB = "00000000-0000-4000-8000-000000000020";
const revisionB = "00000000-0000-4000-8000-000000000022";
const selectedToken = (account) => `synthetic-new-Google-account-${account}`;
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

async function fixture(t, hasRemote, hasRemoteB = false) {
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
  let failPointer = false;
  const remoteFile = async (id, workspaceId, revisionId, symbol) => {
    const version = await prepareDeviceSlotVersion(await prepareDriveBackup(backup(symbol)));
    const revision = { deviceId, seq: 1, revisionId };
    const envelope = {
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
    };
    const media = encodeDeviceSlotPackage(envelope, version, null);
    return {
      envelope,
      media,
      file: {
        id,
        size: String(media.size),
        appProperties: {
          mtpNamespace: DEVICE_SLOT_NAMESPACE,
          mtpKind: "device-slot",
          mtpKey: deviceSlotKey(workspaceId, deviceId)
        }
      }
    };
  };
  const remoteA = await remoteFile("synthetic-account-a", workspaceId, revisionId, "GAZP");
  const remote = {
    A: hasRemote ? remoteA : undefined,
    B: hasRemoteB
      ? await remoteFile("synthetic-account-b", workspaceB, revisionB, "YDEX")
      : undefined
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
          assert.ok(owner === explicitOwner || owner.startsWith(`${explicitOwner}:`));
          return records.get(owner) ?? newRecord();
        },
        save: async (owner, prior, patch) => {
          assert.ok(owner === explicitOwner || owner.startsWith(`${explicitOwner}:`));
          assert.equal(prior.generation, (records.get(owner) ?? newRecord()).generation);
          if (failPointer && owner === GOOGLE_SLOT_ACTIVE_OWNER && patch.activeGoogleSlotOwner)
            throw new Error("synthetic active-pointer failure");
          const next = { ...prior, ...patch, generation: prior.generation + 1 };
          records.set(owner, next);
          return next;
        },
        hasHistory: () => assert.fail("Ambiguous history cannot discover a legacy account"),
        online: () => true,
        fetch: async (input, init) => {
          const headers = new Headers(init.headers);
          const account =
            headers.get("Authorization") === `Bearer ${selectedToken("A")}` ? "A" : "B";
          assert.equal(headers.get("Authorization"), `Bearer ${selectedToken(account)}`);
          const url = new URL(input);
          const method = init.method ?? "GET";
          calls.push(method);
          assert.equal(method, "GET", "This selected-history fixture never writes cloud data");
          reads++;
          const selected = remote[account];
          if (url.searchParams.get("alt") === "media") {
            assert.equal(
              url.pathname,
              `/drive/v3/files/${selected?.file.id}`,
              "No account may read the other account's pinned file"
            );
            return new Response(selected.media, { headers: { ETag: '"v1"' } });
          }
          const v3 = url.searchParams.get("q").includes(DEVICE_SLOT_NAMESPACE);
          return Response.json({ files: selected && v3 ? [selected.file] : [] });
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
  const connect = async (provider, cancelled = false, account = "A") => {
    await provider.prepare();
    const promise = provider.connectFromUserGesture();
    if (cancelled) popup.error_callback({ type: "popup_closed" });
    else
      popup.callback({
        access_token: selectedToken(account),
        expires_in: 3600,
        scope: DRIVE_SCOPE
      });
    await promise;
  };
  return {
    device: makeProvider(),
    makeProvider,
    connect,
    get explicitOwner() {
      return records.get(GOOGLE_SLOT_ACTIVE_OWNER)?.activeGoogleSlotOwner ?? explicitOwner;
    },
    failPointer: () => {
      failPointer = true;
    },
    async saveAsOriginalExplicitLink() {
      const owner = records.get(GOOGLE_SLOT_ACTIVE_OWNER).activeGoogleSlotOwner;
      const credential = await vault.load(owner, DRIVE_CLIENT_ID);
      await vault.save({ ...credential, owner: explicitOwner }, new AbortController().signal);
      records.set(explicitOwner, { ...records.get(owner), enabled: true });
      records.delete(GOOGLE_SLOT_ACTIVE_OWNER);
    },
    remoteA,
    sealed,
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
  assert.equal(f.records.get(f.explicitOwner)?.explicitGoogleCredential, undefined);
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

test("selecting a second empty Google account after accepting the first awaits another choice", async (t) => {
  const f = await fixture(t, true);
  await f.device.setEnabled(true);
  await f.connect(f.device);
  await f.device.sync();
  await f.device.choose({ kind: "remote", id: revisionId });
  assert.equal(f.device.getSnapshot().phase, "idle");
  const ownerA = f.explicitOwner;
  const recordA = structuredClone(f.records.get(ownerA));
  const vaultA = structuredClone(f.sealed.get(driveCredentialId(ownerA)));

  await f.connect(f.device, false, "B");
  await f.device.sync();
  assert.equal(f.device.getSnapshot().phase, "conflict");
  assert.deepEqual(f.device.getSnapshot().conflict.remotes, []);
  assert.equal(f.applies(), 1);
  assert.notEqual(f.explicitOwner, ownerA);
  assert.equal(f.records.get(f.explicitOwner).scope, undefined);
  assert.deepEqual(f.records.get(ownerA), recordA);
  assert.deepEqual(f.sealed.get(driveCredentialId(ownerA)), vaultA);
});

test("a second account presents its own workspace without replaying an unresolved publication from A", async (t) => {
  const f = await fixture(t, true, true);
  await f.device.setEnabled(true);
  await f.connect(f.device);
  await f.device.sync();
  await f.device.choose({ kind: "remote", id: revisionId });
  const ownerA = f.explicitOwner;
  const before = structuredClone(f.records.get(ownerA));
  const pending = {
    write: {
      fileId: f.remoteA.file.id,
      key: f.remoteA.file.appProperties.mtpKey,
      baseEtag: null,
      envelope: f.remoteA.envelope
    },
    digest: before.digest
  };
  f.records.set(ownerA, { ...before, generation: before.generation + 1, pending });
  await f.connect(f.device, false, "B");
  await f.device.sync();
  assert.deepEqual(
    f.device.getSnapshot().conflict.remotes.map(({ id }) => id),
    [revisionB]
  );
  assert.equal(f.records.get(f.explicitOwner).pending, undefined);
  assert.deepEqual(f.records.get(ownerA).pending, pending);
  await f.device.choose({ kind: "remote", id: revisionB });
  assert.equal(f.device.getSnapshot().phase, "idle");
  assert.equal(f.applies(), 2);
  assert.equal(f.records.get(f.explicitOwner).scope.workspaceId, workspaceB);
  assert.equal(f.records.get(ownerA).scope.workspaceId, workspaceId);
});

test("a failed new active pointer leaves the first account and its ciphertext intact", async (t) => {
  const f = await fixture(t, true);
  await f.device.setEnabled(true);
  await f.connect(f.device);
  await f.device.sync();
  await f.device.choose({ kind: "remote", id: revisionId });
  const ownerA = f.explicitOwner;
  const prior = structuredClone(f.records.get(ownerA));
  const vaultA = structuredClone(f.sealed.get(driveCredentialId(ownerA)));
  f.failPointer();
  await f.connect(f.device, false, "B");
  await f.device.sync();
  assert.equal(f.explicitOwner, ownerA);
  assert.deepEqual(f.records.get(ownerA), prior);
  assert.deepEqual(f.sealed.get(driveCredentialId(ownerA)), vaultA);
  const reloaded = f.makeProvider();
  reloaded.resume();
  await reloaded.prepare();
  await reloaded.sync();
  assert.equal(reloaded.getSnapshot().phase, "idle");
  assert.equal(f.applies(), 1);
});

test("an already accepted fixed-namespace link restores in place and survives a cancelled new OAuth", async (t) => {
  const f = await fixture(t, true);
  await f.device.setEnabled(true);
  await f.connect(f.device);
  await f.device.sync();
  await f.device.choose({ kind: "remote", id: revisionId });
  await f.saveAsOriginalExplicitLink();
  const ownerA = f.explicitOwner;
  const vaultA = structuredClone(f.sealed.get(driveCredentialId(ownerA)));
  f.device.dispose();
  const reloaded = f.makeProvider();
  reloaded.resume();
  await reloaded.prepare();
  await reloaded.sync();
  assert.equal(reloaded.getSnapshot().phase, "idle");
  assert.equal(f.applies(), 1);
  const prior = structuredClone(f.records.get(ownerA));
  await f.connect(reloaded, true, "B");
  assert.equal(f.explicitOwner, ownerA);
  assert.deepEqual(f.records.get(ownerA), prior);
  assert.deepEqual(f.sealed.get(driveCredentialId(ownerA)), vaultA);
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
