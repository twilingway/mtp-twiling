import type { Backup } from "../../model/types.js";
import { verifiedDeviceSlotUploadBytes } from "./device-slot-binary-probe.js";
import { DeviceSlotHttp } from "./device-slot-http.js";
import type { googleSlotFence } from "./device-slot-link.js";
import { inspectLegacyDeviceSlotSources } from "./device-slot-migration.js";
import { DeviceSlotStore } from "./device-slot-store.js";
import type { SlotCapture, SlotSyncContext } from "./device-slot-sync.js";
import type { DriveAuthorization } from "./types.js";

export const providerId = "google-drive";
export const changed = () => new DOMException("Операция Google Диска устарела.", "AbortError");

export interface GoogleSlotScope {
  readonly owner: "device";
  readonly session: unknown;
  readonly cloudOwner: string;
  readonly ready: boolean;
  readonly blocked: boolean;
  readonly associationConflict: boolean;
  readonly revision: number;
}
interface Guard {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}
export interface GoogleSlotHost {
  scope(provider: typeof providerId): GoogleSlotScope;
  capture(provider: typeof providerId, guard: Guard): Promise<SlotCapture>;
  apply(
    provider: typeof providerId,
    backup: Backup,
    expectedRevision: number,
    guard: Guard,
    onCommitted: (revision: number) => void
  ): Promise<void>;
}

interface ContextOptions extends Pick<SlotSyncContext, "capture" | "save" | "report"> {
  host: GoogleSlotHost;
  guard: Guard;
  authorization: DriveAuthorization;
  fetcher: typeof fetch;
  fence: ReturnType<typeof googleSlotFence>;
}

/** One runtime job pins its authorization, portable revision, and guarded local writer. */
export function createDeviceSlotContext({
  host,
  guard,
  authorization,
  fetcher,
  fence,
  capture,
  save,
  report
}: ContextOptions): SlotSyncContext & { localChanged(): boolean } {
  let acceptedRevision = capture.revision;
  const checkIdentity = () => {
    if (!guard.isCurrent()) throw changed();
  };
  return {
    store: new DeviceSlotStore(new DeviceSlotHttp(authorization, fence.guardFetch(fetcher)), () =>
      verifiedDeviceSlotUploadBytes(authorization)
    ),
    signal: guard.signal,
    capture,
    checkIdentity,
    check() {
      checkIdentity();
      const latest = host.scope(providerId);
      if (latest.blocked || latest.revision !== capture.revision) throw changed();
    },
    noteApplyRevision(revision) {
      acceptedRevision = revision;
    },
    legacyAvailable: async () =>
      (await inspectLegacyDeviceSlotSources(authorization, fetcher)).some(
        ({ inspection }) => inspection.heads.length > 0
      ),
    apply: (backup, revision, onCommitted) =>
      fence.effect(() => host.apply(providerId, backup, revision, guard, onCommitted)),
    save: (prior, patch) => {
      checkIdentity();
      return fence.effect(() => save(prior, patch));
    },
    report,
    localChanged: () => host.scope(providerId).revision !== acceptedRevision
  };
}
