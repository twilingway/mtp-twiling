import { CLOUD_TEST_CLIENT_ID } from "../../model/cloud-client-identity.js";
import { decodeBundle, MAX_BUNDLE_BYTES } from "./bundle.js";
import type { YandexRemote } from "./revisions.js";
import type { YandexSlotStore } from "./slot-store.js";
import { slotFingerprint } from "./slot-store.js";
import { createSlotMaintenancePlan } from "./slot-maintenance-plan.js";
import { executeSlotMaintenance } from "./slot-maintenance-execute.js";
import { assertCurrent, sha256, YandexError } from "./types.js";
import type { YandexAuthorization } from "./types.js";
import { mergeSlotAcceptanceProofs, slotAcceptanceProofs } from "./slot-acceptance.js";
import { slotVersionHash } from "./slot-model.js";

/** Keep ordinary devices. Only the explicitly shared testing identity may be retired automatically. */
export async function retireAcceptedYandexTestClient(
  store: YandexSlotStore,
  auth: YandexAuthorization,
  writerDeviceId: string,
  valid: () => boolean,
  inspect: () => Promise<{ remotes: YandexRemote[]; heads: string[] }>,
  beforeEffect: () => Promise<unknown>
): Promise<number> {
  if (writerDeviceId === CLOUD_TEST_CLIENT_ID) return 0;
  const current = await inspect(),
    snapshot = store.snapshot;
  if (!snapshot || snapshot.uncertain.length) return 0;
  const peer = snapshot.latest.find(
    ({ envelope }) => envelope.current.revision.deviceId === CLOUD_TEST_CLIENT_ID
  );
  if (!peer || current.heads.includes(peer.envelope.current.revision.revisionId)) return 0;
  const originalHash = await slotVersionHash(peer.envelope.current);
  const accepting = snapshot.latest.find(
    ({ envelope }) =>
      envelope.current.revision.deviceId !== CLOUD_TEST_CLIENT_ID &&
      envelope.current.accepted.some(
        (claim) =>
          claim.deviceId === CLOUD_TEST_CLIENT_ID &&
          claim.seq === peer.envelope.current.seq &&
          claim.revisionId === peer.envelope.current.revision.revisionId
      ) &&
      slotAcceptanceProofs(envelope).some(
        (proof) =>
          proof.kind === "slot" &&
          proof.deviceId === CLOUD_TEST_CLIENT_ID &&
          proof.seq === peer.envelope.current.seq &&
          proof.revisionId === peer.envelope.current.revision.revisionId &&
          proof.versionHash === originalHash
      )
  );
  if (!accepting) throw new YandexError("conflict");
  const decoded = await store.body(accepting.file, valid);
  if (JSON.stringify(decoded.envelope) !== JSON.stringify(accepting.envelope))
    throw new YandexError("conflict");
  const plan = await createSlotMaintenancePlan(
    store,
    (await store.transport.list()).filter((file) => !file.name.startsWith("probe_")),
    peer.envelope.current.revision.revisionId,
    current.heads,
    auth,
    valid
  );
  // The existing executor writes and verifies durable prunedPeers proofs before deleting a carrier.
  await executeSlotMaintenance(store, plan, auth, valid, inspect, beforeEffect);
  return plan.candidates.length;
}

/** Legacy ancestors are removable only when a complete durable slot explicitly covers their head. */
export async function pruneAcceptedYandexLegacy(
  store: YandexSlotStore,
  auth: YandexAuthorization,
  valid: () => boolean,
  inspect: () => Promise<{ remotes: YandexRemote[]; heads: string[] }>,
  beforeEffect: () => Promise<unknown>
): Promise<number> {
  const transport = store.transport,
    before = (await transport.list()).filter((file) => !file.name.startsWith("probe_")),
    current = await inspect(),
    snapshot = store.snapshot;
  if (!snapshot || snapshot.uncertain.length || !snapshot.latest.length) return 0;
  const legacy = new Map<string, YandexRemote>();
  for (const remote of current.remotes.filter((item) => !item.slot)) {
    if (legacy.has(remote.revision.revisionId)) throw new YandexError("conflict");
    legacy.set(remote.revision.revisionId, remote);
  }
  if (legacy.size > 10000) throw new YandexError("limit");
  const proofs = mergeSlotAcceptanceProofs(
      snapshot.latest.flatMap(({ envelope }) => slotAcceptanceProofs(envelope))
    ),
    legacyProofs = new Map(
      proofs
        .filter((proof) => proof.kind === "legacy")
        .map((proof) => [proof.revisionId, proof.bundle])
    ),
    candidates: YandexRemote[] = [],
    visited = new Map<string, "active" | "complete">();
  // Iterative postorder supports the complete 10,000-file input bound without a JS call stack.
  const roots = new Set([
    ...snapshot.latest.flatMap(({ envelope }) => envelope.current.legacyHeads),
    ...legacyProofs.keys()
  ]);
  for (const head of roots) {
    const pending: { id: string; exit: boolean }[] = [{ id: head, exit: false }];
    while (pending.length) {
      const { id, exit } = pending.pop()!,
        remote = legacy.get(id);
      if (!remote || visited.get(id) === "complete") continue;
      if (exit) {
        visited.set(id, "complete");
        candidates.push(remote);
        continue;
      }
      if (visited.get(id) === "active") throw new YandexError("remote-invalid");
      visited.set(id, "active");
      pending.push({ id, exit: true });
      for (const parent of remote.revision.parents.toReversed())
        pending.push({ id: parent, exit: false });
    }
  }
  if (!candidates.length) return 0;
  let bytes = 0;
  for (const remote of candidates) {
    const original = legacyProofs.get(remote.revision.revisionId);
    if (!original || original.size !== remote.file.size) throw new YandexError("conflict");
    bytes += remote.file.size;
    if (bytes > MAX_BUNDLE_BYTES * 2) throw new YandexError("limit");
    const body = await transport.read(remote.file, MAX_BUNDLE_BYTES),
      decoded = await decodeBundle(body);
    if (
      JSON.stringify(decoded.revision) !== JSON.stringify(remote.revision) ||
      (await sha256(body)) !== original.sha256
    )
      throw new YandexError("conflict");
  }
  for (const { file, envelope } of snapshot.latest) {
    const decoded = await store.body(file, valid);
    if (JSON.stringify(decoded.envelope) !== JSON.stringify(envelope))
      throw new YandexError("conflict");
  }
  let expected = before;
  const check = async (): Promise<void> => {
    assertCurrent(auth.signal, valid);
    const files = (await transport.list()).filter((file) => !file.name.startsWith("probe_"));
    if (slotFingerprint(files) !== slotFingerprint(expected)) throw new YandexError("conflict");
  };
  let deleted = 0;
  for (const remote of candidates) {
    await beforeEffect();
    await check();
    await transport.removeLegacyExact(remote.file, valid);
    expected = expected.filter((file) => file.name !== remote.file.name);
    await check();
    deleted++;
  }
  return deleted;
}
