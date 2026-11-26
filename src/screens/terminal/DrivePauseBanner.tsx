import { memo, useContext, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import type { DriveStatus } from "../../services/drive/coordinator-types.js";
import { TerminalContext } from "./context.js";
import { terminalDrive } from "./controller-drive.js";

function pauseMessage(status: DriveStatus, online: boolean): string | null {
  if (status.automaticBlockedByFormat)
    return "Обновите приложение, чтобы прочитать данные Google Диска.";
  if (
    !status.automatic ||
    !(status.connected || status.connectedThisSession || status.lastSyncedAt)
  )
    return null;
  if (status.phase === "conflict")
    return status.legacyAvailable
      ? "Откройте Google Диск и проверьте снимки старого формата."
      : "Откройте Google Диск и выберите версию рабочего пространства.";
  if (status.phase === "auth-required" || status.pauseReason === "auth-required")
    return "Войдите в Google повторно.";
  if (status.connected && !online)
    return "Нет интернета. Проверим Google Диск при восстановлении связи.";
  if (status.pauseReason === "offline")
    return "Связь восстановлена. Ожидаем проверки Google Диска.";
  if (status.pauseReason === "network")
    return "Нет связи с Google Диском. Можно повторить синхронизацию в настройках.";
  return null;
}

function subscribeOnline(notify: () => void): () => void {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

export const DrivePauseBanner = memo(function DrivePauseBanner() {
  const controller = useContext(TerminalContext);
  if (!controller) throw new Error("Terminal provider is missing");
  const drive = terminalDrive(controller);
  const status = useSyncExternalStore(drive.subscribe, drive.getSnapshot, drive.getSnapshot);
  const getLocale = () => controller.getSnapshot().preferences.locale ?? "ru";
  const locale = useSyncExternalStore(controller.subscribe, getLocale, getLocale);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true
  );
  const message = pauseMessage(status, online);

  return (
    <aside id="drive-pause-banner" className="drive-pause-banner" data-active={message !== null}>
      <div role="status" aria-atomic="true">
        {message ? (
          <>
            <strong>{t("Автосинхронизация с Google Диском приостановлена.", locale)}</strong>{" "}
            {t(message, locale)}{" "}
            {status.pendingChanges ? t("Изменения ещё не синхронизированы.", locale) : null}
          </>
        ) : null}
      </div>
      {message ? (
        <button type="button" onClick={() => controller.setDialog("account", "drive")}>
          {t("Открыть настройки Google Диска", locale)}
        </button>
      ) : null}
    </aside>
  );
});
