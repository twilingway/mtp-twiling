import assert from "node:assert/strict";
import { sourceLoader, root, Store, backup, payload, tick } from "./drive-reader-guard-helpers.mjs";

export async function authPauseFixture({
  associationVersion = 1,
  automatic = true,
  remoteUnknown = true
} = {}) {
  let now = 1000000;
  const records = new Map(),
    events = [],
    localWrites = [],
    handles = [],
    prompts = [],
    revocations = [];
  const associations = new Map(),
    profile = { owner: "owner-A", session: "A-session", authenticated: true, blocked: false };
  const load = sourceLoader(root, {
    "services/storage-db.ts": {
      get: async (_store, id) => structuredClone(associations.get(id)),
      put: async (_store, record) => {
        localWrites.push(structuredClone(record));
        associations.set(record.id, structuredClone(record));
      }
    }
  });
  const { DriveAuth } = load("services/drive/auth.ts"),
    { EncryptedDriveAuthVault } = load("services/drive/auth-vault.ts");
  const { DRIVE_CLIENT_ID, DRIVE_SCOPE } = load("services/drive/types.ts");
  const { driveCredentialId } = load("services/drive/auth-credential-id.ts");
  const { DriveCoordinator } = load("services/drive/coordinator.ts"),
    { DriveSync } = load("services/drive/sync.ts");
  const { loadDriveRecord, saveDriveRecord } = load("services/drive/local.ts");
  const { driveBackupDigest } = load("services/drive/backup.ts");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
  const backend = {
    key: async () => key,
    read: async (id) => structuredClone(records.get(id)),
    write: async (record, signal) => {
      assert.equal(signal.aborted, false);
      events.push({ operation: "write", id: record.id, generation: record.credentialId });
      records.set(record.id, structuredClone(record));
    },
    remove: async (id, generation) => {
      events.push({ operation: "remove", id, generation });
      if (!generation || records.get(id)?.credentialId === generation) records.delete(id);
    }
  };
  const vault = new EncryptedDriveAuthVault(
    async () => backend,
    () => now
  );
  const credential = (owner) => ({
    version: 1,
    credentialId: crypto.randomUUID(),
    owner,
    clientId: DRIVE_CLIENT_ID,
    token: `synthetic-${owner}-not-real`,
    issuedAt: now,
    expiresAt: now + 3600000,
    scopes: [DRIVE_SCOPE]
  });
  for (const owner of ["owner-A", "owner-B"])
    await vault.save(credential(owner), new AbortController().signal);
  events.length = 0;
  const sdk = {
    initTokenClient(config) {
      return {
        requestAccessToken(prompt) {
          prompts.push(prompt);
          config.callback({
            access_token: "synthetic-manual-not-real",
            expires_in: 3600,
            scope: DRIVE_SCOPE
          });
        }
      };
    },
    revoke(token, done) {
      revocations.push(token);
      done({ successful: true });
    }
  };
  const auth = new DriveAuth(
    async () => sdk,
    () => now,
    vault
  );
  const restore = auth.restore.bind(auth),
    connect = auth.connectFromUserGesture.bind(auth);
  auth.restore = async (owner) => {
    const handle = await restore(owner);
    if (handle) handles.push({ owner, handle });
    return handle;
  };
  auth.connectFromUserGesture = (owner) =>
    connect(owner).then((handle) => {
      handles.push({ owner, handle });
      return handle;
    });
  const store = new Store(),
    node = await store.snapshot(remoteUnknown ? payload("envelope3") : backup());
  const digest = await driveBackupDigest(backup());
  for (const owner of ["owner-A", "owner-B"])
    associations.set(`drive-v2:${owner}`, {
      id: `drive-v2:${owner}`,
      owner,
      value: {
        schemaVersion: owner === "owner-A" ? associationVersion : 1,
        markerId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        baseHeads: [node.nodeId],
        lastSyncedDigest: digest,
        lastSyncedAt: "2026-11-26T00:00:00.000Z",
        automatic: owner === "owner-A" ? automatic : false
      }
    });
  const coordinator = new DriveCoordinator(
    {
      profile: () => profile,
      exportBackup: async () => backup(),
      importBackup: async () => {
        localWrites.push("portable-import");
      }
    },
    {
      auth,
      online: () => true,
      sync: () => new DriveSync(store),
      load: loadDriveRecord,
      save: saveDriveRecord
    }
  );
  async function settle(predicate) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) assert.fail("Coordinator did not settle");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await tick();
  }
  return {
    auth,
    vault,
    records,
    events,
    handles,
    localWrites,
    prompts,
    revocations,
    associations,
    store,
    coordinator,
    node,
    id: (owner = "owner-A") => driveCredentialId(owner, DRIVE_CLIENT_ID),
    loadCredential: (owner = "owner-A") => vault.load(owner, DRIVE_CLIENT_ID),
    makeAuth: (
      loader = async () => {
        assert.fail("Restore must not load Google SDK");
      }
    ) => new DriveAuth(loader, () => now, vault),
    advanceTo: (value) => {
      now = value;
    },
    settle,
    start: async () => {
      coordinator.profileChanged();
      await settle(() => ["error", "idle"].includes(coordinator.getSnapshot().phase));
    },
    changeOwner: () => {
      profile.owner = "owner-B";
      profile.session = "B-session";
      coordinator.profileChanged();
    },
    stop: () => {
      coordinator.suspend();
      auth.suspend();
    }
  };
}
