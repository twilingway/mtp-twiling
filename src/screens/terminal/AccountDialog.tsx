import { t, systemText } from "../../i18n/messages.js";
import { useState } from "react";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
import { ApplicationInfo } from "./ApplicationInfo.js";
import { CloudSyncSettings } from "./CloudSyncSettings.js";
import { ServiceLinks } from "./ServiceLinks.js";
import { StoragePanel } from "./StoragePanel.js";
import { BackupTransferSettings } from "./BackupTransferSettings.js";
export function AccountDialog() {
  const { controller, state } = useTerminal(),
    [name, setName] = useState(state.name),
    [token, setToken] = useState(""),
    [remember, setRemember] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editingKey, setEditingKey] = useState(false),
    [section, setSection] = useState<"account" | "cloud" | "storage" | "transfer">(
      state.initialAccountSection === "drive" ? "cloud" : (state.initialAccountSection ?? "account")
    );
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
            ["cloud", "Облако"],
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
          <div className="login-help-links">
            <a
              className="settings-link"
              href="https://www.tbank.ru/invest/settings/"
              target="_blank"
              rel="noopener"
            >
              {t("Открыть настройки Т‑Инвестиций")}
            </a>
            <a
              className="settings-link"
              href="./android-certificate.html"
              target="_blank"
              rel="noopener"
            >
              {t("Сертификат Т‑Банка на Android")}
            </a>
          </div>
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
      <div className="account-section" id="account-section-cloud" hidden={section !== "cloud"}>
        {section === "cloud" && <CloudSyncSettings />}
      </div>
      <div className="account-section" id="account-section-storage" hidden={section !== "storage"}>
        {section === "storage" && <StoragePanel key={state.owner} />}
      </div>
      <div
        className="account-section"
        id="account-section-transfer"
        hidden={section !== "transfer"}
      >
        <BackupTransferSettings active={section === "transfer"} />
      </div>
      <ServiceLinks onHelp={() => controller.setDialog("welcome")} />
      <span className="dialog-footer">{t("Ключ банка — на устройстве. Облако — по желанию.")}</span>
    </Modal>
  );
}
