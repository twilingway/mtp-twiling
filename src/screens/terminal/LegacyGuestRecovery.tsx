import { useEffect, useState } from "react";
import { inspectLegacyGuestWorkspace } from "../../services/storage-guest-recovery.js";
import type { GuestRecoverySummary } from "../../services/storage-guest-recovery.js";
import { guestRecoveryText } from "../../i18n/messages-guest-recovery.js";
import { useTerminal } from "./context.js";
import { downloadLegacyGuestWorkspace } from "./legacy-guest-recovery.js";

export function LegacyGuestRecovery({
  includeHistory,
  active
}: {
  includeHistory: boolean;
  active: boolean;
}) {
  const { controller, state } = useTerminal(),
    session = controller.sessionKey();
  const [summary, setSummary] = useState<GuestRecoverySummary | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!active || state.owner !== "public" || state.authenticated) return;
    let cancelled = false;
    void inspectLegacyGuestWorkspace()
      .then((value) => {
        if (
          !cancelled &&
          controller.getSnapshot().owner === "public" &&
          controller.sessionKey() === session
        )
          setSummary(value);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, state.owner, state.authenticated, controller, session]);
  if (!active || state.owner !== "public" || state.authenticated || (!summary?.available && !error))
    return null;
  return (
    <section
      className="transfer-settings legacy-guest-recovery"
      aria-labelledby="legacy-guest-title"
    >
      <h3 id="legacy-guest-title">{guestRecoveryText("title")}</h3>
      <p>{guestRecoveryText(summary?.copied ? "copied" : "found")}</p>
      {summary?.unresolved && <p role="status">{guestRecoveryText("autoFailed")}</p>}
      <p>{guestRecoveryText("warning")}</p>
      <p>{guestRecoveryText("offline")}</p>
      {summary?.invalid && <p role="status">{guestRecoveryText("invalid")}</p>}
      {error && <p role="alert">{guestRecoveryText("failed")}</p>}
      <button
        type="button"
        id="export-legacy-guest"
        disabled={
          busy ||
          !!(
            state.backupBusy ||
            state.profileTransition ||
            state.importingBackup ||
            state.importRecoveryRequired
          )
        }
        onClick={() => {
          setBusy(true);
          setError(false);
          void downloadLegacyGuestWorkspace(controller, includeHistory, (backup) => {
            const url = URL.createObjectURL(
                new Blob([JSON.stringify(backup)], { type: "application/json" })
              ),
              link = document.createElement("a");
            link.href = url;
            link.download = `mtp-before-update-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          })
            .catch((error: unknown) => {
              if (!(
                (error instanceof DOMException || error instanceof Error) &&
                error.name === "AbortError"
              ))
                setError(true);
            })
            .finally(() => setBusy(false));
        }}
      >
        {guestRecoveryText(busy ? "busy" : "export")}
      </button>
    </section>
  );
}
