import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import type {
  DriveStatus,
  DriveSummary,
  DriveChoice
} from "../../services/drive/coordinator-types.js";
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
  "unsupported-format":
    "Формат синхронизации не поддерживается. Обновите приложение. Данные сохранены, автосинхронизация остановлена.",
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
    [legacyChoices, setLegacyChoices] = useState<DriveChoice[] | null>(null),
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
  useEffect(() => setLegacyChoices(null), [state.owner]);
  return (
    <section className="transfer-settings drive-settings" id="google-drive-settings">
      <h3>{t("Личный Google Диск")}</h3>
      <a className="settings-link" href="./privacy.html" target="_blank" rel="noopener">
        {t("Политика конфиденциальности")}
      </a>
      <p>
        {t(
          "Настройки, инструменты, индикаторы, рисунки и изображения синхронизируются с вашим Google Диском. Ключ банка и история котировок остаются на устройстве."
        )}
      </p>
      <div className="drive-status-card" data-drive-phase={status.phase}>
        <p id="google-drive-status" role="status">
          {t(phases[status.phase])}
        </p>
        <p className="drive-pending-status">
          {t(
            status.pendingChanges
              ? "Есть несинхронизированные изменения"
              : status.lastSyncedAt && status.connected && status.phase === "idle" && !status.error
                ? "Изменения синхронизированы"
                : status.lastSyncedAt
                  ? "Данные сохранены на устройстве. Ожидаем проверки Google Диска."
                  : "Синхронизация ещё не выполнялась"
          )}
        </p>
        <small>
          {t("Последняя синхронизация")}:{" "}
          <time id="google-drive-last-sync" dateTime={status.lastSyncedAt}>
            {date(status.lastSyncedAt)}
          </time>
        </small>
      </div>
      {!state.marketReady && <p>{t("Дождитесь открытия локального профиля")}</p>}
      {!status.connected ? (
        <button
          id="google-drive-connect"
          className="primary-button"
          type="button"
          disabled={!state.marketReady || busy || !status.prepared || state.profileTransition}
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
        <div className="drive-actions">
          <button
            id="google-drive-sync-now"
            className="primary-button"
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
      <label className="checkbox-label drive-automatic">
        <input
          id="google-drive-automatic"
          type="checkbox"
          checked={status.automatic}
          disabled={
            busy ||
            !state.marketReady ||
            state.profileTransition ||
            status.error === "unsupported-format"
          }
          onChange={(event) => {
            void drive
              .setAutomatic(event.target.checked)
              .catch(() => controller.notify(t("Не удалось сохранить настройку синхронизации")));
          }}
        />
        {t("Автоматическая синхронизация")}
      </label>
      {status.automatic && status.pauseReason && (
        <p className="drive-pause-status" role="status">
          {t(
            status.pauseReason === "auth-required"
              ? "Автосинхронизация на паузе: подключите Google."
              : status.pauseReason === "offline"
                ? "Автосинхронизация на паузе: нет интернета."
                : "Автосинхронизация на паузе: Google Диск недоступен. Повторим при восстановлении связи."
          )}
        </p>
      )}
      {status.error && (
        <p role="alert" id="google-drive-error">
          {t(
            !status.prepared && status.error === "network"
              ? "Не удалось загрузить вход Google. Нажмите «Повторить загрузку входа»."
              : errors[status.error]
          )}
        </p>
      )}
      {status.legacyAvailable && (
        <div className="drive-conflict" id="google-drive-legacy">
          <h4>{t("На Google Диске найден формат 1")}</h4>
          <p>
            {t(
              "Формат 2 синхронизируется отдельно. Обновите приложение на других устройствах. Старый поток не изменяется; перенос выбранного снимка заменит локальные настройки этого профиля только после вашего выбора."
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void drive.legacy
                .inspect()
                .then(setLegacyChoices)
                .catch((error: unknown) =>
                  controller.notify(
                    error instanceof Error ? error.message : "Legacy import unavailable"
                  )
                );
            }}
          >
            {t("Посмотреть старые снимки")}
          </button>
          {legacyChoices && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void drive.legacy
                    .choose("local")
                    .catch((error: unknown) =>
                      controller.notify(
                        error instanceof Error ? error.message : "Legacy import unavailable"
                      )
                    );
                }}
              >
                {t("Оставить данные устройства и начать формат 2")}
              </button>
              {legacyChoices.map((remote) => (
                <div key={remote.nodeId}>
                  <Summary summary={remote} />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void drive.legacy
                        .choose(remote.nodeId)
                        .catch((error: unknown) =>
                          controller.notify(
                            error instanceof Error ? error.message : "Legacy import unavailable"
                          )
                        );
                    }}
                  >
                    {t("Перенести этот снимок в формат 2")}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {status.conflict && (
        <div id="google-drive-conflict" className="drive-conflict">
          <h4>{t("Выберите сохраняемую версию")}</h4>
          <p>
            {status.conflict.remotes.length === 0
              ? t(
                  "В подключённом Google Диске нет ранее синхронизированной версии. Подтвердите отправку копии настроек, рисунков и изображений с этого устройства."
                )
              : t(
                  "Облачная версия заменит настройки, рисунки и изображения этого профиля. История котировок, ключ и прежние облачные снимки сохранятся."
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
            {t("Отправить версию устройства на Google Диск")}
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
      {status.credentialSaveError && (
        <p className="drive-storage-error" role="alert">
          {t(
            status.connected
              ? "Не удалось сохранить вход Google на устройстве. В текущем окне подключение работает; после перезапуска войдите снова."
              : "Не удалось удалить сохранённый вход Google на устройстве. Повторите удаление."
          )}
        </p>
      )}
      {!status.connected && status.credentialSaveError && (
        <button type="button" onClick={drive.disconnect}>
          {t("Повторить удаление входа Google")}
        </button>
      )}
      <small className="drive-auth-note">
        {t(
          status.error === "unsupported-format"
            ? "Синхронизация на паузе. Сохранённый вход Google не удаляется, срок доступа остаётся прежним."
            : status.authorizationStored
              ? "Вход сохранён на этом устройстве. Когда срок доступа Google истечёт, синхронизация приостановится до повторного подключения."
              : "Подключение Google будет сохранено на этом устройстве в зашифрованном виде до окончания срока токена."
        )}
      </small>
    </section>
  );
}
