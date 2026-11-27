import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const {
  DEVICE_SLOT_PROTOCOL,
  DEVICE_SLOT_TEST_DEVICE_ID,
  DeviceSlotError,
  MAX_DEVICE_SLOTS,
  MAX_DEVICE_SLOT_SEQUENCE,
  deviceSlotKey,
  inspectDeviceSlots,
  parseDeviceSlotEnvelope,
  parseDeviceSlotManifest,
  planDeviceSlotWrite
} = sourceLoader()("services/drive/device-slot-model.ts");

const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const [desktop, laptop, phone] = [uuid(10), uuid(20), uuid(30)];
const scope = { workspaceId: uuid(5), legacyArchive: "a".repeat(64) };
const payload = (n) => ({ sha256: n.toString(16).padStart(64, "0"), size: n });
const inspect = (files, checkpoint) => inspectDeviceSlots(files, scope, checkpoint);
const expected = (snapshot, deviceId) =>
  snapshot.checkpoint.observed.find((slot) => slot.deviceId === deviceId) ?? null;
const confirm = (snapshot, deviceId, revisionId, content) => ({
  deviceId,
  revisionId: uuid(revisionId),
  payload: content,
  expected: expected(snapshot, deviceId)
});
const publish = (snapshot, deviceId, revisionId, content, basedOn = snapshot.heads) =>
  planDeviceSlotWrite(snapshot, {
    ...confirm(snapshot, deviceId, revisionId, content),
    mode: "publish",
    basedOn
  });
const physical = (fileId, envelope) => ({
  fileId,
  envelope,
  envelopeHash: createHash("sha256").update(JSON.stringify(envelope)).digest("hex")
});
const put = (files, plan) => {
  if (plan.kind === "create") return [...files, physical(plan.key, plan.envelope)];
  return files.map((file) =>
    file.fileId === plan.expected.fileId ? physical(file.fileId, plan.envelope) : file
  );
};
const failure = (issue, operation) =>
  assert.throws(operation, (error) => error instanceof DeviceSlotError && error.issue === issue);

function initialDesktop() {
  return inspect(put([], publish(inspect([]), desktop, 101, payload(1))));
}

test("publishing replaces the device's stable file and increments its sequence", () => {
  const empty = inspect([]);
  const first = publish(empty, desktop, 101, payload(1));
  assert.equal(first.kind, "create");
  assert.equal(first.key, deviceSlotKey(scope.workspaceId, desktop));
  assert.equal(first.envelope.protocol, DEVICE_SLOT_PROTOCOL);
  assert.equal(first.envelope.current.legacyArchive, scope.legacyArchive);
  assert.equal(first.envelope.current.previousRevisionId, null);
  assert.equal(first.envelope.previous, null);
  const before = inspect(put([], first));
  const next = publish(before, desktop, 102, payload(2));
  assert.equal(next.kind, "replace");
  assert.equal(next.key, first.key);
  assert.deepEqual(next.expected, expected(before, desktop));
  assert.equal(next.envelope.current.seq, 2);
  assert.equal(next.envelope.current.previousRevisionId, uuid(101));
  assert.deepEqual(next.envelope.previous, before.files[0].envelope.current);

  const after = inspect(put(before.files, next), before.checkpoint);
  assert.equal(after.files.length, 1);
  assert.equal(after.files[0].fileId, before.files[0].fileId);
  assert.deepEqual(after.heads, [{ deviceId: desktop, seq: 2, revisionId: uuid(102) }]);
  failure("stale-device", () =>
    planDeviceSlotWrite(after, {
      ...confirm(before, desktop, 103, payload(3)),
      mode: "publish",
      basedOn: after.heads
    })
  );
  failure("stale-device", () =>
    planDeviceSlotWrite(after, {
      ...confirm(empty, desktop, 103, payload(3)),
      mode: "publish",
      basedOn: after.heads
    })
  );
  failure("fork", () => publish(after, desktop, 101, payload(3)));
});

test("three devices preserve parallel edits and explicitly resolve all current heads", () => {
  const first = initialDesktop();
  const laptopPlan = publish(first, laptop, 201, payload(2));
  const phonePlan = publish(first, phone, 301, payload(3));
  const before = inspect(put(put(first.files, laptopPlan), phonePlan), first.checkpoint);
  assert.deepEqual(
    before.heads.map((head) => head.deviceId),
    [laptop, phone]
  );
  failure("resolve", () => publish(before, desktop, 102, payload(2)));

  const choose = (confirmedHeads, chosen, content = payload(2)) =>
    planDeviceSlotWrite(before, {
      ...confirm(before, desktop, 102, content),
      mode: "resolve",
      confirmedHeads,
      chosen
    });
  failure("stale-heads", () => choose([before.heads[0]], before.heads[0]));
  failure("resolve", () => choose(before.heads, first.heads[0]));
  failure("resolve", () => choose(before.heads, before.heads[0], payload(3)));
  failure("resolve", () => choose(before.heads, before.heads[0], { ...payload(2), size: 9 }));
  const resolve = choose([...before.heads].reverse(), before.heads[0]);
  const after = inspect(put(before.files, resolve), before.checkpoint);
  assert.deepEqual(
    after.heads.map((head) => head.deviceId),
    [desktop]
  );
  assert.deepEqual(
    resolve.envelope.current.accepted.map((entry) => entry.deviceId),
    [desktop, laptop, phone]
  );
  assert.equal(resolve.envelope.current.legacyArchive, scope.legacyArchive);
  assert.equal(after.files.length, 3);
  const checkout = inspect(after.files, first.checkpoint);
  assert.deepEqual(checkout.heads, after.heads);
  const next = publish(checkout, phone, 302, payload(4));
  assert.deepEqual(inspect(put(checkout.files, next)).heads, [next.envelope.current.accepted[2]]);
});

test("an old checkout cannot mask missing or newer files and cannot replace the legacy marker", () => {
  const first = initialDesktop();
  const next = publish(first, desktop, 102, payload(2));
  const after = inspect(put(first.files, next), first.checkpoint);
  failure("stale-heads", () => publish(after, laptop, 201, payload(3), first.heads));
  failure("missing", () => inspect([], first.checkpoint));
  failure("stale-heads", () => publish(inspect([]), laptop, 201, payload(3), first.heads));
  failure("rollback", () => inspect(first.files, after.checkpoint));
  failure("scope", () => inspectDeviceSlots(after.files, { ...scope, workspaceId: uuid(2) }));
  failure("legacy", () => inspectDeviceSlots(after.files, { ...scope, legacyArchive: null }));
  failure("legacy", () =>
    inspectDeviceSlots([], { ...scope, legacyArchive: null }, first.checkpoint)
  );
  assert.notEqual(deviceSlotKey(uuid(2), desktop), deviceSlotKey(scope.workspaceId, desktop));

  const phonePlan = publish(after, phone, 301, payload(4));
  const withPhone = inspect(put(after.files, phonePlan));
  assert.equal(withPhone.heads[0].deviceId, phone);
  failure("missing", () => inspect(withPhone.files.slice(1)));
  failure("missing", () => inspect(withPhone.files.slice(1), withPhone.checkpoint));
});

test("duplicate device files, cloned revisions and predecessor forks fail closed", () => {
  const original = initialDesktop();
  const first = original.files[0];
  const second = publish(original, laptop, 201, payload(2));
  failure("duplicate", () => inspect([first, { ...first, fileId: "duplicate" }]));
  failure("duplicate", () => inspect([first, physical(first.fileId, second.envelope)]));
  failure("fork", () => inspect([{ ...first, fileId: "new_physical_id" }], original.checkpoint));

  const clone = publish(inspect([]), desktop, 109, payload(9));
  failure("fork", () => inspect([physical(first.fileId, clone.envelope)], original.checkpoint));
  const altered = physical(first.fileId, {
    ...first.envelope,
    current: { ...first.envelope.current, payload: payload(9) }
  });
  failure("fork", () => inspect([altered], original.checkpoint));
  const revision2 = publish(original, desktop, 102, payload(2));
  const changedPrior = physical(first.fileId, {
    ...revision2.envelope,
    current: { ...revision2.envelope.current, previousRevisionId: uuid(109) },
    previous: clone.envelope.current
  });
  failure("fork", () => inspect([changedPrior], original.checkpoint));
  failure("fork", () => inspect(put([changedPrior], second)));
  failure("fork", () => inspect(put([physical(first.fileId, clone.envelope)], second)));
});

test("causal vectors have to cover their current dependencies and cannot be cyclic", () => {
  const first = initialDesktop();
  const laptopPlan = publish(first, laptop, 201, payload(2));
  const two = inspect(put(first.files, laptopPlan));
  const phonePlan = publish(two, phone, 301, payload(3));
  const files = put(two.files, phonePlan);
  const phoneFile = files[2];
  const omitted = phonePlan.envelope.current.accepted.filter((entry) => entry.deviceId !== desktop);
  failure("causality", () =>
    inspect([
      ...two.files,
      physical(phoneFile.fileId, {
        ...phoneFile.envelope,
        current: { ...phoneFile.envelope.current, accepted: omitted }
      })
    ])
  );
  const cyclic = {
    ...first.files[0].envelope.current,
    accepted: phonePlan.envelope.current.accepted
  };
  const cyclicFile = physical(files[0].fileId, { ...files[0].envelope, current: cyclic });
  failure("causality", () => inspect([cyclicFile, ...files.slice(1)]));
});

test("an adjacent update must preserve the exact previously observed manifest", () => {
  const original = initialDesktop();
  const first = inspect(put(original.files, publish(original, laptop, 201, payload(2))));
  const next = publish(first, laptop, 202, payload(3));
  const files = put(first.files, next);
  const envelope = next.envelope;
  const oldManifest = envelope.previous;
  const [desktopFile, laptopFile] = files;
  const withPrevious = (previous) => [
    desktopFile,
    physical(laptopFile.fileId, { ...envelope, previous })
  ];

  const alteredPayload = withPrevious({ ...oldManifest, payload: payload(9) });
  assert.doesNotThrow(() => inspect(alteredPayload));
  failure("fork", () => inspect(alteredPayload, first.checkpoint));
  failure("fork", () =>
    inspect(
      withPrevious({
        ...oldManifest,
        accepted: oldManifest.accepted.filter((entry) => entry.deviceId === laptop)
      }),
      first.checkpoint
    )
  );
  assert.deepEqual(
    inspect(
      withPrevious({ ...oldManifest, accepted: [...oldManifest.accepted].reverse() }),
      first.checkpoint
    ).heads,
    inspect(files, first.checkpoint).heads
  );
});

test("a retained previous revision cannot acknowledge a current revision that already accepts it", () => {
  const first = initialDesktop();
  const second = inspect(put(first.files, publish(first, laptop, 201, payload(2))));
  const third = inspect(put(second.files, publish(second, desktop, 102, payload(3))));
  const files = put(third.files, publish(third, laptop, 202, payload(4)));
  assert.deepEqual(inspect(files).heads, [{ deviceId: laptop, seq: 2, revisionId: uuid(202) }]);

  const [desktopFile, laptopFile] = files;
  const { envelope } = laptopFile;
  const cyclicPrior = {
    ...envelope.previous,
    accepted: envelope.previous.accepted.map((entry) =>
      entry.deviceId === desktop ? third.heads[0] : entry
    )
  };
  const invalid = physical(laptopFile.fileId, { ...envelope, previous: cyclicPrior });
  failure("causality", () => inspect([desktopFile, invalid]));
});

test("metadata rejects unknown formats, invalid references and exhausted bounds", () => {
  const first = initialDesktop();
  const { envelope, fileId } = first.files[0];
  const manifest = envelope.current;
  failure("format", () => parseDeviceSlotEnvelope({ ...envelope, protocol: 4 }));
  failure("format", () => parseDeviceSlotEnvelope({ ...envelope, history: [] }));
  failure("format", () => parseDeviceSlotManifest({ ...manifest, protocol: 4 }));
  failure("format", () => parseDeviceSlotManifest({ ...manifest, token: "unrecognized" }));
  failure("invalid", () => parseDeviceSlotManifest({ ...manifest, accepted: Array(1) }));
  failure("invalid", () => parseDeviceSlotManifest({ ...manifest, payload: payload(0) }));
  failure("limit", () => inspect(Array(MAX_DEVICE_SLOTS + 1)));
  const atSeq = (seq, revisionId, previousRevisionId) => ({
    ...manifest,
    seq,
    revisionId,
    previousRevisionId,
    accepted: [{ deviceId: desktop, seq, revisionId }]
  });
  const atLimit = inspect([
    physical(fileId, {
      ...envelope,
      current: atSeq(MAX_DEVICE_SLOT_SEQUENCE, uuid(101), uuid(99)),
      previous: atSeq(MAX_DEVICE_SLOT_SEQUENCE - 1, uuid(99), uuid(98))
    })
  ]);
  failure("limit", () => publish(atLimit, desktop, 102, payload(2)));
});

test("rotating one physical file retains only the two latest revisions and refuses stale retries", () => {
  let snapshot = initialDesktop();
  for (let seq = 2; seq <= 6; seq++) {
    const before = snapshot;
    const request = {
      ...confirm(before, desktop, 100 + seq, payload(seq)),
      mode: "publish",
      basedOn: before.heads
    };
    const plan = planDeviceSlotWrite(before, request);
    assert.deepEqual(planDeviceSlotWrite(before, request), plan);
    snapshot = inspect(put(before.files, plan), before.checkpoint);
    const [{ fileId, envelope }] = snapshot.files;
    assert.equal(fileId, before.files[0].fileId);
    assert.equal(snapshot.files.length, 1);
    assert.deepEqual(
      snapshot.heads.map((head) => head.seq),
      [seq]
    );
    assert.equal(envelope.current.seq, seq);
    assert.equal(envelope.previous.seq, seq - 1);
    assert.deepEqual(envelope.previous.payload, payload(seq - 1));
    failure("stale-device", () => planDeviceSlotWrite(snapshot, request));
  }
});

test("restoring the previous payload appends a revision without rewinding sequence", () => {
  const one = initialDesktop();
  const two = inspect(put(one.files, publish(one, desktop, 102, payload(2))), one.checkpoint);
  const previous = two.files[0].envelope.previous;
  const restored = publish(two, desktop, 103, previous.payload);
  const observed = inspect(put(two.files, restored), two.checkpoint);
  assert.equal(observed.files[0].fileId, one.files[0].fileId);
  assert.equal(observed.files[0].envelope.current.seq, 3);
  assert.deepEqual(observed.files[0].envelope.current.payload, previous.payload);
  assert.deepEqual(observed.files[0].envelope.previous.payload, payload(2));
});

test("previous revision must be complete, scoped and the immediate predecessor", () => {
  const first = initialDesktop();
  const laptopPlan = publish(first, laptop, 201, payload(2));
  const two = inspect(put(first.files, laptopPlan));
  const phonePlan = publish(two, phone, 301, payload(3));
  const three = inspect(put(two.files, phonePlan));
  const { envelope } = publish(three, laptop, 202, payload(4));
  const { current, previous } = envelope;
  failure("causality", () => parseDeviceSlotEnvelope({ ...envelope, previous: null }));
  failure("scope", () =>
    parseDeviceSlotEnvelope({ ...envelope, previous: { ...previous, workspaceId: uuid(999) } })
  );
  failure("causality", () =>
    parseDeviceSlotEnvelope({ ...envelope, previous: phonePlan.envelope.current })
  );
  failure("causality", () =>
    parseDeviceSlotEnvelope({
      ...envelope,
      current: {
        ...current,
        accepted: current.accepted.filter((entry) => entry.deviceId !== desktop)
      }
    })
  );
});

test("the reserved testing profile key is stable and scoped to the workspace", () => {
  const testKey = (workspaceId) => deviceSlotKey(workspaceId, DEVICE_SLOT_TEST_DEVICE_ID);
  assert.notEqual(testKey(scope.workspaceId), testKey(uuid(99)));
  assert.notEqual(testKey(scope.workspaceId), deviceSlotKey(scope.workspaceId, desktop));
  const empty = inspect([]);
  const testPlan = publish(empty, DEVICE_SLOT_TEST_DEVICE_ID, 501, payload(1));
  assert.equal(testPlan.key, testKey(scope.workspaceId));
  const committed = inspect(put([], testPlan));
  const testNext = publish(committed, DEVICE_SLOT_TEST_DEVICE_ID, 502, payload(2));
  assert.equal(testNext.kind, "replace");
  assert.equal(testNext.key, testPlan.key);
});
