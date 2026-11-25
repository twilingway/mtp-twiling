import type { TerminalController } from "./controller.js";

/** Optional sync must never interrupt bank, history or account controller updates. */
export function optionalDriveObserver(
  controller: Pick<TerminalController, "getSnapshot" | "sessionKey" | "notify">,
  drive: { suspend: () => void }
): { run: (action: () => void) => void; stop: () => void } {
  let owner = controller.getSnapshot().owner,
    session = controller.sessionKey(),
    failed = false,
    running = false,
    stopped = false;
  const suspend = () => {
    try {
      drive.suspend();
    } catch {
      // Even a failing optional status subscriber cannot break the terminal.
    }
  };
  return {
    run(action) {
      if (stopped || running) return;
      const currentOwner = controller.getSnapshot().owner,
        currentSession = controller.sessionKey();
      if (owner !== currentOwner || session !== currentSession) {
        owner = currentOwner;
        session = currentSession;
        failed = false;
      }
      if (failed) return;
      running = true;
      try {
        action();
      } catch {
        failed = true;
        suspend();
        // Notify after the originating update finishes, scoped to the same bank session.
        queueMicrotask(() => {
          if (
            stopped ||
            controller.getSnapshot().owner !== currentOwner ||
            controller.sessionKey() !== currentSession
          )
            return;
          try {
            controller.notify("Синхронизация Google Диска приостановлена из-за ошибки настроек.");
          } catch {
            // Reporting an optional failure must also remain optional.
          }
        });
      } finally {
        running = false;
      }
    },
    stop() {
      stopped = true;
      suspend();
    }
  };
}
