import { memo, useContext, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import type { DriveStatus } from "../../services/drive/coordinator-types.js";
import { TerminalContext } from "./context.js";
import { terminalDrive } from "./controller-drive.js";

const notices = {
  format: ["Обновите приложение", "Обновите приложение, чтобы прочитать данные Google Диска."],
  legacy: ["Старые версии", "Откройте Google Диск и проверьте снимки старого формата."],
  conflict: ["Конфликт версий", "Откройте Google Диск и выберите версию рабочего пространства."],
  auth: ["Нужен вход", "Войдите в Google повторно."],
  offline: ["Нет интернета", "Нет интернета. Проверим Google Диск при восстановлении связи."],
  checking: ["Ожидаем проверки", "Связь восстановлена. Ожидаем проверки Google Диска."],
  network: ["Нет связи", "Нет связи с Google Диском. Можно повторить синхронизацию в настройках."]
} as const;

function pauseReason(status: DriveStatus, online: boolean): keyof typeof notices | null {
  if (status.automaticBlockedByFormat) return "format";
  if (
    !status.automatic ||
    !(status.connected || status.connectedThisSession || status.lastSyncedAt)
  )
    return null;
  if (status.phase === "conflict") return status.legacyAvailable ? "legacy" : "conflict";
  if (status.phase === "auth-required" || status.pauseReason === "auth-required") return "auth";
  if (status.connected && !online) return "offline";
  if (status.pauseReason === "offline") return "checking";
  if (status.pauseReason === "network") return "network";
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
  const reason = pauseReason(status, online);
  const details = reason
    ? [
        t(notices[reason][1], locale),
        status.pendingChanges ? t("Изменения ещё не синхронизированы.", locale) : ""
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <aside
      id="drive-pause-banner"
      className="drive-pause-banner"
      data-active={reason !== null}
      data-reason={reason ?? undefined}
      hidden={reason === null}
    >
      <div
        id="drive-pause-description"
        className="drive-pause-description"
        role="status"
        aria-atomic="true"
      >
        {details}
      </div>
      {reason ? (
        <button
          type="button"
          aria-describedby="drive-pause-description"
          title={details}
          onClick={() => controller.setDialog("account", "drive")}
        >
          <span className="drive-pause-service">{t("Google Диск", locale)}</span>
          <span className="drive-pause-reason">{t(notices[reason][0], locale)}</span>
          {status.pendingChanges && (
            <span className="drive-pause-pending">{t("Не отправлено", locale)}</span>
          )}
          <span className="drive-pause-description">
            {t("Открыть настройки Google Диска", locale)}
          </span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 4 4 4-4 4" />
          </svg>
        </button>
      ) : null}
    </aside>
  );
});
