import { assertCurrent, YandexError } from "./types.js";
import type { YandexTransport } from "./transport.js";
import { inspectSlots } from "./slot-model.js";
import { slotFingerprint } from "./slot-store.js";
import type { YandexSlotStore } from "./slot-store.js";
import type { CloudRetentionStatus } from "../../model/cloud-sync.js";

/** Exact compatible ancestors can be pruned; every client's latest complete carrier survives. */
export async function retainYandexSlots(
  store: YandexSlotStore,
  transport: YandexTransport,
  signal: AbortSignal,
  valid: () => boolean,
  beforeDelete: () => Promise<unknown>
): Promise<CloudRetentionStatus> {
  let deletedFiles = 0;
  let gatePassed = false;
  for (let attempt = 0; attempt < 10000; attempt++) {
    assertCurrent(signal, valid);
    const before = await transport.list(),
      snapshot = await store.inspect(before, valid),
      keptFiles = snapshot.files.length;
    if (snapshot.uncertain.length)
      return { phase: "pending", keptFiles, deletedFiles, error: "conflict" };
    if (!snapshot.obsolete.length) return { phase: "complete", keptFiles, deletedFiles };
    const candidate = snapshot.obsolete.toSorted(
      (a, b) => a.envelope.current.seq - b.envelope.current.seq
    )[0];
    if (!candidate) return { phase: "pending", keptFiles, deletedFiles, error: "conflict" };
    const latest = snapshot.latest.find(
      ({ envelope }) =>
        envelope.current.revision.deviceId === candidate.envelope.current.revision.deviceId
    );
    if (!latest) throw new YandexError("conflict");
    // Headers prove ancestry, not recoverability. Validate both complete payloads before
    // removing any fallback, including a cold retry with no previously decoded bodies.
    const decoded = await store.body(latest.file, valid);
    if (JSON.stringify(decoded.envelope) !== JSON.stringify(latest.envelope))
      throw new YandexError("conflict");
    const after = await transport.list();
    assertCurrent(signal, valid);
    if (slotFingerprint(before) !== slotFingerprint(after)) throw new YandexError("conflict");
    // Re-evaluate the exact protected set before each irreversible request.
    const checked = await inspectSlots(snapshot.files);
    if (checked.uncertain.length || !checked.obsolete.includes(candidate))
      return { phase: "pending", keptFiles, deletedFiles, error: "conflict" };
    if (!gatePassed) {
      await beforeDelete();
      assertCurrent(signal, valid);
      gatePassed = true;
    }
    // A first-session proof performs synthetic I/O; its completion cannot validate older pins.
    const gated = await transport.list();
    assertCurrent(signal, valid);
    if (slotFingerprint(before) !== slotFingerprint(gated)) throw new YandexError("conflict");
    await transport.removeExact(candidate.file, valid);
    deletedFiles++;
  }
  throw new YandexError("limit");
}
