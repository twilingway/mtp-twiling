import { createLegacyGuestBackup } from "../../services/storage-guest-recovery.js";
import type { Backup } from "../../model/types.js";
import type { TerminalController } from "./controller.js";
type Controller = Pick<TerminalController, "getSnapshot" | "sessionKey" | "subscribe">;

/** The synchronous download callback is inside the guard, after all asynchronous Blob/DB reads. */
export async function downloadLegacyGuestWorkspace(
  controller: Controller,
  includeHistory: boolean,
  download: (backup: Backup) => void
): Promise<void> {
  const initial = controller.getSnapshot(),
    session = controller.sessionKey(),
    abort = new AbortController();
  let cancelled = !!initial.backupBusy;
  const valid = () => {
    const state = controller.getSnapshot();
    if (
      state.owner !== "public" ||
      state.authenticated ||
      state.profileTransition ||
      state.importingBackup ||
      state.importRecoveryRequired ||
      state.chartRevision !== initial.chartRevision ||
      controller.sessionKey() !== session
    )
      cancelled = true;
    return !cancelled;
  };
  const unsubscribe = controller.subscribe(() => {
    if (!valid()) abort.abort();
  });
  try {
    if (!valid()) throw new DOMException("Профиль изменился.", "AbortError");
    const backup = await createLegacyGuestBackup({ includeHistory, valid, signal: abort.signal });
    if (!valid()) throw new DOMException("Профиль изменился.", "AbortError");
    download(backup);
  } finally {
    unsubscribe();
  }
}
