import { CLOUD_TEST_CLIENT_ID } from "../../model/cloud-client-identity.js";
import { decodeBundle, MAX_BUNDLE_BYTES } from "./bundle.js";
import type { YandexRemote } from "./revisions.js";
import type { SlotInspection } from "./slot-model.js";
import { slotVersionHash } from "./slot-model.js";
import type { YandexSlotStore } from "./slot-store.js";
import { mergeSlotAcceptanceProofs, slotAcceptanceProofs } from "./slot-acceptance.js";
import type { SlotAcceptanceProof } from "./slot-acceptance.js";
import { sha256, YandexError } from "./types.js";

/** Fresh bytes become accepted only in a freshly reviewed explicit choice, never an automatic edit. */
export async function captureYandexAcceptanceProofs(
  store: YandexSlotStore,
  snapshot: SlotInspection,
  remotes: readonly YandexRemote[],
  reviewed: boolean,
  valid: () => boolean
): Promise<readonly SlotAcceptanceProof[]> {
  const proofs = snapshot.latest.flatMap(({ envelope }) => slotAcceptanceProofs(envelope));
  if (reviewed) {
    let bytes = 0;
    for (const remote of remotes.filter((item) => !item.slot)) {
      bytes += remote.file.size;
      if (bytes > MAX_BUNDLE_BYTES * 2) throw new YandexError("limit");
      const body = await store.transport.read(remote.file, MAX_BUNDLE_BYTES),
        decoded = await decodeBundle(body);
      if (JSON.stringify(decoded.revision) !== JSON.stringify(remote.revision))
        throw new YandexError("conflict");
      proofs.push({
        kind: "legacy",
        revisionId: remote.revision.revisionId,
        bundle: { size: body.size, sha256: await sha256(body) }
      });
    }
    for (const { file, envelope } of snapshot.latest) {
      if (envelope.current.revision.deviceId !== CLOUD_TEST_CLIENT_ID) continue;
      const decoded = await store.body(file, valid);
      if (JSON.stringify(decoded.envelope) !== JSON.stringify(envelope))
        throw new YandexError("conflict");
      proofs.push({
        kind: "slot",
        deviceId: envelope.current.revision.deviceId,
        seq: envelope.current.seq,
        revisionId: envelope.current.revision.revisionId,
        versionHash: await slotVersionHash(envelope.current)
      });
    }
  }
  return mergeSlotAcceptanceProofs(proofs);
}
