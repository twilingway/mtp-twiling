import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authPauseFixture } from "./drive-reader-auth-pause-helpers.mjs";
import { tick, root, sourceLoader } from "./drive-reader-guard-helpers.mjs";

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = () => {
    fetchCalls++;
    throw new Error("No network in auth pause tests");
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(fetchCalls, 0);
});
const required = (error) => error.code === "auth-required";
function paused(f, stored = true) {
  const status = f.coordinator.getSnapshot();
  assert.equal(status.phase, "error");
  assert.equal(status.error, "unsupported-format");
  assert.equal(status.connected, false);
  assert.equal(status.automatic, false);
  assert.equal(status.authorizationStored, stored);
  assert.equal(f.localWrites.length, 0);
  assert.equal(f.store.events.filter((event) => event.op === "UPLOAD").length, 0);
  assert.deepEqual(f.revocations, []);
}

test("actual auth + AES vault: automatic unsupported pause retains ciphertext and aborts handles", async (t) => {
  const f = await authPauseFixture();
  t.after(() => f.stop());
  const before = structuredClone([...f.records]),
    association = structuredClone([...f.associations]);
  await f.start();
  paused(f);
  assert.deepEqual([...f.records], before);
  assert.deepEqual([...f.associations], association);
  assert.deepEqual(f.events, []);
  assert.equal(f.prompts.length, 0);
  const handle = f.handles[0].handle;
  assert.equal(handle.signal.aborted, true);
  assert.throws(() => handle.getAccessToken(), required);
  handle.invalidate();
  await tick();
  assert.deepEqual(f.events, []);
  const reads = f.store.events.length;
  f.coordinator.localChanged();
  await f.coordinator.setAutomatic(true);
  f.coordinator.resume();
  await f.coordinator.sync();
  await tick();
  paused(f);
  assert.equal(f.store.events.length, reads);
  assert.deepEqual([...f.records], before);
  assert.deepEqual([...f.associations], association);
});

test("actual auth + AES vault: failed local restore then explicit connect retains new saved generation", async (t) => {
  const f = await authPauseFixture({ associationVersion: 2, remoteUnknown: false });
  t.after(() => f.stop());
  const before = structuredClone([...f.records]),
    association = structuredClone([...f.associations]);
  await f.start();
  paused(f, false);
  assert.deepEqual([...f.records], before);
  assert.deepEqual(f.events, []);
  assert.equal(f.handles.length, 0);
  await f.coordinator.prepare();
  await f.coordinator.connect();
  await tick();
  paused(f);
  assert.equal(f.prompts.length, 1);
  assert.equal(f.handles[0].handle.signal.aborted, true);
  assert.deepEqual(
    f.events.map((event) => event.operation),
    ["remove", "write"],
    "only normal explicit sign-in replacement writes; pause never deletes"
  );
  assert.notEqual(f.records.get(f.id()).credentialId, before[0][1].credentialId);
  assert.deepEqual(f.records.get(f.id("owner-B")), new Map(before).get(f.id("owner-B")));
  assert.deepEqual([...f.associations], association);
  const credential = await f.loadCredential(),
    reopened = f.makeAuth();
  t.after(() => reopened.suspend());
  f.advanceTo(credential.issuedAt + 120000);
  const handle = await reopened.restore("owner-A");
  assert.equal(handle.getAccessToken(), "synthetic-manual-not-real");
  assert.equal((await f.loadCredential()).expiresAt, credential.expiresAt);
  assert.equal(f.prompts.length, 1);
});

test("actual auth + AES vault: manual remote format check preserves saved credential after prompt", async (t) => {
  const f = await authPauseFixture({ automatic: false });
  t.after(() => f.stop());
  await f.start();
  assert.equal(f.coordinator.getSnapshot().phase, "idle");
  const oldHandle = f.handles[0].handle;
  await f.coordinator.prepare();
  await f.coordinator.connect();
  await tick();
  paused(f);
  assert.equal(oldHandle.signal.aborted, true);
  assert.equal(f.handles.at(-1).handle.signal.aborted, true);
  assert.deepEqual(
    f.events.map((event) => event.operation),
    ["remove", "write"]
  );
  const before = structuredClone([...f.records]);
  oldHandle.invalidate();
  await tick();
  assert.deepEqual([...f.records], before);
});

for (const newerGeneration of [false, true])
  test(`compatible reopen restores without Google until actual expiry; newer generation=${newerGeneration}`, async (t) => {
    const f = await authPauseFixture();
    t.after(() => f.stop());
    const original = await f.loadCredential(),
      other = structuredClone(f.records.get(f.id("owner-B")));
    await f.start();
    paused(f);
    let sdkLoads = 0;
    const reopened = f.makeAuth(async () => {
      sdkLoads++;
      assert.fail("No Google SDK for valid saved restore");
    });
    t.after(() => reopened.suspend());
    f.advanceTo(original.issuedAt + 120000);
    const restored = await reopened.restore("owner-A");
    assert.equal(restored.getAccessToken(), original.token);
    assert.equal(restored.stored, true);
    assert.equal(sdkLoads, 0);
    assert.equal(f.prompts.length, 0);
    assert.equal((await f.loadCredential()).expiresAt, original.expiresAt);
    let replacement;
    if (newerGeneration) {
      replacement = {
        ...original,
        credentialId: crypto.randomUUID(),
        expiresAt: original.expiresAt + 600000
      };
      await f.vault.save(replacement, new AbortController().signal);
    }
    f.events.length = 0;
    f.advanceTo(original.expiresAt);
    assert.throws(() => restored.getAccessToken(), required);
    await tick();
    assert.equal(restored.signal.aborted, true);
    assert.deepEqual(f.events, [
      { operation: "remove", id: f.id(), generation: original.credentialId }
    ]);
    assert.deepEqual(f.records.get(f.id("owner-B")), other);
    if (newerGeneration)
      assert.equal((await f.loadCredential()).credentialId, replacement.credentialId);
    else assert.equal(await f.loadCredential(), undefined);
  });

test("old owner format failure cannot suspend the new owner's actual restored handle", async (t) => {
  const f = await authPauseFixture();
  t.after(() => f.stop());
  const before = structuredClone([...f.records]);
  let enter, release;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    gate = new Promise((resolve) => {
      release = resolve;
    });
  let waiting = false;
  f.store.readHook = async (file) => {
    if (!waiting && file.id === f.node.payloadFile.id) {
      waiting = true;
      enter();
      await gate;
    }
  };
  f.coordinator.profileChanged();
  await entered;
  f.changeOwner();
  await f.settle(
    () =>
      f.handles.some((entry) => entry.owner === "owner-B") &&
      f.coordinator.getSnapshot().phase === "idle"
  );
  release();
  await tick();
  await tick();
  const oldHandle = f.handles.find((entry) => entry.owner === "owner-A").handle;
  const current = f.handles.find((entry) => entry.owner === "owner-B").handle;
  assert.equal(oldHandle.signal.aborted, true);
  assert.equal(current.signal.aborted, false);
  assert.equal(current.getAccessToken(), "synthetic-owner-B-not-real");
  assert.equal(f.coordinator.getSnapshot().error, undefined);
  assert.equal(f.coordinator.getSnapshot().connected, true);
  assert.deepEqual([...f.records], before);
  assert.deepEqual(f.events, []);
  assert.equal(f.localWrites.length, 0);
});

test("unsupported pause has accurate saved-credential RU/EN copy", () => {
  const source = readFileSync(
    new URL("../src/screens/terminal/CloudProviderSettings.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /status.error === "unsupported-format"[\s\S]*?Сохранённый вход не удаляется/
  );
  const messages = sourceLoader(root)("i18n/messages-cloud.ts").cloudMessages;
  assert.ok(
    Object.values(messages).includes(
      "Saved sign-in is retained and its original expiry stays unchanged."
    )
  );
});
