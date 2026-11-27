import { encodeSlot } from "./slot-codec.js";
import { slotClaim, slotName, slotVersionHash, stageName } from "./slot-model.js";
import type { SlotClaim, SlotInspection, SlotVersion } from "./slot-model.js";
import type { YandexPending } from "./journal.js";
import { assertCurrent, sha256, yandexErrorCode, YandexError } from "./types.js";
import type { YandexAuthorization } from "./types.js";
import type { YandexSlotStore } from "./slot-store.js";
import { retainYandexSlots } from "./slot-retention.js";
import { ensureYandexRetentionProof } from "./slot-proof.js";
import type { CloudRetentionStatus } from "../../model/cloud-sync.js";

export async function publishYandexSlot(
  store: YandexSlotStore,
  pending: YandexPending,
  snapshot: SlotInspection,
  auth: YandexAuthorization,
  legacyHeads: readonly string[],
  explicit: boolean,
  valid: () => boolean,
  beforeEffect: (() => Promise<void>) | undefined,
  reportRetention: (status: CloudRetentionStatus) => void
) {
  const transport = store.transport,
    deviceId = pending.revision.deviceId,
    existing = snapshot.files.find(
      ({ envelope }) => envelope.current.revision.revisionId === pending.revision.revisionId
    );
  if (existing) {
    const decoded = await store.body(existing.file, valid);
    if ((await sha256(decoded.current)) !== pending.reference.sha256)
      throw new YandexError("conflict");
    await retain();
    return pending.revision;
  }
  if (snapshot.uncertain.length && !explicit) throw new YandexError("conflict");
  const own = snapshot.latest.find(
      ({ envelope }) => envelope.current.revision.deviceId === deviceId
    ),
    previous = own?.envelope.current ?? null,
    previousBody = own ? (await store.body(own.file, valid)).current : null,
    accepted = new Map<string, SlotClaim>();
  for (const { envelope } of snapshot.latest)
    for (const claim of envelope.current.accepted) {
      const prior = accepted.get(claim.deviceId);
      if (!prior || prior.seq < claim.seq) accepted.set(claim.deviceId, claim);
      else if (prior.seq === claim.seq && prior.revisionId !== claim.revisionId)
        throw new YandexError("conflict");
    }
  for (const { envelope } of snapshot.latest)
    accepted.set(envelope.current.revision.deviceId, slotClaim(envelope.current));
  const seq = (previous?.seq ?? 0) + 1;
  accepted.set(deviceId, { deviceId, seq, revisionId: pending.revision.revisionId });
  const retired = [...(previous?.retired ?? [])];
  if (explicit)
    for (const { envelope } of snapshot.uncertain)
      retired.push({
        ...slotClaim(envelope.current),
        versionHash: await slotVersionHash(envelope.current)
      });
  const current: SlotVersion = {
      seq,
      revision: pending.revision,
      bundle: pending.reference,
      priorVersionHash: previous ? await slotVersionHash(previous) : null,
      accepted: [...accepted.values()],
      retired,
      legacyHeads: [
        ...new Set([
          ...legacyHeads,
          ...snapshot.latest.flatMap(({ envelope }) => envelope.current.legacyHeads)
        ])
      ]
    },
    encoded = await encodeSlot({ protocol: 2, current, previous }, pending.body, previousBody),
    stage = stageName(pending.revision.revisionId),
    destination = slotName(deviceId, seq);
  assertCurrent(auth.signal, valid);
  await transport.putImmutable(stage, encoded.body, encoded.reference, valid);
  let knownOutcome = false;
  let dispatched = false;
  let committed = false;
  try {
    await beforeEffect?.();
    assertCurrent(auth.signal, valid);
    dispatched = true;
    try {
      await transport.moveImmutable(stage, destination, encoded.reference, valid);
      knownOutcome = true;
      committed = true;
    } catch (error) {
      knownOutcome = yandexErrorCode(error) === "conflict";
      throw error;
    }
    await retain();
    return pending.revision;
  } finally {
    if ((knownOutcome || !dispatched) && !auth.signal.aborted && valid()) await cleanupStage();
  }
  async function cleanupStage(): Promise<void> {
    try {
      const staged = await transport.metadata(stage);
      if (staged) {
        await store.verified(staged, encoded.reference, valid);
        await transport.removeExact(staged, valid);
      }
    } catch (error) {
      assertCurrent(auth.signal, valid);
      if (!committed) throw error;
      reportRetention({ phase: "pending", error: yandexErrorCode(error) });
    }
  }
  async function retain(): Promise<void> {
    try {
      reportRetention(
        await retainYandexSlots(store, transport, deviceId, auth.signal, valid, () =>
          ensureYandexRetentionProof(transport, auth, valid)
        )
      );
    } catch (error) {
      assertCurrent(auth.signal, valid);
      reportRetention({ phase: "pending", error: yandexErrorCode(error) });
    }
  }
}
