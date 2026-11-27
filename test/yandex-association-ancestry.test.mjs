import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/yandex-source.mjs";

const { yandexAssociationPrecedes } = sourceLoader()("services/yandex/association-ancestry.ts");
const remote = (id, deviceId, seq, accepted = [], parents = []) => ({
  revision: { revisionId: id, deviceId, parents },
  slot: { seq, accepted }
});
const base = remote("base", "browser", 1);
const claim = { deviceId: "browser", seq: 1, revisionId: "base" };

test("verified exact slot claims bridge a pruned parent chain without accepting unknown claims", () => {
  const head = remote("head", "peer", 4, [claim], ["pruned"]);
  assert.equal(yandexAssociationPrecedes(["head"], ["base"], [base, head]), true);
  assert.equal(yandexAssociationPrecedes(["head"], ["base"], [head]), false);
  for (const forged of [
    { ...claim, deviceId: "other" },
    { ...claim, seq: 2 },
    { ...claim, revisionId: "unknown" }
  ]) {
    assert.equal(
      yandexAssociationPrecedes(["head"], ["base"], [base, remote("head", "peer", 4, [forged])]),
      false
    );
  }
});

test("slot ancestry retains legacy parents, requires every baseline and refuses multiple heads", () => {
  const head = remote("head", "peer", 2, [claim]);
  assert.equal(yandexAssociationPrecedes(["head"], ["base", "missing"], [base, head]), false);
  assert.equal(yandexAssociationPrecedes(["head", "fork"], ["base"], [base, head]), false);
  assert.equal(yandexAssociationPrecedes(["head"], [], [head]), false);
  assert.equal(yandexAssociationPrecedes(["head"], ["base"], [remote("head", "peer", 2, [], ["base"])]), true);
  const cycle = [remote("head", "peer", 3, [], ["other"]), remote("other", "peer", 2, [], ["head"])];
  assert.equal(yandexAssociationPrecedes(["head"], ["base"], cycle), false);
});
