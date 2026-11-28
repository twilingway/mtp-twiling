import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, config, localBackend } from "./helpers/yandex-source.mjs";
import { diskFixture } from "./helpers/yandex-disk.mjs";
const load = sourceLoader(),
  { YandexJournal } = load("services/yandex/journal.ts"),
  { YandexRevisions, yandexRemotesFingerprint, validateYandexManualDeletePlan } = load("services/yandex/revisions.ts"),
  { YandexTransport } = load("services/yandex/transport.ts"),
  { prepareDriveBackup, driveBackupDigest } = load("services/drive/backup.ts"),
  { encodeBundle, revisionName } = load("services/yandex/bundle.ts"),
  { decodeSlot, encodeSlot } = load("services/yandex/slot-codec.ts");
async function fixture() {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    f = diskFixture();
  const transport = new YandexTransport(f.auth, {
    fetch: f.fetcher,
    sleep: async () => {},
    // Storage failures use explicit fetch rejections; strict deadlines have separate transport tests.
    timeoutMs: 5000
  });
  const revisions = new YandexRevisions(transport, journal, f.auth, config.clientId);
  return { ...f, backend, journal, transport, revisions };
}
function backup(timeframe = "1h") {
  return {
    application: "personal-terminal",
    schemaVersion: 2,
    drawings: [],
    images: [],
    layout: { timeframe }
  };
}
async function write(f, timeframe, explicit = true) {
  const value = backup(timeframe),
    prepared = await prepareDriveBackup(value),
    before = await f.revisions.inspect(() => true),
    revision = await f.revisions.publish(
      prepared,
      await driveBackupDigest(value),
      before.heads,
      () => true,
      explicit
    );
  await f.journal.clearPending(config.clientId, f.auth.accountId, f.auth.signal);
  return revision;
}
test("new writes retain one container with exactly the latest two physical payloads", async () => {
  const f = await fixture();
  const intervals = ["1m", "5m", "15m", "30m", "1h", "1d"];
  const revisions = [];
  for (let i = 0; i < 6; i++) {
    const revision = await write(f, intervals[i]);
    revisions.push(revision);
    const files = [...f.files.keys()].filter((name) => name.startsWith("slot_")),
      inspected = await f.revisions.inspect(() => true);
    assert.equal(files.length, 1);
    assert.deepEqual(inspected.heads, [revision.revisionId]);
    assert.equal(inspected.remotes.length, Math.min(i + 1, 2));
    const physicalIds = new Set();
    for (const name of files) {
      const decoded = await decodeSlot(f.files.get(name));
      for (const version of [decoded.envelope.current, decoded.envelope.previous])
        if (version) physicalIds.add(version.revision.revisionId);
    }
    assert.deepEqual(
      physicalIds,
      new Set(revisions.slice(-2).map(({ revisionId }) => revisionId)),
      "decode every retained container: no older payload may hide in a fallback previous body"
    );
    for (const remote of inspected.remotes) {
      const content = await f.revisions.read(remote, () => true),
        value = JSON.parse(await content.payload.text());
      assert.ok([intervals[i], intervals[i - 1]].includes(value.layout.timeframe));
    }
    assert.equal(
      [...f.files.keys()].some((name) => name.startsWith("stage_")),
      false
    );
  }
});

test("cold prune verifies both latest payloads before deleting any fallback or probing", async () => {
  for (const damaged of ["current", "previous"]) {
    const f = await fixture();
    await write(f, "1m");
    f.hooks.before = async (url, init) => {
      if (init.method === "DELETE") throw new TypeError("retain fallback for cold retry");
    };
    await write(f, "5m");
    f.hooks.before = undefined;
    const [name, body] = [...f.files].find(([key]) => key.endsWith("_2.mtp")),
      bytes = new Uint8Array(await body.arrayBuffer()),
      offset = new DataView(bytes.buffer).getUint32(8, false) + 12;
    bytes[damaged === "current" ? offset : bytes.length - 1] ^= 1;
    f.files.set(name, new Blob([bytes]));
    const before = [...f.files],
      calls = f.calls.length,
      cold = new YandexRevisions(f.transport, f.journal, f.auth, config.clientId);
    await cold.retryPrune(() => true);
    assert.equal(cold.retention.phase, "pending");
    assert.equal(cold.retention.error, "remote-invalid");
    assert.deepEqual([...f.files], before);
    assert.equal(
      f.calls.slice(calls).some(({ init }) => ["PUT", "POST", "DELETE"].includes(init.method)),
      false,
      `${damaged} corruption must stop before proof I/O and fallback deletion`
    );
  }
});

test("cold prune rejects a valid replacement body that differs from its pinned header", async () => {
  const f = await fixture();
  await write(f, "1m");
  f.hooks.before = async (url, init) => {
    if (init.method === "DELETE") throw new TypeError("retain fallback for cold retry");
  };
  await write(f, "5m");
  f.hooks.before = undefined;
  const [name, body] = [...f.files].find(([key]) => key.endsWith("_2.mtp")),
    decoded = await decodeSlot(body),
    old = decoded.envelope.current,
    revisionId = crypto.randomUUID(),
    replacement = await encodeBundle(decoded.prepared.get(old.revision.revisionId), {
      revisionId,
      deviceId: old.revision.deviceId,
      parents: old.revision.parents,
      digest: old.revision.digest,
      createdAt: old.revision.createdAt
    });
  old.revision = replacement.revision;
  old.bundle = replacement.reference;
  old.accepted.find(({ deviceId }) => deviceId === old.revision.deviceId).revisionId = revisionId;
  const substituted = await encodeSlot(decoded.envelope, replacement.body, decoded.previous),
    read = f.transport.read.bind(f.transport),
    calls = f.calls.length;
  assert.equal(substituted.body.size, body.size);
  f.transport.read = (file, limit) =>
    file.name === name ? Promise.resolve(substituted.body) : read(file, limit);
  const cold = new YandexRevisions(f.transport, f.journal, f.auth, config.clientId);
  await cold.retryPrune(() => true);
  assert.equal(cold.retention.phase, "pending");
  assert.equal(cold.retention.error, "conflict");
  assert.equal(f.files.size, 2);
  assert.equal(
    f.calls.slice(calls).some(({ init }) => ["PUT", "POST", "DELETE"].includes(init.method)),
    false
  );
});

test("a very late lower sequence is preserved as an uncertain branch until explicit resolution", async () => {
  const f = await fixture();
  await write(f, "1h");
  const [oldName, oldBody] = [...f.files].find(([name]) => name.startsWith("slot_"));
  for (const interval of ["1m", "5m", "15m", "30m"]) await write(f, interval);
  f.files.set(oldName, oldBody);
  const before = await f.revisions.inspect(() => true);
  assert.equal(before.heads.length, 2);
  assert.equal(f.files.size, 2);
  const current = backup("4h"),
    prepared = await prepareDriveBackup(current);
  await assert.rejects(
    f.revisions.publish(
      prepared,
      await driveBackupDigest(current),
      before.heads,
      () => true,
      false
    ),
    (e) => e.code === "conflict"
  );
  assert.ok(f.files.has(oldName));
  await f.journal.clearPending(config.clientId, f.auth.accountId, f.auth.signal);
  await write(f, "4h", true);
  assert.equal(f.files.size, 1);
  assert.equal((await f.revisions.inspect(() => true)).heads.length, 1);
});

test("legacy snapshots remain readable and a late dangling v1 snapshot is a visible conflict", async () => {
  const f = await fixture(),
    value = backup("5m"),
    prepared = await prepareDriveBackup(value),
    encoded = await encodeBundle(prepared, {
      revisionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      parents: [crypto.randomUUID()],
      createdAt: "2026-11-28T10:00:00Z",
      digest: await driveBackupDigest(value)
    }),
    name = revisionName(encoded.revision);
  await write(f, "1h");
  f.files.set(name, encoded.body);
  const inspected = await f.revisions.inspect(() => true);
  assert.equal(inspected.heads.length, 2);
  const remote = inspected.remotes.find(
    ({ revision }) => revision.revisionId === encoded.revision.revisionId
  );
  assert.equal(
    JSON.parse(await (await f.revisions.read(remote, () => true)).payload.text()).layout.timeframe,
    "5m"
  );
  await write(f, "2h");
  assert.ok(f.files.has(name));
  assert.equal((await f.revisions.inspect(() => true)).heads.length, 1);
});

test("a mode identity mismatch never replays, archives or deletes the pending upload", async () => {
  const f = await fixture(),
    value = backup(),
    prepared = await prepareDriveBackup(value),
    digest = await driveBackupDigest(value);
  await f.revisions.publish(prepared, digest, [], () => true, true);
  const original = await f.journal.pending(config.clientId, f.auth.accountId),
    records = structuredClone(f.backend.records),
    puts = f.puts();
  f.journal.deviceId = async () => crypto.randomUUID();
  await assert.rejects(
    f.revisions.publish(prepared, digest, [], () => true, true),
    (e) => e.code === "indeterminate"
  );
  assert.equal(f.puts(), puts);
  assert.deepEqual(f.backend.records, records);
  assert.equal(
    (await f.journal.pending(config.clientId, f.auth.accountId)).revision.revisionId,
    original.revision.revisionId
  );
});

test("an unknown move result retains staged bytes and pending intent; exact readback retry is idempotent", async () => {
  const f = await fixture();
  await write(f, "1h");
  const value = backup("2h"),
    prepared = await prepareDriveBackup(value),
    digest = await driveBackupDigest(value),
    baseline = await f.revisions.inspect(() => true);
  let lostResponses = 0;
  f.hooks.before = async (url) => {
    if (url.pathname.endsWith("/move")) {
      lostResponses++;
      throw new TypeError("MOVE response lost before its outcome was known");
    }
  };
  await assert.rejects(
    f.revisions.publish(prepared, digest, baseline.heads, () => true, true),
    (error) => error.code === "indeterminate"
  );
  assert.ok(lostResponses > 0);
  const pending = await f.journal.pending(config.clientId, f.auth.accountId),
    stage = `stage_${pending.revision.revisionId}.mtp`,
    staged = f.files.get(stage),
    puts = f.puts();
  assert.ok(staged);
  assert.equal(
    (await decodeSlot(staged)).envelope.current.revision.revisionId,
    pending.revision.revisionId
  );
  assert.equal([...f.files.keys()].filter((name) => name.startsWith("slot_")).length, 1);
  f.hooks.before = undefined;
  const revision = await f.revisions.publish(prepared, digest, baseline.heads, () => true, true),
    repeated = await f.revisions.publish(prepared, digest, baseline.heads, () => true, true);
  assert.equal(revision.revisionId, pending.revision.revisionId);
  assert.equal(repeated.revisionId, pending.revision.revisionId);
  assert.equal(f.puts(), puts);
  assert.equal(f.files.has(stage), false);
  assert.equal(
    (await f.journal.pending(config.clientId, f.auth.accountId)).revision.revisionId,
    pending.revision.revisionId
  );
  await f.journal.clearPending(config.clientId, f.auth.accountId, f.auth.signal);
  const inspected = await f.revisions.inspect(() => true);
  assert.deepEqual(inspected.heads, [revision.revisionId]);
  assert.equal(f.files.size, 1);
  for (const body of f.files.values()) assert.ok((await decodeSlot(body)).current.size > 0);
});

test("a lost response after committed MOVE is reconciled by exact readback without another upload", async () => {
  const f = await fixture();
  await write(f, "1h");
  let once = true;
  f.hooks.afterMove = async (name) => {
    if (name.startsWith("slot_") && once) {
      once = false;
      throw new TypeError("response lost");
    }
    return new Response(null, { status: 201 });
  };
  const revision = await write(f, "2h");
  assert.equal(once, false);
  assert.equal(f.puts(), 2);
  const inspected = await f.revisions.inspect(() => true);
  assert.deepEqual(inspected.heads, [revision.revisionId]);
  assert.equal(f.files.size, 1);
  for (const body of f.files.values()) assert.ok((await decodeSlot(body)).current.size > 0);
});

test("read-only inspection never prunes a provably obsolete returned file", async () => {
  const f = await fixture();
  await write(f, "1m");
  const [oldName, oldBody] = [...f.files].find(([name]) => name.startsWith("slot_"));
  await write(f, "5m");
  await write(f, "15m");
  f.files.set(oldName, oldBody);
  const count = f.calls.length;
  const inspected = await f.revisions.inspect(() => true);
  assert.equal(inspected.heads.length, 1);
  assert.equal(f.files.size, 2);
  assert.equal(
    f.calls.slice(count).some(({ init }) => ["PUT", "POST", "DELETE"].includes(init.method)),
    false
  );
});

test("two independent testing writers claim one deterministic sequence without overwriting each other", async () => {
  const f = await fixture(),
    backend = await localBackend(),
    otherJournal = new YandexJournal(async () => backend),
    device = "00000000-0000-4000-8000-000000000001";
  f.journal.deviceId = async () => device;
  otherJournal.deviceId = async () => device;
  const other = new YandexRevisions(f.transport, otherJournal, f.auth, config.clientId),
    values = [backup("1m"), backup("5m")],
    prepared = await Promise.all(values.map(prepareDriveBackup)),
    digests = await Promise.all(values.map(driveBackupDigest));
  const results = await Promise.allSettled([
    f.revisions.publish(prepared[0], digests[0], [], () => true, true),
    other.publish(prepared[1], digests[1], [], () => true, true)
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(f.files.size, 1);
  assert.ok(await f.journal.pending(config.clientId, f.auth.accountId));
  assert.ok(await otherJournal.pending(config.clientId, f.auth.accountId));
});

test("retention on one ordinary client leaves the other client's physical files intact", async () => {
  const f = await fixture(),
    backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    other = {
      ...f,
      journal,
      revisions: new YandexRevisions(f.transport, journal, f.auth, config.clientId)
    };
  for (const interval of ["1m", "5m", "15m"]) await write(other, interval);
  const device = await journal.deviceId(),
    foreign = new Map(f.files);
  for (const interval of ["5m", "15m", "30m", "1h"]) await write(f, interval);
  for (const [name, body] of foreign) assert.equal(f.files.get(name), body);
  assert.equal([...f.files.keys()].filter((name) => name.includes(device)).length, 1);
  assert.equal(f.files.size, 2);
});

test("a new peer after the pinned inspection cannot be silently accepted by a direct adapter publish", async () => {
  const f = await fixture(),
    backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    other = new YandexRevisions(f.transport, journal, f.auth, config.clientId),
    ownValue = backup("1m"),
    peerValue = backup("5m"),
    ownPrepared = await prepareDriveBackup(ownValue),
    peerPrepared = await prepareDriveBackup(peerValue),
    original = f.revisions.inspect.bind(f.revisions);
  let peer;
  f.revisions.inspect = async (valid) => {
    const result = await original(valid);
    if (!peer)
      peer = await other.publish(
        peerPrepared,
        await driveBackupDigest(peerValue),
        [],
        () => true,
        true
      );
    return result;
  };
  await assert.rejects(
    f.revisions.publish(ownPrepared, await driveBackupDigest(ownValue), [], () => true, true),
    (error) => error.code === "local-changed"
  );
  f.revisions.inspect = original;
  const inspected = await original(() => true);
  assert.deepEqual(inspected.heads, [peer.revisionId]);
  assert.equal(inspected.remotes.length, 1);
  assert.ok(await f.journal.pending(config.clientId, f.auth.accountId));
  assert.equal(f.files.size, 1);
});

test("same-digest pending intent cannot silently acquire a new causal baseline", async () => {
  const f = await fixture(),
    value = backup("1m"),
    prepared = await prepareDriveBackup(value),
    digest = await driveBackupDigest(value),
    deviceId = await f.journal.deviceId(),
    encoded = await encodeBundle(prepared, {
      deviceId,
      revisionId: crypto.randomUUID(),
      parents: [],
      createdAt: "2026-11-28T10:00:00Z",
      digest
    });
  await f.journal.savePending(
    config.clientId,
    {
      version: 1,
      accountId: f.auth.accountId,
      credentialGeneration: f.auth.credentialGeneration,
      name: revisionName(encoded.revision),
      ...encoded
    },
    f.auth.signal
  );
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    peer = {
      ...f,
      journal,
      revisions: new YandexRevisions(f.transport, journal, f.auth, config.clientId)
    },
    peerRevision = await write(peer, "5m"),
    records = structuredClone(f.backend.records);
  await assert.rejects(
    f.revisions.publish(prepared, digest, [peerRevision.revisionId], () => true, false),
    (error) => error.code === "indeterminate"
  );
  assert.deepEqual(f.backend.records, records);
  const resolved = await f.revisions.publish(
    prepared,
    digest,
    [peerRevision.revisionId],
    () => true,
    true
  );
  assert.notEqual(resolved.revisionId, encoded.revision.revisionId);
  assert.deepEqual(resolved.parents, [peerRevision.revisionId]);
  assert.equal(
    (await f.journal.pending(config.clientId, f.auth.accountId)).revision.revisionId,
    resolved.revisionId
  );
  assert.ok(
    [...f.backend.records.keys()].some((key) =>
      key.endsWith(`unconfirmed:${encoded.revision.revisionId}`)
    )
  );
});

test("cleanup removes the oldest backlog first until one latest-two carrier remains", async () => {
  const f = await fixture();
  f.hooks.before = async (url, init) => {
    if (
      init.method === "DELETE" &&
      url.searchParams.get("path")?.split("/").at(-1).startsWith("slot_")
    )
      throw new TypeError("offline cleanup");
  };
  for (const interval of ["1m", "5m", "15m", "30m", "1h"]) await write(f, interval);
  assert.equal(f.files.size, 5);
  assert.equal(f.revisions.retention.phase, "pending");
  f.hooks.before = undefined;
  const calls = f.calls.length;
  await f.revisions.retryPrune(() => true);
  assert.equal(f.files.size, 1);
  assert.equal(f.revisions.retention.phase, "complete");
  const removed = f.calls
    .slice(calls)
    .filter(({ init }) => init.method === "DELETE")
    .map(({ url }) => Number(/_(\d+)\.mtp$/.exec(url.searchParams.get("path"))[1]));
  assert.deepEqual(removed, [1, 2, 3, 4]);
});

test("a compatible second file arriving after prune preflight still requires proof before deletion", async () => {
  const f = await fixture();
  await write(f, "1m");
  const [oldName, oldBody] = [...f.files].find(([name]) => name.startsWith("slot_"));
  await write(f, "5m");
  await write(f, "15m");
  assert.equal(f.files.size, 1);
  const proof = load("services/yandex/slot-proof.ts"),
    ensure = proof.ensureYandexRetentionProof,
    inspect = f.revisions.slots.inspect.bind(f.revisions.slots),
    events = [];
  let proofCalls = 0,
    preflight = true;
  proof.ensureYandexRetentionProof = async (...args) => {
    proofCalls++;
    events.push("proof");
    return ensure(...args);
  };
  f.revisions.slots.inspect = async (...args) => {
    const result = await inspect(...args);
    if (preflight) {
      preflight = false;
      assert.equal(result.files.length, 1);
      f.files.set(oldName, oldBody);
    }
    return result;
  };
  f.hooks.before = async (url, init) => {
    if (
      init.method === "DELETE" &&
      url.searchParams.get("path")?.split("/").at(-1).startsWith("slot_")
    ) {
      events.push("delete");
      assert.equal(proofCalls, 1);
    }
  };
  try {
    await f.revisions.retryPrune(() => true);
    assert.equal(proofCalls, 1);
    assert.deepEqual(events, ["proof", "delete"]);
    assert.equal(f.files.size, 1);
    assert.equal(f.revisions.retention.phase, "complete");
    assert.equal(f.revisions.retention.deletedFiles, 1);
  } finally {
    proof.ensureYandexRetentionProof = ensure;
  }
});

test("pruning one retained file never launches a capability probe or mutation", async () => {
  const f = await fixture();
  await write(f, "1m");
  const proof = load("services/yandex/slot-proof.ts"),
    ensure = proof.ensureYandexRetentionProof,
    calls = f.calls.length;
  let proofCalls = 0;
  proof.ensureYandexRetentionProof = async () => {
    proofCalls++;
    throw new Error("Unexpected proof");
  };
  try {
    await f.revisions.retryPrune(() => true);
    assert.equal(proofCalls, 0);
    assert.equal(f.revisions.retention.phase, "complete");
    assert.equal(
      f.calls.slice(calls).some(({ init }) => ["PUT", "POST", "DELETE"].includes(init.method)),
      false
    );
  } finally {
    proof.ensureYandexRetentionProof = ensure;
  }
});


async function deletePlan(f, revisionId) {
  const inspected=await f.revisions.inspect(()=>true);
  return f.revisions.manualDeletePlan(revisionId,yandexRemotesFingerprint(inspected.remotes),()=>true);
}
test("manual previous deletion rewrites only physical generation, removes real payload and preserves exact current",async()=>{
  const f=await fixture(), first=await write(f,"1m"), current=await write(f,"5m");
  const [oldName,oldBody]=[...f.files].find(([name])=>name.startsWith("slot_")),
    before=await decodeSlot(oldBody), inspected=await f.revisions.inspect(()=>true),
    capabilities=await f.revisions.manualDeleteCapabilities(inspected.remotes,inspected.heads);
  assert.equal(capabilities[first.revisionId].allowed,true);
  assert.equal(capabilities[current.revisionId].allowed,false);
  const plan=await deletePlan(f,first.revisionId), cloned=structuredClone(plan);
  assert.equal((await validateYandexManualDeletePlan(cloned)).operationId,plan.operationId);
  const result=await f.revisions.executeManualDelete(cloned,()=>true);
  assert.equal(result.remotes.length,1);
  assert.deepEqual(result.heads,[current.revisionId]);
  assert.equal(f.files.has(oldName),false);
  assert.equal(f.files.size,1);
  const [name,body]=[...f.files][0],after=await decodeSlot(body);
  assert.ok(name.endsWith("_3.mtp"));
  assert.equal(after.envelope.protocol,3);
  assert.equal(after.envelope.generation,3);
  assert.equal(after.envelope.current.seq,2);
  assert.deepEqual(after.envelope.current,before.envelope.current);
  assert.deepEqual(new Uint8Array(await after.current.arrayBuffer()),new Uint8Array(await before.current.arrayBuffer()));
  assert.equal(after.previous,null);
  assert.equal(after.envelope.previous,null);
  assert.equal(JSON.parse(await (await f.revisions.read(result.remotes[0],()=>true)).payload.text()).layout.timeframe,"5m");
  const repeated=await f.revisions.executeManualDelete(plan,()=>true);
  assert.equal(repeated.remotes.length,1);
  const next=await write(f,"15m");
  const [nextName,nextBody]=[...f.files][0],nextDecoded=await decodeSlot(nextBody);
  assert.ok(nextName.endsWith("_4.mtp"));
  assert.equal(nextDecoded.envelope.current.seq,3);
  assert.equal(nextDecoded.envelope.previous.revision.revisionId,current.revisionId);
  assert.equal(nextDecoded.envelope.current.revision.revisionId,next.revisionId);
});

test("manual cleanup removes every old physical carrier containing selected previous without a new logical save",async()=>{
  const f=await fixture();
  f.hooks.before=async(url,init)=>{
    if(init.method==="DELETE"&&url.searchParams.get("path")?.split("/").at(-1).startsWith("slot_"))
      throw new TypeError("defer automatic cleanup");
  };
  const first=await write(f,"1m"),previous=await write(f,"5m"),current=await write(f,"15m");
  f.hooks.before=undefined;
  assert.equal(f.files.size,3);
  const list=f.transport.list.bind(f.transport);
  f.transport.list=async()=>[...await list()].reverse();
  const plan=await deletePlan(f,previous.revisionId);
  assert.deepEqual(plan.candidates.map(file=>Number(/_(\d+)\.mtp$/.exec(file.name)[1])),[1,2,3]);
  const result=await f.revisions.executeManualDelete(plan,()=>true);
  assert.deepEqual(result.heads,[current.revisionId]);
  assert.deepEqual(result.remotes.map(item=>item.revision.revisionId),[current.revisionId]);
  for(const body of f.files.values()) {
    const decoded=await decodeSlot(body);
    assert.notEqual(decoded.envelope.current.revision.revisionId,previous.revisionId);
    assert.notEqual(decoded.envelope.previous?.revision.revisionId,previous.revisionId);
  }
  assert.equal(f.files.size,1);
  assert.equal(result.remotes.some(item=>item.revision.revisionId===first.revisionId),false);
});

test("retired-peer deletion persists its exact proof before DELETE and stays readable on cold inspect and next publish",async()=>{
  const f=await fixture(),backend=await localBackend(),journal=new YandexJournal(async()=>backend),
    peer={...f,journal,revisions:new YandexRevisions(f.transport,journal,f.auth,config.clientId)};
  const oldPeer=await write(peer,"1m"),own=await write(f,"5m"),
    plan=await deletePlan(f,oldPeer.revisionId),peerDevice=oldPeer.deviceId;
  assert.equal(plan.kind,"retired-peer");
  let payloadDeletes=0;
  f.hooks.before=async(url,init)=>{
    const name=url.searchParams.get("path")?.split("/").at(-1);
    if(init.method==="DELETE"&&name?.startsWith("slot_")) {
      const survivors=[];
      for(const [key,body]of f.files) if(key.startsWith("slot_")&&!key.includes(peerDevice)) survivors.push(await decodeSlot(body));
      assert.ok(survivors.some(item=>item.envelope.protocol===3&&item.envelope.prunedPeers.some(p=>p.revisionId===oldPeer.revisionId)));
      payloadDeletes++;
    }
  };
  const result=await f.revisions.executeManualDelete(plan,()=>true);
  assert.equal(payloadDeletes,2);
  assert.equal(f.files.size,1);
  assert.equal([...f.files.keys()].some(name=>name.includes(peerDevice)),false);
  assert.deepEqual(result.heads,[own.revisionId]);
  const cold=new YandexRevisions(f.transport,f.journal,f.auth,config.clientId);
  assert.deepEqual((await cold.inspect(()=>true)).heads,[own.revisionId]);
  f.hooks.before=undefined;
  const next=await write(f,"15m");
  const decoded=await decodeSlot([...f.files.values()][0]);
  assert.equal(decoded.envelope.current.revision.revisionId,next.revisionId);
  assert.ok(decoded.envelope.prunedPeers.some(p=>p.revisionId===oldPeer.revisionId));
});

test("current/independent heads and unknown lower branches cannot be manually deleted",async()=>{
  const f=await fixture(),own=await write(f,"1m");
  await assert.rejects(deletePlan(f,own.revisionId),e=>e.code==="permission");
  const backend=await localBackend(),journal=new YandexJournal(async()=>backend),
    peer={...f,journal,revisions:new YandexRevisions(f.transport,journal,f.auth,config.clientId)};
  const independent=await write(peer,"5m");
  // The first client's older current is now dominated, but the only new independent head stays protected.
  await assert.rejects(deletePlan(f,independent.revisionId),e=>e.code==="permission");
});

test("cold manual resume reconciles committed replacement after DELETE failure and never creates a new save",async()=>{
  const f=await fixture(),previous=await write(f,"1m"),current=await write(f,"5m"),plan=await deletePlan(f,previous.revisionId);
  f.hooks.before=async(url,init)=>{
    if(init.method==="DELETE"&&url.searchParams.get("path")?.split("/").at(-1).startsWith("slot_"))throw new TypeError("offline after commit");
  };
  await assert.rejects(f.revisions.executeManualDelete(plan,()=>true));
  assert.equal([...f.files.keys()].filter(n=>n.startsWith("slot_")).length,2);
  const puts=f.puts();f.hooks.before=undefined;
  const cold=new YandexRevisions(f.transport,f.journal,f.auth,config.clientId),result=await cold.executeManualDelete(structuredClone(plan),()=>true);
  assert.equal(f.puts(),puts);
  assert.equal(result.remotes.length,1);
  assert.deepEqual(result.heads,[current.revisionId]);
  assert.equal(f.files.size,1);
});

test("a new cloud file after manual planning blocks every mutation and preserves all existing bytes",async()=>{
  const f=await fixture(),previous=await write(f,"1m");await write(f,"5m");
  const plan=await deletePlan(f,previous.revisionId),other=await encodeBundle(await prepareDriveBackup(backup("15m")),{
    revisionId:crypto.randomUUID(),deviceId:crypto.randomUUID(),parents:[],digest:"a".repeat(64),createdAt:"2026-11-28T00:00:00Z"});
  f.files.set(revisionName(other.revision),other.body);
  const before=new Map(f.files),calls=f.calls.length;
  await assert.rejects(f.revisions.executeManualDelete(plan,()=>true),e=>e.code==="conflict");
  assert.deepEqual(f.files,before);
  assert.equal(f.calls.slice(calls).some(({init})=>["PUT","POST","DELETE"].includes(init.method)),false);
});

test("revoked local guard and wrong account/generation never dispatch manual mutations",async()=>{
  const f=await fixture(),previous=await write(f,"1m");await write(f,"5m");
  const plan=await deletePlan(f,previous.revisionId),before=new Map(f.files),calls=f.calls.length;
  await assert.rejects(f.revisions.executeManualDelete(plan,()=>false),e=>e.code==="local-changed");
  for(const field of ["accountId","credentialGeneration"])await assert.rejects(
    f.revisions.executeManualDelete({...plan,[field]:"different"},()=>true),e=>e.code==="local-changed");
  assert.deepEqual(f.files,before);
  assert.equal(f.calls.slice(calls).some(({init})=>["PUT","POST","DELETE"].includes(init.method)),false);
});


test("frozen v2 magic dispatch sees a known v3 slot filename and stops before upload/delete",async()=>{
  const f=await fixture();await write(f,"1m");
  const legacyLoad=sourceLoader(),legacyCodec=legacyLoad("services/yandex/slot-codec.ts"),
    {revisionHeaderSize}=legacyLoad("services/yandex/bundle.ts"),
    {YandexError}=legacyLoad("services/yandex/types.ts"),
    {YandexRevisions:LegacyClient}=legacyLoad("services/yandex/revisions.ts");
  // Frozen pre-v3 implementation of its known-file header dispatch. No unknown-name filtering.
  async function v2HeaderSize(prefix) {
    const bytes=new Uint8Array(await prefix.slice(0,12).arrayBuffer());
    if(bytes.length!==12||new TextDecoder().decode(bytes.slice(0,8))!=="MTPYDX02")throw new YandexError("unsupported-format");
    const size=new DataView(bytes.buffer).getUint32(8,false);
    if(!size||size>256*1024)throw new YandexError("limit");
    return size+12;
  }
  legacyCodec.yandexHeaderSize=async prefix=>new TextDecoder().decode(await prefix.slice(0,8).arrayBuffer())==="MTPYDX02"
    ?v2HeaderSize(prefix):revisionHeaderSize(prefix);
  const old=new LegacyClient(f.transport,f.journal,f.auth,config.clientId),calls=f.calls.length,before=new Map(f.files);
  await assert.rejects(old.inspect(()=>true),e=>e.code==="unsupported-format");
  assert.deepEqual(f.files,before);
  assert.equal(f.calls.slice(calls).some(({init})=>["PUT","POST","DELETE"].includes(init.method)),false);
});

test("stale v2 writer arriving after maintenance is a preserved conflict and cannot authorize cleanup",async()=>{
  const f=await fixture(),previous=await write(f,"1m");await write(f,"5m");
  const before=await decodeSlot([...f.files.values()][0]),
    plan=await deletePlan(f,previous.revisionId);
  await f.revisions.executeManualDelete(plan,()=>true);
  const newer=await write(f,"15m"),newDecoded=await decodeSlot([...f.files.values()][0]);
  // It was in flight before maintenance, and claims its logical seq as physical generation.
  const pending=await encodeBundle(await prepareDriveBackup(backup("30m")),{
    revisionId:crypto.randomUUID(),deviceId:newer.deviceId,parents:[before.envelope.current.revision.revisionId],
    digest:"a".repeat(64),createdAt:"2026-11-28T00:00:00Z"}),
    stale={...newDecoded.envelope.current,revision:pending.revision,bundle:pending.reference,
      accepted:[{deviceId:newer.deviceId,seq:3,revisionId:pending.revision.revisionId}]},
    v2=await encodeSlot({protocol:2,current:stale,previous:before.envelope.current},pending.body,before.current),
    name=`slot_${newer.deviceId}_3.mtp`;
  f.files.set(name,v2.body);
  const files=new Map(f.files),calls=f.calls.length;
  await assert.rejects(f.revisions.inspect(()=>true),e=>e.code==="conflict");
  await f.revisions.retryPrune(()=>true);
  assert.equal(f.revisions.retention.phase,"pending");
  assert.deepEqual(f.files,files);
  assert.equal(f.calls.slice(calls).some(({init})=>["PUT","POST","DELETE"].includes(init.method)),false);
});


test("cold retry after an acknowledged-by-server DELETE with lost response accepts only its verified replacement",async()=>{
  const f=await fixture(),previous=await write(f,"1m"),current=await write(f,"5m"),plan=await deletePlan(f,previous.revisionId),
    original=f.transport.removeExact.bind(f.transport);
  let lost=true;
  f.transport.removeExact=async(file,valid)=>{
    await original(file,valid);
    if(lost&&file.name.startsWith("slot_")){lost=false;throw new Error("response lost after exact DELETE");}
  };
  await assert.rejects(f.revisions.executeManualDelete(plan,()=>true));
  const puts=f.puts(),cold=new YandexRevisions(f.transport,f.journal,f.auth,config.clientId);
  assert.deepEqual((await cold.executeManualDelete(plan,()=>true)).heads,[current.revisionId]);
  assert.equal(f.puts(),puts);assert.equal(f.files.size,1);
});

test("exact candidate replacement at DELETE dispatch fails md5 CAS and keeps all replacement bytes",async()=>{
  const f=await fixture(),previous=await write(f,"1m");await write(f,"5m");
  const plan=await deletePlan(f,previous.revisionId),candidate=plan.candidates[0];
  let replaced;
  f.hooks.before=async(url,init)=>{
    if(init.method==="DELETE"&&url.searchParams.get("path")?.endsWith(candidate.name)){
      replaced=new Blob(["changed after the final listing pin"]);f.files.set(candidate.name,replaced);
    }
  };
  await assert.rejects(f.revisions.executeManualDelete(plan,()=>true),e=>e.code==="conflict");
  assert.equal(f.files.get(candidate.name),replaced);
  assert.ok(f.files.has(plan.replacements[0].destination));
});

test("a new independent peer during first payload DELETE stops the remainder and preserves the unexpected head",async()=>{
  const f=await fixture(),previous=await write(f,"1m");await write(f,"5m");
  const plan=await deletePlan(f,previous.revisionId),
    other=await encodeBundle(await prepareDriveBackup(backup("15m")),{
      revisionId:crypto.randomUUID(),deviceId:crypto.randomUUID(),parents:[],digest:"b".repeat(64),createdAt:"2026-11-28T00:00:00Z"}),
    otherName=revisionName(other.revision);
  let injected=false;
  f.hooks.before=async(url,init)=>{
    if(!injected&&init.method==="DELETE"&&url.searchParams.get("path")?.split("/").at(-1).startsWith("slot_")){
      injected=true;f.files.set(otherName,other.body);
    }
  };
  await assert.rejects(f.revisions.executeManualDelete(plan,()=>true),e=>e.code==="conflict");
  assert.equal(f.files.get(otherName),other.body);
  assert.ok(f.files.has(plan.replacements[0].destination));
});

test("nested retired peer proofs survive retiring their carrier and ordinary subsequent publications",async()=>{
  const f=await fixture(),makePeer=async()=>{
    const backend=await localBackend(),journal=new YandexJournal(async()=>backend);
    return {...f,journal,revisions:new YandexRevisions(f.transport,journal,f.auth,config.clientId)};
  },c=await makePeer(),b=await makePeer(),cRev=await write(c,"1m"),bRev=await write(b,"5m");
  await b.revisions.executeManualDelete(await deletePlan(b,cRev.revisionId),()=>true);
  const aRev=await write(f,"15m");
  await f.revisions.executeManualDelete(await deletePlan(f,bRev.revisionId),()=>true);
  assert.equal(f.files.size,1);
  const cold=new YandexRevisions(f.transport,f.journal,f.auth,config.clientId);
  assert.deepEqual((await cold.inspect(()=>true)).heads,[aRev.revisionId]);
  let decoded=await decodeSlot([...f.files.values()][0]);
  assert.deepEqual(new Set(decoded.envelope.prunedPeers.map(item=>item.revisionId)),new Set([bRev.revisionId,cRev.revisionId]));
  await write(f,"30m");decoded=await decodeSlot([...f.files.values()][0]);
  assert.equal(decoded.envelope.prunedPeers.length,2);
});


test("persisted manual intent rejects malformed metadata, altered delete set and mismatched replacement bytes",async()=>{
  const f=await fixture(),previous=await write(f,"1m");await write(f,"5m");
  const plan=await deletePlan(f,previous.revisionId),cases=[
    {...plan,candidates:[null]},
    {...plan,candidates:[]},
    {...plan,beforeSlots:[]},
    {...plan,protectedCurrents:[]},
    {...plan,replacements:[{...plan.replacements[0],body:new Blob(["bad"])}]}
  ];
  const before=new Map(f.files),calls=f.calls.length;
  for(const value of cases)await assert.rejects(validateYandexManualDeletePlan(value),e=>e.code==="remote-invalid");
  assert.deepEqual(f.files,before);assert.equal(f.calls.length,calls);
});


test("forged persisted beforeSlots cannot retire the real independent B2 current at genuine metadata",async()=>{
  const f=await fixture(),backend=await localBackend(),journal=new YandexJournal(async()=>backend),
    b={...f,journal,revisions:new YandexRevisions(f.transport,journal,f.auth,config.clientId)},
    b1=await write(b,"1m"),b1Decoded=await decodeSlot([...f.files.values()][0]);
  await write(f,"5m");
  const b2=await write(b,"15m"),actual=await f.revisions.inspect(()=>true);
  assert.deepEqual(actual.heads,[b2.revisionId]);
  const {inspectSlots}=load("services/yandex/slot-model.ts"),
    {createSlotMaintenancePlan}=load("services/yandex/slot-maintenance-plan.ts"),
    files=await f.transport.list(),realSnapshot=f.revisions.slots.snapshot,
    forgedFiles=realSnapshot.files.map(item=>item.envelope.current.revision.deviceId===b1.deviceId
      ?{file:item.file,envelope:{protocol:3,generation:2,current:b1Decoded.envelope.current,previous:null,prunedPeers:[]}}
      :item),
    fakeStore={snapshot:await inspectSlots(forgedFiles),body:f.revisions.slots.body.bind(f.revisions.slots)},
    plan=await createSlotMaintenancePlan(fakeStore,files,b1.revisionId,actual.heads,f.auth,()=>true);
  assert.equal((await validateYandexManualDeletePlan(plan)).remoteId,b1.revisionId);
  for(const partial of [false,true]) {
    if(partial) {
      // Simulate cold recovery with a replacement already present and its old carrier gone.
      f.files.set(plan.replacements[0].destination,plan.replacements[0].body);
      f.files.delete(plan.candidates.find(file=>!file.name.includes(b1.deviceId)).name);
    }
    const before=new Map(f.files),calls=f.calls.length,
      cold=new YandexRevisions(f.transport,f.journal,f.auth,config.clientId);
    await assert.rejects(cold.executeManualDelete(structuredClone(plan),()=>true),e=>e.code==="conflict");
    assert.deepEqual(f.files,before);
    assert.equal(f.calls.slice(calls).some(({init})=>["PUT","POST","DELETE"].includes(init.method)),false);
    assert.ok([...f.files.keys()].some(name=>name.includes(b2.deviceId)));
  }
});

test("own dominated current remains protected and read-only capability checks never generate an identity",async()=>{
  const f=await fixture();
  await f.journal.saveSettings({enabled:true,automatic:false,clientMode:"normal"},f.auth.signal);
  const own=await write(f,"1m"),backend=await localBackend(),journal=new YandexJournal(async()=>backend),
    b={...f,journal,revisions:new YandexRevisions(f.transport,journal,f.auth,config.clientId)};
  await write(b,"5m");
  f.journal.deviceId=async()=>{throw new Error("read-only deletion checks must never generate identity")};
  const current=await f.revisions.inspect(()=>true),cap=await f.revisions.manualDeleteCapabilities(current.remotes,current.heads);
  assert.deepEqual(cap[own.revisionId],{kind:"current",allowed:false,reason:"current"});
  const calls=f.calls.length;
  await assert.rejects(f.revisions.manualDeletePlan(own.revisionId,yandexRemotesFingerprint(current.remotes),()=>true),e=>e.code==="permission");
  assert.equal(f.calls.slice(calls).some(({init})=>["PUT","POST","DELETE"].includes(init.method)),false);
});

test("retired peer capability counts every unique physical payload including deferred obsolete containers",async()=>{
  const f=await fixture(),backend=await localBackend(),journal=new YandexJournal(async()=>backend),
    b={...f,journal,revisions:new YandexRevisions(f.transport,journal,f.auth,config.clientId)};
  f.hooks.before=async(url,init)=>{
    if(init.method==="DELETE"&&url.searchParams.get("path")?.split("/").at(-1).startsWith("slot_"))throw new TypeError("keep backlog");
  };
  await write(b,"1m");const previous=await write(b,"5m"),current=await write(b,"15m");
  f.hooks.before=undefined;await write(f,"30m");
  const inspected=await f.revisions.inspect(()=>true),cap=await f.revisions.manualDeleteCapabilities(inspected.remotes,inspected.heads);
  assert.equal(cap[current.revisionId].allowed,true);assert.equal(cap[current.revisionId].versions,3);
  assert.equal(cap[previous.revisionId].versions,1);
});
