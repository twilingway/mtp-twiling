import { assertCurrent, YandexError } from "./types.js";
import type { YandexTransport } from "./transport.js";
import { inspectSlots } from "./slot-model.js";
import { slotFingerprint } from "./slot-store.js";
import type { YandexSlotStore } from "./slot-store.js";
import type { CloudRetentionStatus } from "../../model/cloud-sync.js";

/** Only exact compatible ancestors of this writer can be pruned; unknown late branches survive. */
export async function retainYandexSlots(
  store: YandexSlotStore,
  transport: YandexTransport,
  deviceId: string,
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
      own = snapshot.files.filter(
        ({ envelope }) => envelope.current.revision.deviceId === deviceId
      );
    if (own.length <= 2) return { phase: "complete", keptFiles: own.length, deletedFiles };
    if (snapshot.uncertain.length)
      return { phase: "pending", keptFiles: own.length, deletedFiles, error: "conflict" };
    const candidate = snapshot.obsolete
      .filter(({ envelope }) => envelope.current.revision.deviceId === deviceId)
      .sort((a, b) => a.envelope.current.seq - b.envelope.current.seq)[0];
    if (!candidate)
      return { phase: "pending", keptFiles: own.length, deletedFiles, error: "conflict" };
    const after = await transport.list();
    assertCurrent(signal, valid);
    if (slotFingerprint(before) !== slotFingerprint(after)) throw new YandexError("conflict");
    // Re-evaluate the exact protected set before each irreversible request.
    const checked = await inspectSlots(snapshot.files);
    if (checked.uncertain.length || !checked.obsolete.includes(candidate))
      return { phase: "pending", keptFiles: own.length, deletedFiles, error: "conflict" };
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
