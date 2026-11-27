import assert from "node:assert/strict";
import test from "node:test";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

test("the actual local adapter deletes pending only on matching revision, account, generation and bundle reference", async () => {
  const f = await createGuestFixture(),
    { yandexLocalStore } = f.load("services/yandex/local.ts"), store = await yandexLocalStore(),
    expected = { accountId: "123", credentialGeneration: "generation-one", revisionId: "pending-five", sha256: "a".repeat(64), size: 128 },
    value = { accountId: expected.accountId, credentialGeneration: expected.credentialGeneration,
      revision: { revisionId: expected.revisionId }, reference: { sha256: expected.sha256, size: expected.size } };
  for (const changed of [
    { ...value, revision: { revisionId: "pending-six" } },
    { ...value, accountId: "456" },
    { ...value, credentialGeneration: "generation-two" },
    { ...value, reference: { ...value.reference, sha256: "b".repeat(64) } }
  ]) {
    f.database.stores.vault.set("pending", { id: "pending", value: changed });
    await store.remove("pending", undefined, undefined, expected);
    assert.deepEqual(f.database.stores.vault.get("pending").value, changed);
  }
  f.database.stores.vault.set("pending", { id: "pending", value });
  await store.remove("pending", undefined, undefined, expected);
  assert.equal(f.database.stores.vault.has("pending"), false);
});
