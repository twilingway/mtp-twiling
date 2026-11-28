import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/yandex-source.mjs";

const load = sourceLoader(),
  { encodeBundle } = load("services/yandex/bundle.ts"),
  { encodeSlot, decodeSlot } = load("services/yandex/slot-codec.ts"),
  { parseSlotEnvelope, inspectSlots } = load("services/yandex/slot-model.ts"),
  { parseSlotAcceptanceProofs, mergeSlotAcceptanceProofs } = load("services/yandex/slot-acceptance.ts");
const id = number => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const proof = { kind: "legacy", revisionId: id(100), bundle: { size: 12, sha256: "a".repeat(64) } };
async function base() {
  const payload = new Blob([JSON.stringify({ application: "personal-terminal", schemaVersion: 2, drawings: [], images: [], layout: { timeframe: "1h" } })]);
  const bundle = await encodeBundle({ payload, images: [] }, {
    revisionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), parents: [],
    digest: "a".repeat(64), createdAt: "2026-11-28T00:00:00Z"
  });
  return { body: bundle.body, envelope: { protocol: 3, generation: 1, previous: null, prunedPeers: [], current: {
    seq: 1, revision: bundle.revision, bundle: bundle.reference, priorVersionHash: null,
    accepted: [{ deviceId: bundle.revision.deviceId, seq: 1, revisionId: bundle.revision.revisionId }], retired: [], legacyHeads: []
  } } };
}

test("acceptance proof codec preserves absent v3/v2 fields and exact canonical whole-binary references", async () => {
  const original = await base(), old = await encodeSlot(original.envelope, original.body, null);
  assert.equal(Object.hasOwn((await decodeSlot(old.body)).envelope, "acceptanceProofs"), false);
  const slotProof = { kind: "slot", deviceId: id(1), seq: 3, revisionId: id(2), versionHash: "c".repeat(64) },
    encoded = await encodeSlot({ ...original.envelope, acceptanceProofs: [slotProof, proof] }, original.body, null),
    decoded = await decodeSlot(encoded.body);
  assert.deepEqual(decoded.envelope.acceptanceProofs, [proof, slotProof]);
  const v2 = { protocol: 2, current: original.envelope.current, previous: null };
  assert.deepEqual((await decodeSlot((await encodeSlot(v2, original.body, null)).body)).envelope, v2);
  await assert.rejects(parseSlotEnvelope({ ...v2, acceptanceProofs: [proof] }), error => error.code === "remote-invalid");
});

test("future/malformed/duplicate acceptance proofs fail closed and conflicting accepted hashes are never last-wins", async () => {
  const invalid = [
    [{ ...proof, kind: "future" }],
    [{ ...proof, unexpected: true }],
    [{ ...proof, revisionId: "invalid" }],
    [{ ...proof, bundle: { ...proof.bundle, sha256: "invalid" } }],
    [{ ...proof, bundle: { ...proof.bundle, extra: true } }],
    [{ kind: "slot", deviceId: id(1), seq: 0, revisionId: id(2), versionHash: "b".repeat(64) }],
    [proof, proof],
    Array(10001).fill(proof)
  ];
  for (const value of invalid) assert.throws(() => parseSlotAcceptanceProofs(value), error => error.code === "remote-invalid");
  assert.deepEqual(mergeSlotAcceptanceProofs([proof, proof]), [proof]);
  assert.throws(() => mergeSlotAcceptanceProofs([proof, { ...proof, bundle: { ...proof.bundle, sha256: "b".repeat(64) } }]), error => error.code === "conflict");
  const first = await base(), second = await base();
  first.envelope.acceptanceProofs = [proof];
  second.envelope.acceptanceProofs = [{ ...proof, bundle: { ...proof.bundle, sha256: "b".repeat(64) } }];
  await assert.rejects(inspectSlots([first, second].map(item => ({
    file: { name: `slot_${item.envelope.current.revision.deviceId}_1.mtp` }, envelope: item.envelope
  }))), error => error.code === "conflict");
});

test("the existing 256KiB header ceiling blocks oversized proof sets without truncating them", async () => {
  const original = await base(), proofs = Array.from({ length: 2000 }, (_, index) => ({ ...proof, revisionId: id(index + 100) }));
  assert.equal(parseSlotAcceptanceProofs(proofs).length, 2000);
  await assert.rejects(encodeSlot({ ...original.envelope, acceptanceProofs: proofs }, original.body, null), error => error.code === "limit");
});

test("a frozen strict v3 reader rejects a proof-bearing binary instead of silently ignoring new acceptance metadata", async () => {
  const original = await base(), encoded = await encodeSlot({ ...original.envelope, acceptanceProofs: [proof] }, original.body, null),
    oldLoad = sourceLoader(), oldModel = oldLoad("services/yandex/slot-model.ts"), parse = oldModel.parseSlotEnvelope;
  oldModel.parseSlotEnvelope = input => {
    oldModel.slotObject(input, ["protocol", "generation", "current", "previous", "prunedPeers"]);
    return parse(input);
  };
  const oldCodec = oldLoad("services/yandex/slot-codec.ts");
  await assert.rejects(oldCodec.decodeSlot(encoded.body), error => error.code === "remote-invalid");
});
