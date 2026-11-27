import type { CloudSyncProvider } from "../../model/cloud-sync.js";
interface Timing {
  readonly startedAt?: number;
  readonly elapsedMs?: number;
}
const clocks = new WeakMap<CloudSyncProvider, Timing>();
/** Registry timestamps include background operations before the settings panel is opened. */
export function recordCloudOperation(provider: CloudSyncProvider, now = Date.now()): void {
  const phase = provider.getSnapshot().phase;
  const previous = clocks.get(provider);
  if (phase === "connecting" || phase === "syncing") {
    if (previous?.startedAt === undefined) clocks.set(provider, { startedAt: now });
  } else if (previous?.startedAt !== undefined) {
    clocks.set(provider, { elapsedMs: Math.max(0, now - previous.startedAt) });
  }
}
export function cloudOperationTiming(provider: CloudSyncProvider): Timing {
  return clocks.get(provider) ?? {};
}
