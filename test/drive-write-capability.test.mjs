import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({ "services/storage-db.ts": {} });
const { DriveWriteCapability } = load("services/drive/write-capability.ts");
const { capabilityAccountKey } = load("services/drive/write-capability-identity.ts");
const { verifiedDeviceSlotUploadBytes } = load("services/drive/device-slot-binary-probe.ts");
const { CAPABILITY_REVISION, CAPABILITY_TTL_MS, CAPABILITY_MAX_BYTES, usableProof } = load("services/drive/write-capability-storage.ts");
const { DRIVE_CLIENT_ID } = load("services/drive/types.ts");
const key = "00000000-0000-4000-8000-000000000001_00000000-0000-4000-8000-000000000002";
const accountA = "a".repeat(64), accountB = "b".repeat(64);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function memory() {
  let value = { proofs: [], journal: [] };
  return {
    async read() { return structuredClone(value); },
    async change(edit, signal) { signal.throwIfAborted(); const next = structuredClone(value); edit(next); signal.throwIfAborted(); value = next; },
    value: () => structuredClone(value)
  };
}
function authorization(id = crypto.randomUUID()) {
  const abort = new AbortController();
  return { connectionId: crypto.randomUUID(), credentialId: id, signal: abort.signal, getAccessToken: () => "synthetic-test-token", invalidate() { abort.abort(); }, abort };
}
function fixture(options = {}) {
  const auth = options.auth ?? authorization();
  const lifecycle = options.lifecycle ?? new AbortController();
  const storage = options.storage ?? memory();
  const status = [], calls = [], files = new Map();
  let count = 0;
  const fetcher = options.fetcher ?? (async (input, init) => {
    const id = new URL(input).pathname.split("/").at(-1);
    calls.push([init.method, id]);
    if (init.method === "DELETE") { files.delete(id); return new Response(null, { status: 204 }); }
    const entry = files.get(id);
    return entry ? Response.json({ id, name: `mtp-drive-cas-probe-${entry.key}`, appProperties: { mtpNamespace: "mtp-drive-cas-probe", mtpKind: "device-slot", mtpKey: entry.key } }) : new Response(null, { status: 404 });
  });
  const probe = options.probe ?? (async (_auth, _fetcher, signal, imageBytes, hooks) => {
    const id = `probe-${++count}`;
    await hooks.reserved(id, key);
    assert.equal(storage.value().journal.some((entry) => entry.id === id), true);
    await hooks.dispatch(id);
    files.set(id, { key });
    signal.throwIfAborted();
    return { fileId: id, maxBytes: 2 * imageBytes + 1999, loserStatus: 412, envelopeHash: "c".repeat(64) };
  });
  const manager = new DriveWriteCapability({ authorization: auth, fetcher, signal: lifecycle.signal, storage, now: options.now ?? (() => 1000000), check: options.check ?? (() => {}), publish: (state) => status.push(state), accountKey: options.accountKey ?? (async () => accountA), probe });
  return { manager, auth, lifecycle, storage, status, calls, files, probes: () => count };
}

test("first write automatically proves full package, journals before create and cleans only its own probe", async () => {
  const f = fixture();
  f.files.set("user-legacy", { key: "foreign" });
  const proof = await f.manager.ensure(1500000);
  assert.equal(f.probes(), 1);
  assert.equal(proof.maxBytes, 2099151);
  assert.equal(verifiedDeviceSlotUploadBytes(f.auth), proof.maxBytes);
  assert.equal(f.status[0].phase, "checking");
  assert.equal(f.status.at(-1).phase, "ready");
  assert.equal(f.storage.value().journal.length, 0);
  assert.equal(f.files.has("user-legacy"), true);
  assert.equal(f.calls.some(([, id]) => id === "user-legacy"), false);
  assert.equal(JSON.stringify(f.storage.value()).includes("synthetic-test-token"), false);
});

test("reload with same credential restores proof without network or a new probe", async () => {
  const first = fixture(); await first.manager.ensure(10);
  const restored = fixture({ auth: authorization(first.auth.credentialId), storage: first.storage, accountKey: async () => assert.fail("no about is necessary for same credential restoration"), fetcher: async () => assert.fail("no cleanup remains") });
  assert.equal(verifiedDeviceSlotUploadBytes(restored.auth), 0);
  await restored.manager.restore();
  assert.equal(restored.status.at(-1).verifiedBytes, 2099151);
  assert.equal(restored.probes(), 0);
});

test("a new credential reuses only a freshly confirmed matching account and binds its own immutable alias", async () => {
  const first = fixture(); await first.manager.ensure(10);
  let identityReads = 0;
  const next = fixture({ storage: first.storage, accountKey: async (auth) => { identityReads++; assert.equal(auth, next.auth); return accountA; } });
  await next.manager.ensure(10);
  assert.equal(identityReads, 1);
  assert.equal(next.probes(), 0);
  assert.equal(first.storage.value().proofs.some((proof) => proof.credentialId === next.auth.credentialId), true);
  for (const confirmed of [accountB, null]) {
    const other = fixture({ storage: first.storage, accountKey: async () => confirmed });
    await other.manager.ensure(10);
    assert.equal(other.probes(), 1);
  }
});

test("expired, future and mismatched transport proofs do not authorize writes", async () => {
  const first = fixture(); await first.manager.ensure(1);
  const proof = first.storage.value().proofs[0];
  assert.equal(usableProof(proof, first.auth.credentialId, accountA, proof.verifiedAt + CAPABILITY_TTL_MS), false);
  assert.equal(usableProof(proof, first.auth.credentialId, accountA, proof.verifiedAt - 1), false);
  assert.equal(usableProof({ ...proof, revision: "old-transport" }, first.auth.credentialId, accountA, proof.verifiedAt), false);
  const expired = fixture({ auth: first.auth, storage: first.storage, now: () => 1000000 + CAPABILITY_TTL_MS });
  await expired.manager.ensure(1);
  assert.equal(expired.probes(), 1);
});

test("singleflight callers share one probe and bounded capacity scales only up to the supported fixture", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.manager.ensure(100), f.manager.ensure(100)]);
  assert.equal(a.maxBytes, b.maxBytes);
  assert.equal(f.probes(), 1);
  await f.manager.ensure(3000000);
  assert.equal(f.probes(), 2);
  assert.equal(f.status.at(-1).verifiedBytes, CAPABILITY_MAX_BYTES);
  await assert.rejects(f.manager.ensure(CAPABILITY_MAX_BYTES + 1), { code: "limit" });
  assert.equal(f.probes(), 2);
});

test("Web Lock makes independent tabs reread the durable proof instead of probing twice", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const queues = new Map();
  const names = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request(name, { signal }, action) { names.push(name); const prior = queues.get(name) ?? Promise.resolve(); const work = prior.then(() => { signal.throwIfAborted(); return action(); }); queues.set(name, work.catch(() => {})); return work; } } } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, "navigator", descriptor) : delete globalThis.navigator);
  const storage = memory();
  const a = fixture({ storage }), b = fixture({ storage });
  await Promise.all([a.manager.ensure(100), b.manager.ensure(100)]);
  assert.equal(a.probes() + b.probes(), 1);
  assert.equal(names.length, 2);
  assert.equal(names[0], names[1]);
  assert.ok(names[0].includes(CAPABILITY_REVISION));
});

test("late identity and probe callbacks after switching A to B never persist or delete through B", async () => {
  const pause = deferred(), entered = deferred();
  const storage = memory();
  const a = fixture({ storage, accountKey: async () => { entered.resolve(); await pause.promise; return accountA; } });
  const old = a.manager.ensure(100);
  await entered.promise;
  a.lifecycle.abort();
  const b = fixture({ storage, accountKey: async () => accountB });
  await b.manager.ensure(100);
  pause.resolve();
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(a.probes(), 0);
  assert.equal(a.calls.length, 0);
  assert.equal(storage.value().proofs.length, 1);
  assert.equal(storage.value().proofs[0].credentialId, b.auth.credentialId);
});

test("local revision changes during proof prevent persistence and defer owned cleanup", async () => {
  let current = true;
  const f = fixture({ check: () => { if (!current) throw new DOMException("changed", "AbortError"); }, probe: async (_a, _f, _s, _b, hooks) => { await hooks.reserved("late-probe", key); await hooks.dispatch("late-probe"); current = false; return { fileId: "late-probe", maxBytes: 2099151, loserStatus: 412, envelopeHash: "a".repeat(64) }; } });
  await assert.rejects(f.manager.ensure(1), { name: "AbortError" });
  assert.equal(f.storage.value().proofs.length, 0);
  assert.equal(f.storage.value().journal.length, 1);
  assert.equal(f.calls.length, 0);
});

test("a cancelled probe A callback cannot persist evidence or clean A after B connects", async () => {
  const pause = deferred(), entered = deferred(), storage = memory();
  const a = fixture({ storage, probe: async (_a, _f, _s, _b, hooks) => {
    await hooks.reserved("late-A", key); await hooks.dispatch("late-A");
    entered.resolve(); await pause.promise;
    return { fileId: "late-A", maxBytes: 2099151, loserStatus: 412, envelopeHash: "a".repeat(64) };
  } });
  const old = a.manager.ensure(100); await entered.promise;
  a.auth.abort.abort();
  const b = fixture({ storage, accountKey: async () => accountB });
  await b.manager.ensure(100); pause.resolve();
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(a.calls.length, 0);
  assert.equal(b.calls.some(([, id]) => id === "late-A"), false);
  assert.equal(storage.value().proofs.length, 1);
  assert.equal(storage.value().proofs[0].credentialId, b.auth.credentialId);
  assert.equal(storage.value().journal[0].id, "late-A");
});

test("a failed checksum/CAS proof cannot persist capacity even after its owned create", async () => {
  const { DeviceSlotCasError } = load("services/drive/device-slot-cas.ts");
  const f = fixture({ probe: async (_a, _f, _s, _b, hooks) => {
    await hooks.reserved("bad-proof", key); await hooks.dispatch("bad-proof");
    f.files.set("bad-proof", { key });
    throw new DeviceSlotCasError("validator");
  } });
  await assert.rejects(f.manager.ensure(100), { issue: "validator" });
  assert.equal(f.storage.value().proofs.length, 0);
  assert.equal(verifiedDeviceSlotUploadBytes(f.auth), 0);
  assert.equal(f.storage.value().journal.length, 0);
});

test("unknown create with immediate 404 remains journaled and late commit is cleaned on the matching account", async () => {
  const f = fixture({ probe: async (_a, _f, _s, _b, hooks) => { await hooks.reserved("unknown-create", key); await hooks.dispatch("unknown-create"); throw Object.assign(new Error("lost create response"), { code: "network" }); } });
  await assert.rejects(f.manager.ensure(1), /lost create/);
  assert.equal(f.storage.value().journal.length, 1);
  assert.equal(f.storage.value().proofs.length, 0);
  const retry = fixture({ auth: authorization(f.auth.credentialId), storage: f.storage });
  retry.files.set("unknown-create", { key });
  await retry.manager.ensure(1);
  assert.equal(retry.files.has("unknown-create"), false);
  assert.equal(retry.storage.value().journal.length, 0);
});

test("cleanup failure is separate from proof, and subsequent retries do not run another probe", async () => {
  let deletes = 0;
  const f = fixture({ fetcher: async (_input, init) => {
    if (init.method === "DELETE") { deletes++; return new Response(null, { status: 503 }); }
    return Response.json({ id: "probe-1", name: `mtp-drive-cas-probe-${key}`, appProperties: { mtpNamespace: "mtp-drive-cas-probe", mtpKind: "device-slot", mtpKey: key } });
  } });
  await f.manager.ensure(1);
  assert.equal(f.status.at(-1).phase, "cleanup-pending");
  assert.equal(f.status.at(-1).cleanupPending, 1);
  await f.manager.ensure(1);
  assert.equal(f.probes(), 1);
  assert.equal(deletes, 2);
  assert.equal(f.storage.value().proofs.length, 1);
});

test("fresh metadata with another namespace/key/kind never receives DELETE", async () => {
  let deleted = false;
  const f = fixture({ fetcher: async (_input, init) => {
    if (init.method === "DELETE") deleted = true;
    return Response.json({ id: "probe-1", name: `mtp-drive-cas-probe-${key}`, appProperties: { mtpNamespace: "mtp-drive-v3", mtpKind: "device-slot", mtpKey: key } });
  } });
  await f.manager.ensure(1);
  assert.equal(deleted, false);
  assert.equal(f.storage.value().journal.length, 1);
});

test("journal quota fails before probe create dispatch and does not prune unknown writes", async () => {
  const storage = memory();
  const f = fixture({ storage });
  await storage.change((data) => { data.journal = Array.from({ length: 16 }, (_, i) => ({ id: `unknown-${i}`, key, credentialId: f.auth.credentialId, accountKey: accountA, clientId: DRIVE_CLIENT_ID, revision: CAPABILITY_REVISION, namespace: "mtp-drive-cas-probe", kind: "device-slot", dispatched: true, createdAt: 1 })); }, f.lifecycle.signal);
  await assert.rejects(f.manager.ensure(1), { code: "quota" });
  assert.equal(f.files.size, 0);
  assert.equal(storage.value().journal.length, 16);
});

test("about identity is hashed in memory with current auth and no additional scope", async () => {
  const a = authorization(), b = authorization();
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init]); return Response.json({ user: { permissionId: init.headers.Authorization === `Bearer ${a.getAccessToken()}` ? "account-one" : "account-two" } }); };
  const hash = await capabilityAccountKey(a, fetcher, a.signal);
  assert.match(hash, /^[a-f\d]{64}$/);
  assert.notEqual(hash, "account-one");
  assert.equal(await capabilityAccountKey(a, fetcher, a.signal), hash);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0][0]).searchParams.get("fields"), "user(permissionId)");
  b.getAccessToken = () => "another-synthetic-token";
  assert.notEqual(await capabilityAccountKey(b, fetcher, b.signal), hash);
});

test("identity network timeout falls back to credential binding; missing identity never borrows another proof", async () => {
  const auth = authorization();
  const unavailable = await capabilityAccountKey(auth, async () => { throw new DOMException("timeout", "TimeoutError"); }, auth.signal);
  assert.equal(unavailable, null);
  const f = fixture({ auth, accountKey: async () => unavailable });
  await f.manager.ensure(1);
  assert.equal(f.storage.value().proofs[0].accountKey, null);
});
