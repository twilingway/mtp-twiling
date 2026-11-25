import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n/messages.js";
import type { TerminalController } from "./controller.js";

export function useIndicatorMenuAction(controller: TerminalController) {
  const [pending, setPending] = useState(false);
  const running = useRef(false),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    const initial = controller.getSnapshot(),
      client = controller.sessionKey();
    if (running.current || initial.importingBackup || initial.importRecoveryRequired) return;
    running.current = true;
    setPending(true);
    let currentBoundary = true;
    const unsubscribe = controller.subscribe(() => {
      const current = controller.getSnapshot();
      if (
        current.owner !== initial.owner ||
        current.chartRevision !== initial.chartRevision ||
        controller.sessionKey() !== client ||
        current.importingBackup ||
        current.importRecoveryRequired
      )
        currentBoundary = false;
    });
    try {
      await action();
    } catch (error: unknown) {
      const current = controller.getSnapshot();
      if (
        currentBoundary &&
        current.owner === initial.owner &&
        current.chartRevision === initial.chartRevision &&
        controller.sessionKey() === client &&
        !current.importingBackup &&
        !current.importRecoveryRequired
      )
        controller.notify(
          error instanceof Error ? error.message : t("Не удалось сохранить настройки.")
        );
    } finally {
      unsubscribe();
      running.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return { pending, run };
}
