import { t, systemText } from "../../i18n/messages.js";
import { useRef, useState } from "react";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
import { ApplicationInfo } from "./ApplicationInfo.js";
import { GoogleDriveSettings } from "./GoogleDriveSettings.js";
import { StoragePanel } from "./StoragePanel.js";
import { LegacyGuestRecovery } from "./LegacyGuestRecovery.js";
function TransferSettings({ active }: { active: boolean }) {
  const { controller, state } = useTerminal(),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(false),
    input = useRef<HTMLInputElement>(null);
  return (
    <section className="transfer-settings">
      <h3>{t("Перенос между устройствами")}</h3>
      <p>
        {t(
          "Формат 2: обновите приложение на другом устройстве. Старые данные и синхронизация формата 1 сохраняются отдельно."
        )}
      </p>
      {state.pendingPublicSource && (
        <div role="status">
          <p>
            {t(
              "В другом локальном профиле сохранены публичные инструменты. Существующую разметку этого профиля заменять не будем."
            )}
          </p>
          <button
            type="button"
            disabled={busy || state.profileTransition}
            onClick={() => {
              void controller
                .mergePublicProfile()
                .catch((error: unknown) =>
                  controller.notify(error instanceof Error ? error.message : "Перенос недоступен")
                );
            }}
          >
            {t("Добавить недостающие публичные данные")}
          </button>
        </div>
      )}
      <p>
        {t(
          "Индикаторы, вид графиков, список инструментов, линии и изображения. API-ключ не включается."
        )}
      </p>
      <label className="checkbox-label">
        <input
          id="export-history"
          type="checkbox"
          checked={history}
          onChange={(e) => setHistory(e.target.checked)}
        />
        {t("Также включить историю свечей")}
      </label>
      <div>
        <button
          type="button"
          id="export-settings"
          disabled={busy || state.backupBusy || !state.marketReady}
          onClick={() => {
            setBusy(true);
            void controller
              .exportBackup(history)
              .then((backup) => {
                const url = URL.createObjectURL(
                    new Blob([JSON.stringify(backup)], { type: "application/json" })
                  ),
                  link = document.createElement("a");
                link.href = url;
                link.download = `mtp-${new Date().toISOString().slice(0, 10)}.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              })
              .catch((error: unknown) =>
                controller.notify(error instanceof Error ? error.message : t("Экспорт недоступен"))
              )
              .finally(() => setBusy(false));
          }}
        >
          {t("Экспорт")}
        </button>
        <button
          type="button"
          id="import-settings"
          disabled={busy || state.backupBusy || !state.marketReady}
          onClick={() => input.current?.click()}
        >
          {t("Импорт")}
        </button>
      </div>
      <input
        type="file"
        ref={input}
        id="settings-file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 256 * 1024 * 1024) {
            controller.notify(t("Для импорта допустим файл до 256 МБ."));
            return;
          }
          setBusy(true);
          void controller
            .importBackupFile(file)
            .catch((error: unknown) =>
              controller.notify(error instanceof Error ? error.message : t("Импорт недоступен"))
            )
            .finally(() => setBusy(false));
        }}
      />
      <LegacyGuestRecovery active={active} includeHistory={history} />
    </section>
  );
}
export function AccountDialog() {
  const { controller, state } = useTerminal(),
    [name, setName] = useState(state.name),
    [token, setToken] = useState(""),
    [remember, setRemember] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editingKey, setEditingKey] = useState(false),
    [section, setSection] = useState<"account" | "drive" | "storage" | "transfer">("account");
  return (
    <Modal
      id="account-dialog"
      title={state.authenticated ? t("Ваш личный аккаунт") : t("Подключите свой аккаунт")}
      onClose={() => controller.setDialog(null)}
    >
      <nav className="account-sections" aria-label={t("Разделы настроек")}>
        {(
          [
            ["account", "Подключение"],
            ["drive", "Google Диск"],
            ["storage", "История"],
            ["transfer", "Импорт и экспорт"]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={section === id}
            aria-controls={`account-section-${id}`}
            onClick={() => setSection(id)}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      <div className="account-section" id="account-section-account" hidden={section !== "account"}>
        {state.authenticated && (
          <div
            className="bank-connection-status"
            data-connected={state.status === "connected"}
            role="status"
          >
            <strong>
              {t(state.status === "connected" ? "Т‑Банк подключён" : "Аккаунт Т‑Банка настроен")}
            </strong>
            <p>
              {state.status === "connected"
                ? t("Котировки поступают по WebSocket")
                : state.error
                  ? systemText(state.error)
                  : t("Восстанавливаем связь с сервисом котировок")}
            </p>
            <span>{state.name}</span>
          </div>
        )}
        {state.authenticated && !editingKey && (
          <button type="button" className="account-edit-key" onClick={() => setEditingKey(true)}>
            {t("Изменить API-ключ")}
          </button>
        )}
        <form
          id="account-form"
          hidden={state.authenticated && !editingKey}
          onSubmit={(e) => {
            e.preventDefault();
            const input = token;
            setToken("");
            setBusy(true);
            setError("");
            void controller
              .login(input, name, remember)
              .then(() => setEditingKey(false))
              .catch((error: unknown) =>
                setError(error instanceof Error ? error.message : t("Подключение недоступно"))
              )
              .finally(() => setBusy(false));
          }}
        >
          <p className="dialog-description">
            {t("Личные котировки через Т‑Инвестиции. Каждый пользователь подключает свой ключ.")}
          </p>
          <label htmlFor="profile-name">{t("Название аккаунта")}</label>
          <input
            id="profile-name"
            autoComplete="nickname"
            maxLength={40}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Например, Алексей")}
          />
          <label htmlFor="api-token">{t("API-токен · только для чтения")}</label>
          <input
            id="api-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="t.…"
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              id="remember-token"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {t("Запомнить ключ на этом устройстве")}
          </label>
          <p className="key-note">
            {t(
              "Ключ отправляется только в Т‑Банк и сохраняется в зашифрованном виде на устройстве. Приложение использует только справочник и рыночные данные."
            )}
          </p>
          <a
            className="settings-link"
            href="https://www.tbank.ru/invest/settings/"
            target="_blank"
            rel="noopener"
          >
            {t("Открыть настройки Т‑Инвестиций")}
          </a>
          {error && (
            <p id="login-error" role="alert">
              {systemText(error)}
            </p>
          )}
          <button className="primary-button" id="login-button" type="submit" disabled={busy}>
            {busy
              ? t("Проверяем ключ…")
              : t(state.authenticated ? "Сохранить новый ключ" : "Подключить котировки")}
          </button>
          {state.authenticated && editingKey && (
            <button
              type="button"
              className="account-edit-key"
              onClick={() => {
                setToken("");
                setEditingKey(false);
              }}
            >
              {t("Отмена")}
            </button>
          )}
        </form>
        {state.authenticated && (
          <button
            type="button"
            id="logout-button"
            className="logout-button"
            onClick={() => {
              void controller.logout();
            }}
          >
            {t("Выйти и удалить сохранённый ключ")}
          </button>
        )}
        <ApplicationInfo />
      </div>
      <div className="account-section" id="account-section-drive" hidden={section !== "drive"}>
        <GoogleDriveSettings />
      </div>
      <div className="account-section" id="account-section-storage" hidden={section !== "storage"}>
        {section === "storage" && <StoragePanel key={state.owner} />}
      </div>
      <div
        className="account-section"
        id="account-section-transfer"
        hidden={section !== "transfer"}
      >
        <TransferSettings active={section === "transfer"} />
      </div>
      <div className="account-help-links">
        <button type="button" id="open-welcome" onClick={() => controller.setDialog("welcome")}>
          {t("Помощь и первый запуск")}
        </button>
        <a
          href="https://github.com/twilingway/mtp-twiling"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a href="./privacy.html" target="_blank" rel="noopener">
          {t("Политика конфиденциальности")}
        </a>
      </div>
      <span className="dialog-footer">
        {t("Локальные данные — на устройстве; синхронизация — на личном Google Диске.")}
      </span>
    </Modal>
  );
}
