import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type {
  CloudErrorCode,
  CloudProgress,
  CloudSyncProvider,
  CloudSyncStatus
} from "../../model/cloud-sync.js";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import { useTerminal } from "./context.js";
import { shallowEqual } from "./snapshot-selector.js";
import type { TerminalState } from "./state.js";
import { cloudOperationTiming } from "./cloud-operation-clock.js";
import type { GoogleStatus } from "../../services/drive/device-slot-provider.js";
import { CloudVersionComparison } from "./CloudVersionComparison.js";
const phases: Record<CloudSyncStatus["phase"], string> = {
  disabled: "Синхронизация выключена",
  disconnected: "Облако не подключено",
  connecting: "Подключение…",
  idle: "Подключено",
  syncing: "Синхронизация…",
  conflict: "Выберите версию",
  "auth-required": "Требуется повторный вход",
  error: "Синхронизация остановлена"
};
const stages: Record<CloudProgress["stage"], string> = {
  inspect: "Проверяем версии",
  download: "Получаем данные",
  validate: "Проверяем снимок",
  upload: "Отправляем данные",
  verify: "Подтверждаем запись",
  apply: "Применяем на устройстве",
  save: "Сохраняем результат"
};
const errors: Record<CloudErrorCode, string> = {
  "configuration-required": "Нужна настройка OAuth приложения",
  "auth-required": "Требуется повторный вход",
  "auth-cancelled": "Вход отменён",
  "not-ready": "Подключение ещё не готово",
  busy: "Синхронизация уже выполняется",
  network: "Нет связи с облаком. Повторите проверку.",
  "local-save": "Не удалось сохранить результат на устройстве. Повторите операцию.",
  quota: "Облако ограничило запросы или доступное место",
  permission: "Облако не предоставило нужные права",
  "remote-invalid": "Данные облака повреждены. Данные устройства сохранены.",
  "unsupported-format":
    "Обновите приложение: формат облака пока не поддерживается. Данные сохранены.",
  conflict: "Версии изменились. Повторите проверку перед выбором.",
  limit: "Превышен допустимый размер снимка",
  "local-changed": "Локальные данные изменились. Повторите проверку.",
  indeterminate: "Не удалось подтвердить результат. Повторная проверка использует ту же операцию."
};
export function cloudProviderName(provider: CloudSyncProvider["id"]): string {
  return provider === "google-drive" ? "Google Диск" : "Яндекс Диск";
}
const selectCloudControls = (state: TerminalState) => ({
  profileTransition: state.profileTransition,
  backupBusy: state.backupBusy,
  importRecoveryRequired: state.importRecoveryRequired,
  workspaceMigrationIncomplete: state.workspaceMigrationIncomplete,
  loading: state.loading,
  ready: state.ready,
  preview: !!state.preview,
  activeTool: !!state.activeTool,
  locale: state.preferences.locale
});
export function CloudProviderSettings({
  provider,
  children
}: {
  provider: CloudSyncProvider;
  children?: ReactNode;
}) {
  const { state } = useTerminal(selectCloudControls, shallowEqual);
  const status = useSyncExternalStore(
    provider.subscribe,
    provider.getSnapshot,
    provider.getSnapshot
  );
  const googleChecking =
    status.enabled &&
    provider.id === "google-drive" &&
    (status as GoogleStatus).writeCapability?.phase === "checking";
  const timing = cloudOperationTiming(provider);
  const [actionError, setActionError] = useState(false),
    [clientModeError, setClientModeError] = useState(false),
    [comparisonError, setComparisonError] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [pendingActions, setPendingActions] = useState(0);
  const busy =
    googleChecking ||
    status.phase === "connecting" ||
    status.phase === "syncing" ||
    pendingActions > 0;
  const blocked = !!(
    state.profileTransition ||
    state.backupBusy ||
    state.importRecoveryRequired ||
    state.workspaceMigrationIncomplete ||
    state.loading ||
    !state.ready
  );
  const run = (operation: Promise<void>) => {
    setActionError(false);
    setPendingActions((value) => value + 1);
    void operation
      .catch(() => setActionError(true))
      .finally(() => setPendingActions((value) => Math.max(0, value - 1)));
  };
  useEffect(() => {
    if (status.enabled && status.configured)
      void provider.prepare().catch(() => setActionError(true));
  }, [provider, status.enabled, status.configured]);
  useEffect(() => {
    if (!status.enabled || !status.configured || !status.connected || !provider.inspect) return;
    let current = true;
    void provider.inspect().catch(() => {
      if (current) setComparisonError(true);
    });
    return () => {
      current = false;
    };
  }, [provider, status.enabled, status.configured, status.connected]);
  useEffect(() => {
    if (!busy) return;
    const started = cloudOperationTiming(provider).startedAt ?? Date.now();
    setElapsed(Math.floor((Date.now() - started) / 1000));
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy, provider, timing.startedAt]);
  const id = provider.id;
  const progress = status.progress;
  const activeChoice =
    status.choiceAction?.state === "running" ? status.choiceAction.selection : undefined;
  const visiblePhase = status.enabled ? status.phase : "disabled";
  const comparison = status.comparison ?? status.conflict;
  const retention = status.retention;
  const migration = provider.id === "google-drive" && !!(status as GoogleStatus).migrationRequired;
  const compare = () => {
    if (!provider.inspect) return;
    setComparisonError(false);
    setPendingActions((value) => value + 1);
    void provider
      .inspect()
      .catch(() => setComparisonError(true))
      .finally(() => setPendingActions((value) => Math.max(0, value - 1)));
  };
  return (
    <section
      className="cloud-provider-card"
      data-provider={id}
      data-phase={visiblePhase}
      data-recommended={provider.id === "yandex-disk" || undefined}
      aria-labelledby={`${id}-title`}
    >
      <header className="cloud-provider-heading">
        <h3 id={`${id}-title`}>{t(cloudProviderName(id))}</h3>
        {provider.id === "yandex-disk" && (
          <span className="cloud-recommended">{t("Рекомендуем")}</span>
        )}
      </header>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={status.enabled}
          id={`${id}-enabled`}
          onChange={(event) => run(provider.setEnabled(event.target.checked))}
        />
        {t("Включить синхронизацию")}
      </label>
      <p id={`${id}-status`} role="status">
        {t(googleChecking ? "Проверяем подключение…" : phases[visiblePhase])}
      </p>
      {!status.enabled && pendingActions > 0 && <p role="status">{t("Выполняем действие…")}</p>}
      {(status.credentialSaveError || actionError) && (
        <p role="alert">{t("Не удалось сохранить или удалить вход. Повторите действие.")}</p>
      )}
      {!status.enabled && status.credentialSaveError && (
        <button type="button" disabled={busy} onClick={() => run(provider.disconnect())}>
          {t("Повторить удаление входа")}
        </button>
      )}
      {status.enabled && (
        <>
          <dl className="cloud-connection-summary">
            <div>
              <dt>{t("Подключение")}</dt>
              <dd>{t(status.connected ? "Подключено" : "Облако не подключено")}</dd>
            </div>
            <div>
              <dt>{t("Режим обмена")}</dt>
              <dd>{t(status.automatic ? "Автоматически" : "Вручную")}</dd>
            </div>
            <div className="cloud-last-confirmed">
              <dt>{t("Последний подтверждённый обмен")}</dt>
              <dd>
                {status.lastSyncedAt ? (
                  <time dateTime={status.lastSyncedAt}>
                    {new Date(status.lastSyncedAt).toLocaleString(intlLocale())}
                  </time>
                ) : (
                  t("Пока не было")
                )}
              </dd>
            </div>
          </dl>
          {retention?.phase === "pending" && (
            <div className="cloud-retention-summary">
              <p role="status">{t("Данные сохранены. Очистка старых версий ожидает повтора.")}</p>
              {retention.keptFiles !== undefined && (
                <small>
                  {t("Сохранено файлов")} {retention.keptFiles.toLocaleString(intlLocale())}
                </small>
              )}
              {retention.deletedFiles !== undefined && (
                <small>
                  {t("Удалено файлов")} {retention.deletedFiles.toLocaleString(intlLocale())}
                </small>
              )}
            </div>
          )}
          {status.clientMode && provider.setClientMode && (
            <div className="cloud-client-identity">
              <label htmlFor={`${id}-client-mode`}>
                {t("Клиент синхронизации")}
                <select
                  id={`${id}-client-mode`}
                  value={status.clientMode}
                  disabled={busy || blocked || !status.prepared}
                  onChange={(event) => {
                    const mode = event.target.value === "test" ? "test" : "normal";
                    if (!provider.setClientMode) return;
                    setClientModeError(false);
                    setPendingActions((value) => value + 1);
                    void provider
                      .setClientMode(mode)
                      .catch(() => setClientModeError(true))
                      .finally(() => setPendingActions((value) => Math.max(0, value - 1)));
                  }}
                >
                  <option value="normal">{t("Этот браузер")}</option>
                  <option value="test">{t("Тестирование")}</option>
                </select>
              </label>
              <p>
                {t(
                  status.clientMode === "test"
                    ? "Тестовые сеансы в этом облаке используют один клиент."
                    : "Сохранения этого браузера отделены от других устройств."
                )}
              </p>
              <small>
                {t(
                  "Для инкогнито или временного сеанса выберите «Тестирование». Режим инкогнито не определяется автоматически."
                )}
              </small>
              {clientModeError && (
                <p role="alert">
                  {t(
                    "Не удалось изменить режим клиента. Завершите незавершённый обмен или повторите попытку."
                  )}
                </p>
              )}
            </div>
          )}
          {!status.configured && <p role="status">{t("Нужна настройка OAuth приложения")}</p>}
          {status.preparing && <p role="status">{t("Готовим вход…")}</p>}
          {busy && (
            <div className="cloud-operation-progress" aria-live="polite">
              <strong>
                {t(
                  googleChecking
                    ? "Проверяем подключение…"
                    : progress
                      ? stages[progress.stage]
                      : pendingActions > 0
                        ? "Выполняем действие…"
                        : phases[status.phase]
                )}
              </strong>
              <small>
                {t("Прошло")}: {elapsed} {t("с")}
              </small>
              {googleChecking ? (
                <progress aria-label={t("Проверяем подключение…")} />
              ) : (
                progress?.totalBytes !== undefined &&
                progress.totalBytes > 0 && (
                  <progress value={progress.completedBytes ?? 0} max={progress.totalBytes} />
                )
              )}
            </div>
          )}
          {!busy && timing.elapsedMs !== undefined && (
            <small>
              {t("Время последней попытки")}: {(timing.elapsedMs / 1000).toFixed(1)} {t("с")}
            </small>
          )}
          <p>
            {t(
              status.pendingChanges
                ? "Изменения ожидают синхронизации"
                : googleChecking
                  ? "Проверяем подключение…"
                  : "Сравните версии и выберите направление обмена."
            )}
          </p>
          <div className="drive-actions">
            {status.connected && (
              <button
                id={`${id}-compare`}
                type="button"
                disabled={busy || blocked || !status.configured || !provider.inspect}
                onClick={compare}
              >
                {t("Сравнить версии")}
              </button>
            )}
            {!status.connected && (
              <button
                id={`${id}-connect`}
                type="button"
                className="primary-button"
                disabled={busy || blocked || !status.configured || !status.prepared}
                onClick={() => run(provider.connectFromUserGesture())}
              >
                {t(status.phase === "auth-required" ? "Требуется повторный вход" : "Подключить")}
              </button>
            )}
            {status.connected && (
              <button
                id={`${id}-sync-now`}
                type="button"
                className="primary-button"
                disabled={busy || blocked}
                onClick={() => run(provider.sync())}
              >
                {t(
                  status.choiceAction?.state === "unconfirmed" && !status.conflict
                    ? "Повторить синхронизацию"
                    : "Синхронизировать сейчас"
                )}
              </button>
            )}
            <button
              id={`${id}-disconnect`}
              type="button"
              onClick={() => run(provider.disconnect())}
            >
              {t("Отключить и удалить вход")}
            </button>
            {!status.prepared && !status.preparing && status.configured && (
              <button type="button" onClick={() => run(provider.prepare())}>
                {t("Подготовить вход повторно")}
              </button>
            )}
          </div>
          {comparisonError && (
            <p role="alert">{t("Не удалось сравнить версии. Повторите проверку.")}</p>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={status.automatic}
              id={`${id}-automatic`}
              disabled={busy || status.error === "unsupported-format"}
              onChange={(event) => run(provider.setAutomatic(event.target.checked))}
            />
            {t("Автоматическая синхронизация")}
          </label>
          {status.error && !(status.error === "configuration-required" && !status.configured) && (
            <p id={`${id}-error`} role="alert">
              {t(errors[status.error])}
            </p>
          )}
          {status.choiceAction && !googleChecking && (
            <p
              id={`${id}-choice-result`}
              role={status.choiceAction.state === "unconfirmed" ? "alert" : "status"}
            >
              {t(
                status.choiceAction.state === "confirmed"
                  ? status.choiceAction.selection.kind === "local"
                    ? "Версия устройства отправлена в облако."
                    : status.conflict && status.conflict.remotes.length > 1
                      ? "Версия применена на устройстве; в облаке по-прежнему несколько версий."
                      : "Версия из облака применена на устройстве."
                  : status.choiceAction.state === "review"
                    ? "Версии изменились. Повторите проверку перед выбором."
                    : status.choiceAction.state === "blocked"
                      ? state.loading
                        ? "Дождитесь загрузки графика и повторите выбор."
                        : state.preview || state.activeTool
                          ? "Завершите или отмените разметку и повторите выбор."
                          : "Дождитесь завершения операции на устройстве"
                      : status.choiceAction.state === "running"
                        ? status.choiceAction.selection.kind === "local"
                          ? "Отправляем данные"
                          : "Получаем данные"
                        : status.choiceAction.selection.kind === "local"
                          ? "Отправка в облако не подтверждена."
                          : "Получение из облака не подтверждено."
              )}
            </p>
          )}
          {comparison && (
            <CloudVersionComparison
              id={id}
              comparison={comparison}
              busy={busy}
              blocked={blocked}
              activeChoice={activeChoice}
              migration={migration}
              receiveAvailable={migration || !!provider.receive}
              onSend={() => run(provider.choose({ kind: "local" }))}
              onReceive={(remoteId) => {
                if (migration) run(provider.choose({ kind: "remote", id: remoteId }));
                else if (provider.receive) run(provider.receive(remoteId));
              }}
            />
          )}
          <small className="drive-auth-note">
            {t(
              status.error === "unsupported-format"
                ? "Сохранённый вход не удаляется, исходный срок доступа остаётся прежним."
                : status.authorizationStored
                  ? "Вход сохранён на устройстве до исходного срока действия."
                  : status.connected
                    ? "Вход работает в текущем окне. После перезапуска может потребоваться повторное подключение."
                    : "Вход в облако сохраняется зашифрованным на этом устройстве."
            )}
          </small>
          {children}
        </>
      )}
    </section>
  );
}
