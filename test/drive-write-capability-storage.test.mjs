import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const ID = "private:google-write-capability:v1";
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const records = new Map();
  const hooks = {};
  const database = {
    async flush() {},
    async get(name, id) { assert.equal(name, "preferences"); if (hooks.readError) throw hooks.readError; return structuredClone(records.get(id)); },
    async all(name) { return name === "preferences" ? structuredClone([...records.values()]) : []; },
    async transaction(names, action, signal) {
      assert.deepEqual(names, ["preferences"]);
      signal?.throwIfAborted();
      const copy = structuredClone(records);
      const requests = [];
      let aborted = false;
      const tx = { abort() { aborted = true; }, objectStore(name) {
        assert.equal(name, "preferences");
        return {
          get(id) { const request = {}; requests.push(() => { request.result = copy.get(id); request.onsuccess(); }); return request; },
          put(record) { if (hooks.putError) throw hooks.putError; copy.set(record.id, structuredClone(record)); }
        };
      } };
      action(tx);
      for (const request of requests) request();
      if (hooks.beforeCommit) await hooks.beforeCommit();
      signal?.throwIfAborted();
      if (aborted) throw new DOMException("transaction aborted", "AbortError");
      if (hooks.commitError) throw hooks.commitError;
      records.clear(); for (const [id, record] of copy) records.set(id, record);
    }
  };
  const load = sourceLoader({ "services/storage-db.ts": database, "services/storage-history.ts": {} });
  const api = load("services/drive/write-capability-storage.ts");
  const { DRIVE_CLIENT_ID } = load("services/drive/types.ts");
  const proof = (credentialId = crypto.randomUUID()) => ({ credentialId, accountKey: "a".repeat(64), clientId: DRIVE_CLIENT_ID, revision: api.CAPABILITY_REVISION, protocol: 3, codec: 1, maxBytes: 2099151, verifiedAt: 100000 });
  const seed = (value) => records.set(ID, { id: ID, value: { schemaVersion: 1, proofs: [], journal: [], ...value } });
  return { ...api, database, records, hooks, load, proof, seed };
}

test("durable adapter writes one private versioned record and survives a new module instance", async () => {
  const f = fixture(), proof = f.proof();
  const signal = new AbortController().signal;
  assert.deepEqual(await f.capabilityStorage.read(), { proofs: [], journal: [] });
  await f.capabilityStorage.change((data) => f.addProof(data, proof), signal);
  assert.deepEqual([...f.records.keys()], [ID]);
  assert.equal(f.records.get(ID).value.schemaVersion, 1);
  const reloaded = sourceLoader({ "services/storage-db.ts": f.database })("services/drive/write-capability-storage.ts");
  assert.deepEqual((await reloaded.capabilityStorage.read()).proofs, [proof]);
  // Portable export has an explicit owner/view allowlist; this private record has neither.
  const portable = await f.load("services/storage.ts").createBackup("device", { includeHistory: false });
  const text = JSON.stringify(portable);
  assert.equal(text.includes(proof.credentialId), false);
  assert.equal(text.includes(proof.accountKey), false);
  assert.equal(text.includes(ID), false);
});

test("native put and commit failures never acknowledge a proof that was not durably saved", async () => {
  for (const stage of ["putError", "commitError"]) {
    const f = fixture(); f.hooks[stage] = new DOMException("quota failed", "QuotaExceededError");
    await assert.rejects(f.capabilityStorage.change((data) => f.addProof(data, f.proof()), new AbortController().signal), { name: "QuotaExceededError" });
    assert.equal(f.records.has(ID), false);
    assert.deepEqual(await f.capabilityStorage.read(), { proofs: [], journal: [] });
  }
});

test("abort after IDB request success but before native commit rolls the proof back", async () => {
  const f = fixture(), enter = deferred(), release = deferred(), controller = new AbortController();
  f.hooks.beforeCommit = async () => { enter.resolve(); await release.promise; };
  const saving = f.capabilityStorage.change((data) => f.addProof(data, f.proof()), controller.signal);
  await enter.promise;
  controller.abort(); release.resolve();
  await assert.rejects(saving, { name: "AbortError" });
  assert.equal(f.records.has(ID), false);
});

test("malformed and unsupported durable records fail closed without rewriting unknown data", async () => {
  const baseProof = fixture().proof();
  for (const value of [
    { schemaVersion: 99 },
    { proofs: [{ ...baseProof, maxBytes: -1 }] },
    { proofs: Array.from({ length: 17 }, () => ({ ...baseProof })) },
    { journal: [{ id: "user-file", key: "foreign-key", credentialId: "credential", accountKey: null }] }
  ]) {
    const f = fixture(); f.seed(value); const before = structuredClone([...f.records]);
    await assert.rejects(f.capabilityStorage.read());
    await assert.rejects(f.capabilityStorage.change(() => {}, new AbortController().signal));
    assert.deepEqual([...f.records], before);
  }
});

test("obsolete protocol/codec/transport/client evidence cannot authorize a write and permits a fresh proof", async () => {
  const f = fixture(), proof = f.proof();
  for (const mismatch of [{ protocol: 4 }, { codec: 2 }, { revision: "old-transport" }, { clientId: "another-client" }]) {
    f.seed({ proofs: [{ ...proof, ...mismatch }] });
    assert.deepEqual((await f.capabilityStorage.read()).proofs, []);
    await f.capabilityStorage.change((data) => f.addProof(data, proof), new AbortController().signal);
    assert.deepEqual((await f.capabilityStorage.read()).proofs, [proof]);
  }
});

test("durable proof still requires TTL, nonfuture time and credential or confirmed account alias", async () => {
  const f = fixture(), proof = f.proof(); f.seed({ proofs: [proof] });
  const restored = (await f.capabilityStorage.read()).proofs[0];
  assert.equal(f.usableProof(restored, proof.credentialId, null, proof.verifiedAt), true);
  assert.equal(f.usableProof(restored, "new-credential", null, proof.verifiedAt), false);
  assert.equal(f.usableProof(restored, "new-credential", "b".repeat(64), proof.verifiedAt), false);
  assert.equal(f.usableProof(restored, "new-credential", proof.accountKey, proof.verifiedAt), true);
  assert.equal(f.usableProof(restored, proof.credentialId, null, proof.verifiedAt - 1), false);
  assert.equal(f.usableProof(restored, proof.credentialId, null, proof.verifiedAt + f.CAPABILITY_TTL_MS), false);
});

test("a private journal or proof quota cannot evict unknown owned probes", async () => {
  const f = fixture(), proof = f.proof();
  const entry = { id: "probe-own", key: "00000000-0000-4000-8000-000000000001_00000000-0000-4000-8000-000000000002", credentialId: proof.credentialId, accountKey: proof.accountKey, clientId: proof.clientId, revision: proof.revision, namespace: "mtp-drive-cas-probe", kind: "device-slot", dispatched: true, createdAt: proof.verifiedAt };
  f.seed({ journal: Array.from({ length: 16 }, (_, i) => ({ ...entry, id: `probe-${i}` })) });
  const before = structuredClone([...f.records]);
  await assert.rejects(f.capabilityStorage.change((data) => f.addProbe(data, entry), new AbortController().signal), { code: "quota" });
  assert.deepEqual([...f.records], before);
});
