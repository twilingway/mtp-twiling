import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/yandex-source.mjs";
const load = sourceLoader(),
  { encodeBundle } = load("services/yandex/bundle.ts"),
  { parseSlotEnvelope, inspectSlots, slotName } = load("services/yandex/slot-model.ts"),
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
    parseSlotEnvelope({ ...f.envelope, protocol: 3 }),
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
