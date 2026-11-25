import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"), key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(specifier => load(path.relative(root, path.resolve(path.dirname(file), specifier))), module, module.exports);
    return module.exports;
  }
  return load;
}
const load = sources(), { DriveAuth } = load("services/drive/auth.ts"),
  { EncryptedDriveAuthVault } = load("services/drive/auth-vault.ts"),
  { DRIVE_CLIENT_ID, DRIVE_SCOPE } = load("services/drive/types.ts"),
  { driveCredentialId } = load("services/drive/auth-credential-id.ts"),
  { DriveTransport } = load("services/drive/transport.ts");
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const required = error => error.code === "auth-required";
async function fixture() {
  let now = 1000000;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]), records = new Map(), hooks = {};
  const backend = {
    key: async () => key,
    async read(id) { await hooks.read?.(); return structuredClone(records.get(id)); },
    async write(record, signal) { await hooks.write?.(); if (signal.aborted) throw new DOMException("cancelled", "AbortError"); records.set(record.id, structuredClone(record)); },
    async remove(id, generation) { if (!generation || records.get(id)?.credentialId === generation) records.delete(id); }
  };
  const vault = new EncryptedDriveAuthVault(async () => backend, () => now), configs = [], prompts = [], revocations = [];
  const sdk = { initTokenClient(config) { configs.push(config); return { requestAccessToken(value) { prompts.push(value); } }; }, revoke(token, done) { revocations.push(token); done({ successful: true }); } };
  const make = (loader = async () => sdk) => new DriveAuth(loader, () => now, vault);
  const accept = () => configs.at(-1).callback({ access_token: "unit-google-access", expires_in: 3600, scope: DRIVE_SCOPE });
  const connect = async auth => { await auth.prepare(); const result = auth.connectFromUserGesture("owner-A"); accept(); return result; };
  return { vault, backend, records, hooks, key, make, prompts, configs, revocations, accept, connect, advance: ms => { now += ms; } };
}

test("real AES-GCM vault survives reload without GIS or extending the original expiry", async t => {
  const f = await fixture(), first = f.make(); t.after(() => first.suspend());
  const authorization = await f.connect(first), stored = f.records.get(driveCredentialId("owner-A"));
  assert.equal(f.key.extractable, false); assert.equal(authorization.stored, true);
  assert.ok(stored.data instanceof ArrayBuffer); assert.equal(stored.token, undefined); assert.equal(stored.expiresAt, undefined); assert.equal(stored.scopes, undefined);
  assert.equal(new TextDecoder().decode(stored.data).includes("unit-google-access"), false);
  const original = await f.vault.load("owner-A", DRIVE_CLIENT_ID);
  first.suspend(); assert.equal(authorization.signal.aborted, true);
  f.advance(120000); let sdkLoads = 0;
  const second = f.make(async () => { sdkLoads++; throw new Error("SDK must not load on restore"); }); t.after(() => second.suspend());
  const restored = await second.restore("owner-A");
  assert.equal(restored.getAccessToken(), "unit-google-access"); assert.equal(restored.stored, true);
  assert.equal(sdkLoads, 0); assert.equal(f.prompts.length, 1);
  assert.equal((await f.vault.load("owner-A", DRIVE_CLIENT_ID)).expiresAt, original.expiresAt);
});

test("vault rejects other owner/client, tampering, missing scope and expired metadata", async t => {
  const f = await fixture(), auth = f.make(); t.after(() => auth.suspend()); await f.connect(auth);
  const original = structuredClone(f.records.get(driveCredentialId("owner-A")));
  for (const [owner, client] of [["owner-B", DRIVE_CLIENT_ID], ["owner-A", "other-client"]]) {
    f.records.set(driveCredentialId(owner, client), structuredClone(original));
    assert.equal(await f.vault.load(owner, client), undefined);
  }
  const credential = await f.vault.load("owner-A", DRIVE_CLIENT_ID);
  await assert.rejects(f.vault.save({ ...credential, scopes: ["openid"] }, new AbortController().signal));
  const damaged = structuredClone(original); new Uint8Array(damaged.data)[0] ^= 1;
  f.records.set(driveCredentialId("owner-A"), damaged); assert.equal(await f.vault.load("owner-A", DRIVE_CLIENT_ID), undefined);
  f.records.set(driveCredentialId("owner-A"), original); f.advance(3600000);
  assert.equal(await f.vault.load("owner-A", DRIVE_CLIENT_ID), undefined);
  assert.equal(f.records.has(driveCredentialId("owner-A")), false);
});

test("expiry and API 401 clear only their saved generation without an OAuth retry", async t => {
  for (const reason of ["expiry", "401"]) {
    const f = await fixture(), auth = f.make(); t.after(() => auth.suspend()); const active = await f.connect(auth);
    if (reason === "expiry") { f.advance(3600000); assert.throws(() => active.getAccessToken(), required); }
    else {
      const transport = new DriveTransport(active, { fetch: async () => new Response("", { status: 401 }) });
      await assert.rejects(transport.list("snapshot"), required);
    }
    await tick(); assert.equal(active.signal.aborted, true); assert.equal(f.records.size, 0); assert.equal(f.prompts.length, 1);
    assert.equal(await f.make().restore("owner-A"), undefined);
  }
});

test("old invalidation cannot erase a newer saved credential; disconnect clears and optional revoke uses current token", async t => {
  const f = await fixture(), auth = f.make(); t.after(() => auth.suspend()); const first = await f.connect(auth);
  const second = await f.connect(auth); first.invalidate(); await tick();
  assert.equal(second.signal.aborted, false); assert.equal(f.records.size, 1);
  await auth.disconnect(true); assert.equal(f.records.size, 0); assert.equal(second.signal.aborted, true);
  assert.deepEqual(f.revocations, ["unit-google-access"]);
});

test("persist failure keeps the current session usable and honestly marks it memory-only", async t => {
  const f = await fixture(), auth = f.make(); t.after(() => auth.suspend()); f.hooks.write = () => { throw new Error("unit quota"); };
  const active = await f.connect(auth);
  assert.equal(active.getAccessToken(), "unit-google-access"); assert.equal(active.stored, false); assert.equal(active.persistenceError, true);
  assert.equal(await f.make().restore("owner-A"), undefined);
});

test("logout aborts a late encrypted write and cannot resurrect saved credentials", async t => {
  const f = await fixture(), auth = f.make(); t.after(() => auth.suspend()); const gate = deferred(); let writing = false;
  f.hooks.write = async () => { writing = true; await gate.promise; };
  await auth.prepare(); const pending = auth.connectFromUserGesture("owner-A"); f.accept();
  const rejected = assert.rejects(pending, error => error.code === "auth-cancelled");
  while (!writing) await tick(); await auth.disconnect(); gate.resolve(); await rejected; await tick();
  assert.equal(f.records.size, 0); assert.equal(f.prompts.length, 1);
});

test("late restore from previous owner never authorizes the new profile", async t => {
  const f = await fixture(), original = f.make(); await f.connect(original); original.suspend();
  const gate = deferred(); let reads = 0;
  f.hooks.read = async () => { if (++reads === 1) await gate.promise; };
  const auth = f.make(); t.after(() => auth.suspend()); const old = auth.restore("owner-A");
  while (!reads) await tick(); assert.equal(await auth.restore("owner-B"), undefined);
  gate.resolve(); assert.equal(await old, undefined); assert.equal(f.prompts.length, 1);
});

test("bank logout deletes one owner's Google credential and remembered bank entry in one transaction", async () => {
  const deleted = [], transactions = [], vault = new Map([
    ["remembered", {}], [driveCredentialId("owner-A"), {}], [driveCredentialId("owner-B"), {}], ["device-key", {}]
  ]);
  const storage = sources({ "services/storage-db.ts": { transaction: async (stores, action) => {
    transactions.push(stores); action({ objectStore: name => { assert.equal(name, "vault"); return { delete(id) { deleted.push(id); vault.delete(id); } }; } });
  } } })("services/storage.ts");
  const previous = globalThis.sessionStorage; globalThis.sessionStorage = { removeItem: () => {} };
  try {
    await storage.clearSession("owner-A"); assert.equal(transactions.length, 1);
    assert.deepEqual(deleted, ["remembered", driveCredentialId("owner-A")]); assert.ok(vault.has(driveCredentialId("owner-B"))); assert.ok(vault.has("device-key"));
    await storage.clearSession(); assert.equal(deleted.at(-1), "remembered");
  } finally { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; }
});

test("device key is shared across concurrent bank/Google callers and never overwrites another tab's committed key", async () => {
  const committed = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  let adds = 0;
  const storage = sources({ "services/storage-db.ts": { get: async () => undefined, transaction: async (_stores, action) => {
    let request; action({ objectStore: () => ({ get() { request = { result: { key: committed } }; return request; }, add() { adds++; } }) });
    request.onsuccess();
  } } })("services/storage.ts");
  const keys = await Promise.all(Array.from({ length: 10 }, () => storage.deviceKey()));
  assert.ok(keys.every(key => key === committed)); assert.equal(adds, 0); assert.equal(keys[0].extractable, false);
});

test("late cleanup of malformed credential without a generation cannot erase a newer authorization", async t => {
  const f = await fixture(), auth = f.make(); t.after(() => auth.suspend());
  const id = driveCredentialId("owner-A"), gate = deferred(); let reading = false;
  f.records.set(id, { id, version: 1, iv: new Uint8Array(12), data: new ArrayBuffer(16) });
  const originalRead = f.backend.read;
  f.backend.read = async key => { const captured = structuredClone(f.records.get(key)); reading = true; await gate.promise; return captured; };
  const old = f.vault.load("owner-A", DRIVE_CLIENT_ID); while (!reading) await tick();
  await f.connect(auth); const generation = f.records.get(id).credentialId; gate.resolve();
  assert.equal(await old, undefined); assert.equal(f.records.get(id).credentialId, generation);
  f.backend.read = originalRead; assert.equal((await f.vault.load("owner-A", DRIVE_CLIENT_ID)).token, "unit-google-access");
});
