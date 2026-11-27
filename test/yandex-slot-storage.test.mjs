import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, config, localBackend } from "./helpers/yandex-source.mjs";
import { diskFixture } from "./helpers/yandex-disk.mjs";
const load = sourceLoader(),
  { YandexJournal } = load("services/yandex/journal.ts"),
  { YandexRevisions } = load("services/yandex/revisions.ts"),
  { prepareDriveBackup, driveBackupDigest } = load("services/drive/backup.ts"),
  { encodeBundle, revisionName } = load("services/yandex/bundle.ts"),
  { decodeSlot } = load("services/yandex/slot-codec.ts");
async function fixture() {
  const backend = await localBackend(),
    journal = new YandexJournal(async () => backend),
    f = diskFixture();
  const revisions = new YandexRevisions(f.transport, journal, f.auth, config.clientId);
  return { ...f, backend, journal, revisions };
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
test("new writes retain two physical files and expose readable current/previous without old DAG parents", async () => {
  const f = await fixture();
  const intervals = ["1m", "5m", "15m", "30m", "1h", "1d"];
  let first;
  for (let i = 0; i < 6; i++) {
    const revision = await write(f, intervals[i]);
    if (!first) first = revision;
    const files = [...f.files.keys()].filter((name) => name.startsWith("slot_")),
      inspected = await f.revisions.inspect(() => true);
    assert.equal(files.length, Math.min(i + 1, 2));
    assert.deepEqual(inspected.heads, [revision.revisionId]);
    assert.equal(inspected.remotes.length, Math.min(i + 1, 2));
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
  assert.equal(
    [...f.files.keys()].some((name) => name.includes(first.revisionId)),
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
  assert.equal(f.files.size, 3);
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
  assert.equal(f.files.size, 2);
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
  let once = true;
  f.hooks.afterMove = async (name) => {
    if (name.startsWith("slot_") && once) {
      once = false;
      throw new TypeError("response lost");
    }
    return new Response(null, { status: 201 });
  };
  const revision = await write(f, "2h");
  const inspected = await f.revisions.inspect(() => true);
  assert.deepEqual(inspected.heads, [revision.revisionId]);
  assert.equal(f.files.size, 2);
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
  assert.equal(f.files.size, 3);
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
  await write(other, "1m");
  const device = await journal.deviceId(),
    foreign = [...f.files.keys()];
  for (const interval of ["5m", "15m", "30m", "1h"]) await write(f, interval);
  assert.ok(foreign.every((name) => f.files.has(name)));
  assert.equal([...f.files.keys()].filter((name) => name.includes(device)).length, 1);
  assert.equal(f.files.size, 3);
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

test("cleanup removes the oldest backlog first so its ancestry evidence survives until only two files remain", async () => {
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
  assert.equal(f.files.size, 2);
  assert.equal(f.revisions.retention.phase, "complete");
  const removed = f.calls
    .slice(calls)
    .filter(({ init }) => init.method === "DELETE")
    .map(({ url }) => Number(/_(\d+)\.mtp$/.exec(url.searchParams.get("path"))[1]));
  assert.deepEqual(removed, [1, 2, 3]);
});

test("a compatible third file arriving after prune preflight still requires proof before deletion", async () => {
  const f = await fixture();
  await write(f, "1m");
  const [oldName, oldBody] = [...f.files].find(([name]) => name.startsWith("slot_"));
  await write(f, "5m");
  await write(f, "15m");
  assert.equal(f.files.size, 2);
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
      assert.equal(result.files.length, 2);
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
    assert.equal(f.files.size, 2);
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
