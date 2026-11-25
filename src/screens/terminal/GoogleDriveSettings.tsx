import { useEffect, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import type { DriveStatus, DriveSummary } from "../../services/drive/coordinator-types.js";
import { terminalDrive } from "./controller-drive.js";
import { useTerminal } from "./context.js";

const phases: Record<DriveStatus["phase"], string> = {
  disconnected: "Google Диск не подключён",
  connecting: "Подключаем Google…",
  idle: "Google Диск подключён",
  syncing: "Синхронизация…",
  conflict: "Нужно выбрать версию",
  "auth-required": "Войдите в Google повторно",
  error: "Синхронизация остановлена"
};
const errors: Record<NonNullable<DriveStatus["error"]>, string> = {
  "auth-required": "Войдите в Google повторно",
  "auth-cancelled": "Подключение Google отменено",
  "not-ready": "Авторизация Google ещё загружается",
  busy: "Синхронизация уже выполняется",
  network: "Нет связи с Google. Повторите попытку.",
  quota: "Google временно ограничил запросы. Повторите позже.",
  permission: "Google не предоставил доступ к данным приложения",
  "remote-invalid": "Данные Google Диска повреждены. Локальные данные сохранены.",
  conflict: "На Google Диске появились другие изменения. Повторите проверку.",
  limit: "Превышен лимит данных синхронизации",
  "local-changed": "Локальные данные изменились. Проверяем заново."
};
function date(value?: string): string {
  return value
    ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "medium" }).format(
        new Date(value)
      )
    : t("Ещё не выполнялась");
}
function Summary({ summary }: { summary: DriveSummary }) {
  return (
    <p>
      {t("Инструментов")}: {summary.instruments} · {t("Рисунки")}: {summary.drawings} ·{" "}
      {t("Изображения")}: {summary.images}
      <br />
      <small>{date(summary.date)}</small>
    </p>
  );
}
export function GoogleDriveSettings() {
  const { controller, state } = useTerminal(),
    drive = terminalDrive(controller),
    status = useSyncExternalStore(drive.subscribe, drive.getSnapshot, drive.getSnapshot),
    busy =
      status.phase === "connecting" ||
      status.phase === "syncing" ||
      !!state.backupBusy ||
      !!state.importRecoveryRequired;
  useEffect(() => {
    void drive.prepare();
  }, [drive]);
  return (
    <section className="transfer-settings" id="google-drive-settings">
      <h3>{t("Личный Google Диск")}</h3>
      <a className="settings-link" href="./privacy.html" target="_blank" rel="noopener">
        {t("Политика конфиденциальности")}
      </a>
      <p>
        {t(
          "Настройки, инструменты, индикаторы, рисунки и изображения синхронизируются с вашим Google Диском. Ключ банка и история котировок остаются на устройстве."
        )}
      </p>
      <p id="google-drive-status" role="status">
        {t(phases[status.phase])}
      </p>
      <small>
        {t("Последняя синхронизация")}:{" "}
        <time id="google-drive-last-sync" dateTime={status.lastSyncedAt}>
          {date(status.lastSyncedAt)}
        </time>
      </small>
      {!state.authenticated && <p>{t("Сначала подключите личный ключ Т‑Банка")}</p>}
      {!status.connected ? (
        <button
          id="google-drive-connect"
          type="button"
          disabled={!state.authenticated || busy || !status.prepared}
          onClick={() => {
            void drive.connect();
          }}
        >
          {status.preparing
            ? t("Загружаем вход Google…")
            : status.phase === "auth-required"
              ? t("Войти в Google повторно")
              : t("Войти в Google")}
        </button>
      ) : (
        <div>
          <button
            id="google-drive-sync-now"
            type="button"
            disabled={busy}
            onClick={() => {
              void drive.sync();
            }}
          >
            {t("Синхронизировать сейчас")}
          </button>
          <button id="google-drive-disconnect" type="button" onClick={drive.disconnect}>
            {t("Отключить Google Диск")}
          </button>
        </div>
      )}
      {!status.prepared && !status.preparing && (
        <button
          type="button"
          onClick={() => {
            void drive.prepare();
          }}
        >
          {t("Повторить загрузку входа")}
        </button>
      )}
      {status.connected && (
        <label className="checkbox-label">
          <input
            id="google-drive-automatic"
            type="checkbox"
            checked={status.automatic}
            disabled={busy}
            onChange={(event) => {
              void drive
                .setAutomatic(event.target.checked)
                .catch(() => controller.notify(t("Не удалось сохранить настройку синхронизации")));
            }}
          />
          {t("Автоматическая синхронизация")}
        </label>
      )}
      {status.error && (
        <p role="alert" id="google-drive-error">
          {t(errors[status.error])}
        </p>
      )}
      {status.conflict && (
        <div id="google-drive-conflict">
          <h4>{t("Выберите сохраняемую версию")}</h4>
          <p>
            {t(
              "Выбранная версия заменит настройки, рисунки и изображения этого профиля. История котировок и ключ сохранятся. Прежние облачные снимки останутся на Google Диске."
            )}
          </p>
          <strong>{t("На этом устройстве")}</strong>
          <Summary summary={status.conflict.local} />
          <button
            id="google-drive-choose-local"
            type="button"
            disabled={busy}
            onClick={() => {
              void drive.choose("local");
            }}
          >
            {t("Сохранить версию устройства")}
          </button>
          {status.conflict.remotes.map((remote, index) => (
            <div key={remote.nodeId}>
              <strong>
                {t("Google Диск")} {status.conflict!.remotes.length > 1 ? index + 1 : ""}
              </strong>
              <Summary summary={remote} />
              <button
                type="button"
                data-drive-remote={index}
                disabled={busy}
                onClick={() => {
                  void drive.choose(remote.nodeId);
                }}
              >
                {t("Использовать эту версию Google Диска")}
              </button>
            </div>
          ))}
        </div>
      )}
      <small>
        {t(
          "Вход Google действует до истечения сессии или перезагрузки приложения. После этого войдите повторно; сохранённые данные останутся."
        )}
      </small>
    </section>
  );
}
