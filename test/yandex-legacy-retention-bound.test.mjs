import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, authorization } from "./helpers/yandex-source.mjs";

const load = sourceLoader(), { encodeBundle, revisionName } = load("services/yandex/bundle.ts"),
  { encodeSlot, decodeSlot } = load("services/yandex/slot-codec.ts"),
  { inspectSlots } = load("services/yandex/slot-model.ts"),
  { pruneAcceptedYandexLegacy } = load("services/yandex/accepted-retention.ts"),
  { sha256, YandexError } = load("services/yandex/types.ts");
const id = number => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;

test("the full 10000-file bound validates a deep exact-proof legacy chain before its first parent-first DELETE", async () => {
  // The provider's limit includes surviving carriers: 9,990 legacy binaries plus 10 proof carriers.
  const payload = new Blob([JSON.stringify({ application: "personal-terminal", schemaVersion: 2, drawings: [], images: [], layout: { timeframe: "1h" } })]),
    initial = await encodeBundle({ payload, images: [] }, { revisionId: id(1), deviceId: id(20000), parents: [], createdAt: "2026-11-28T00:00:00Z", digest: "a".repeat(64) }),
    remotes = [], binaries = new Map(), proofs = [], count = 9990;
  for (let offset = 0; offset < count; offset += 100) {
    const batch = await Promise.all(Array.from({ length: Math.min(100, count - offset) }, async (_, index) => {
      const seq = offset + index + 1, revision = { ...initial.revision, revisionId: id(seq), parents: seq > 1 ? [id(seq - 1)] : [] },
        header = new TextEncoder().encode(JSON.stringify(revision)), prefix = new Uint8Array(12);
      prefix.set(new TextEncoder().encode("MTPYDX01")); new DataView(prefix.buffer).setUint32(8, header.length, false);
      const body = new Blob([prefix, header, payload]), file = { name: revisionName(revision), path: `app:/mtp-yandex-v1/${revisionName(revision)}`, size: body.size, md5: "a".repeat(32), modified: "2026-11-28T00:00:00Z" };
      return { remote: { revision, file }, body, proof: { kind: "legacy", revisionId: revision.revisionId, bundle: { size: body.size, sha256: await sha256(body) } } };
    }));
    for (const item of batch) { remotes.push(item.remote); binaries.set(item.remote.file.name, item.body); proofs.push(item.proof); }
  }
  const carriers = [], carrierBodies = new Map();
  for (let index = 0; index < 10; index++) {
    const bundle = await encodeBundle({ payload, images: [] }, { revisionId: id(30000 + index), deviceId: id(40000 + index), parents: [], createdAt: "2026-11-28T00:00:00Z", digest: "a".repeat(64) }),
      envelope = { protocol: 3, generation: 1, previous: null, prunedPeers: [], acceptanceProofs: proofs.slice(index * 999, (index + 1) * 999), current: {
        seq: 1, revision: bundle.revision, bundle: bundle.reference, priorVersionHash: null,
        accepted: [{ deviceId: bundle.revision.deviceId, seq: 1, revisionId: bundle.revision.revisionId }], retired: [], legacyHeads: [id(count)]
      } }, encoded = await encodeSlot(envelope, bundle.body, null),
      file = { name: `slot_${bundle.revision.deviceId}_1.mtp`, size: encoded.body.size, md5: "b".repeat(32), modified: "2026-11-28T00:00:00Z" };
    carriers.push({ file, envelope: (await decodeSlot(encoded.body)).envelope }); carrierBodies.set(file.name, encoded.body);
  }
  const snapshot = await inspectSlots(carriers), originalFiles = [...remotes.map(item => item.file), ...carriers.map(item => item.file)];
  assert.equal(originalFiles.length, 10000);
  for (const variant of ["valid", "mismatched-proof", "cycle", "duplicate-id"]) {
    const auth = authorization(), files = new Map(originalFiles.map(file => [file.name, file])), currentRemotes = [...remotes];
    let reads = 0, deletes = 0, gates = 0;
    const currentSnapshot = structuredClone(snapshot);
    if (variant === "mismatched-proof") currentSnapshot.latest[0].envelope.acceptanceProofs[0].bundle.sha256 = "c".repeat(64);
    if (variant === "cycle") currentRemotes[0] = { ...remotes[0], revision: { ...remotes[0].revision, parents: [id(count)] } };
    if (variant === "duplicate-id") currentRemotes.push({ ...remotes[0], file: { ...remotes[0].file, name: "duplicate" } });
    const store = { snapshot: currentSnapshot, transport: {
      list: async () => [...files.values()],
      read: async file => { reads++; return binaries.get(file.name); },
      removeLegacyExact: async file => {
        deletes++; assert.equal(file.name, remotes[0].file.name); files.delete(file.name);
        auth.controller.abort(new YandexError("local-changed"));
      }
    }, body: async file => decodeSlot(carrierBodies.get(file.name)) };
    await assert.rejects(pruneAcceptedYandexLegacy(store, auth, () => true,
      async () => ({ remotes: currentRemotes, heads: snapshot.heads }), async () => { gates++; }),
      error => ["local-changed", "conflict", "remote-invalid"].includes(error.code));
    if (variant === "valid") {
      assert.equal(reads, count); assert.equal(deletes, 1); assert.equal(gates, 1);
    } else { assert.equal(deletes, 0); assert.equal(gates, 0); }
  }
});
