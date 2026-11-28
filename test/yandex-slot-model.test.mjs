import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/yandex-source.mjs";
const load = sourceLoader(),
  { encodeBundle } = load("services/yandex/bundle.ts"),
  { parseSlotEnvelope, inspectSlots, slotName, slotVersionHash } = load(
    "services/yandex/slot-model.ts"
  ),
  { encodeSlot, decodeSlot } = load("services/yandex/slot-codec.ts"),
  { sha256 } = load("services/yandex/types.ts");
async function first(deviceId = crypto.randomUUID()) {
  const payload = new Blob([JSON.stringify({ drawings: [], images: [] })]),
    bundle = await encodeBundle(
      { payload, images: [] },
      {
        deviceId,
        revisionId: crypto.randomUUID(),
        parents: [],
        digest: await sha256(payload),
        createdAt: "2026-11-28T00:00:00Z"
      }
    ),
    current = {
      seq: 1,
      revision: bundle.revision,
      bundle: bundle.reference,
      priorVersionHash: null,
      accepted: [{ deviceId, seq: 1, revisionId: bundle.revision.revisionId }],
      retired: [],
      legacyHeads: []
    };
  return { bundle, current, envelope: { protocol: 2, current, previous: null } };
}
test("slot packages validate exact bytes and reject corruption, future formats and prototype fields", async () => {
  const f = await first(),
    encoded = await encodeSlot(f.envelope, f.bundle.body, null),
    decoded = await decodeSlot(encoded.body);
  assert.equal(decoded.envelope.current.revision.revisionId, f.bundle.revision.revisionId);
  const bytes = new Uint8Array(await encoded.body.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decodeSlot(new Blob([bytes])), (e) => e.code === "remote-invalid");
  await assert.rejects(
    parseSlotEnvelope({ ...f.envelope, protocol: 4 }),
    (e) => e.code === "unsupported-format"
  );
  const poisoned = JSON.parse(JSON.stringify(f.envelope));
  poisoned.current = JSON.parse('{"__proto__":{}}');
  await assert.rejects(parseSlotEnvelope(poisoned), (e) => e.code === "remote-invalid");
});
test("cyclic accepted vectors never erase every cloud head", async () => {
  const a = await first(),
    b = await first();
  a.current.accepted.push(...b.current.accepted);
  b.current.accepted = [...a.current.accepted];
  const files = [];
  for (const f of [a, b])
    files.push({
      file: { name: slotName(f.current.revision.deviceId, 1) },
      envelope: await parseSlotEnvelope(f.envelope)
    });
  await assert.rejects(inspectSlots(files), (e) => e.code === "remote-invalid");
});
test("an accepted claim cannot hide a missing client or a rollback", async () => {
  const a = await first(),
    b = await first();
  a.current.accepted.push(...b.current.accepted);
  const envelope = await parseSlotEnvelope(a.envelope);
  await assert.rejects(
    inspectSlots([{ file: { name: slotName(a.current.revision.deviceId, 1) }, envelope }]),
    (e) => e.code === "conflict"
  );
});

test("the embedded previous makes its exact physical carrier obsolete but never an unknown fork", async () => {
  const previous = await first(),
    next = await first(previous.current.revision.deviceId);
  previous.envelope = await parseSlotEnvelope(previous.envelope);
  previous.current = previous.envelope.current;
  next.current.seq = 2;
  next.current.priorVersionHash = await slotVersionHash(previous.current);
  next.current.accepted = [
    {
      deviceId: next.current.revision.deviceId,
      seq: 2,
      revisionId: next.current.revision.revisionId
    }
  ];
  next.envelope.previous = previous.current;
  const physical = async (f) => ({
    file: { name: slotName(f.current.revision.deviceId, f.current.seq) },
    envelope: await parseSlotEnvelope(f.envelope)
  });
  const latest = await physical(next),
    old = await physical(previous),
    known = await inspectSlots([old, latest]);
  assert.deepEqual(known.latest, [latest]);
  assert.deepEqual(known.obsolete, [old]);
  assert.deepEqual(known.uncertain, []);
  const fork = await physical(await first(previous.current.revision.deviceId)),
    unknown = await inspectSlots([fork, latest]);
  assert.deepEqual(unknown.obsolete, []);
  assert.deepEqual(unknown.uncertain, [fork]);
  assert.equal(unknown.heads.length, 2);
});


test("v3 physical generations can remove previous without changing logical version; divergent equal seq never wins",async()=>{
  const previous=await first(),next=await first(previous.current.revision.deviceId);
  previous.current=(await parseSlotEnvelope(previous.envelope)).current;
  next.current.seq=2;
  next.current.priorVersionHash=await slotVersionHash(previous.current);
  next.current.accepted=[{deviceId:next.current.revision.deviceId,seq:2,revisionId:next.current.revision.revisionId}];
  const original=await parseSlotEnvelope({protocol:2,current:next.current,previous:previous.current}),
    maintained=await parseSlotEnvelope({protocol:3,generation:3,current:original.current,previous:null,prunedPeers:[]}),
    old={file:{name:slotName(original.current.revision.deviceId,2)},envelope:original},
    latest={file:{name:slotName(original.current.revision.deviceId,3)},envelope:maintained},
    inspected=await inspectSlots([old,latest]);
  assert.deepEqual(inspected.latest,[latest]);
  assert.deepEqual(inspected.obsolete,[old]);
  assert.deepEqual(inspected.heads,[original.current.revision.revisionId]);
  await assert.rejects(parseSlotEnvelope({...maintained,protocol:2,generation:undefined}),e=>e.code==="remote-invalid");
  const divergent=structuredClone(maintained);
  divergent.generation=4;divergent.current.legacyHeads.push(crypto.randomUUID());
  await assert.rejects(inspectSlots([latest,{file:{name:slotName(original.current.revision.deviceId,4)},envelope:divergent}]),e=>e.code==="conflict");
  const staleWriter=structuredClone(original);
  staleWriter.current.seq=3;
  // A pre-v3 writer may arrive after maintenance with a lower physical generation.
  await assert.rejects(inspectSlots([{...old,envelope:staleWriter},latest]),e=>e.code==="conflict");
});

test("missing accepted peer requires exact durable proof with full accepted closure; proof cycles and lost monotonicity fail",async()=>{
  const a=await first(),b=await first();
  a.current.accepted.push(...b.current.accepted);
  const proof={...b.current.accepted[0],versionHash:await slotVersionHash(b.current),accepted:b.current.accepted},
    envelope=await parseSlotEnvelope({protocol:3,generation:2,current:a.current,previous:null,prunedPeers:[proof]}),
    physical={file:{name:slotName(a.current.revision.deviceId,2)},envelope};
  assert.deepEqual((await inspectSlots([physical])).heads,[a.current.revision.revisionId]);
  const missing=structuredClone(envelope);missing.prunedPeers=[];
  await assert.rejects(inspectSlots([{...physical,envelope:missing}]),e=>e.code==="conflict");
  const wrong=structuredClone(envelope);wrong.prunedPeers[0].revisionId=crypto.randomUUID();
  await assert.rejects(inspectSlots([{...physical,envelope:wrong}]),e=>e.code==="conflict");
  const cyclic=structuredClone(envelope);cyclic.prunedPeers[0].accepted.push(a.current.accepted[0]);
  await assert.rejects(inspectSlots([{...physical,envelope:await parseSlotEnvelope(cyclic)}]),e=>e.code==="remote-invalid");
  const newer=structuredClone(envelope);newer.generation=3;newer.prunedPeers=[];
  await assert.rejects(inspectSlots([physical,{file:{name:slotName(a.current.revision.deviceId,3)},envelope:newer}]),e=>e.code==="conflict");
});
