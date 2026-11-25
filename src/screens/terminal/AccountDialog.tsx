import { t, systemText } from "../../i18n/messages.js";
import { useEffect, useRef, useState } from "react";
import type { Timeframe } from "../../model/types.js";
import type { TerminalController } from "./controller.js";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
import { PERIOD_LABELS, number } from "./state.js";
import { ApplicationInfo } from "./ApplicationInfo.js";
import { intlLocale } from "../../i18n/preferences.js";
const bytes = (value: number) =>
  new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(value / 1024 / 1024) +
  t(" МБ");
type Stats = Awaited<ReturnType<TerminalController["getStorageStats"]>>;
function StorageSettings() {
  const { controller, state } = useTerminal(),
    [stats, setStats] = useState<Stats | null>(null),
    [uid, setUid] = useState(""),
    [timeframe, setTimeframe] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const refresh = () => {
    void controller
      .getStorageStats()
      .then(setStats)
      .catch((error: unknown) =>
        controller.notify(error instanceof Error ? error.message : t("Хранилище недоступно"))
      );
  };
  useEffect(() => {
    let active = true;
    void controller.getStorageStats().then((value) => {
      if (active) setStats(value);
    });
    return () => {
      active = false;
    };
  }, [controller]);
  const groups = stats?.candles.groups ?? [],
    ids = [...new Set(groups.map((group) => group.uid))];
  return (
    <section className="storage-settings">
      <h3>{t("Котировки на устройстве")}</h3>
      <strong id="history-storage-size">
        {stats
          ? bytes(stats.candles.bytes) + t(" · ") + number(stats.candles.bars, 0) + t(" свечей")
          : t("Считаем…")}
      </strong>
      <small id="browser-storage-size">
        {stats
          ? t("Данные всего приложения: ") +
            bytes(stats.browser.usage ?? 0) +
            (stats.browser.quota ? t(" из ") + bytes(stats.browser.quota) : "")
          : ""}
      </small>
      <p>
        {t(
          "Объём свечей — двоичные OHLCV. Общий объём браузера включает изображения и приложение."
        )}
      </p>
      <button type="button" id="refresh-storage" onClick={refresh}>
        {t("Обновить объём")}
      </button>
      <details>
        <summary>{t("По инструментам и таймфреймам")}</summary>
        <table>
          <thead>
            <tr>
              <th>{t("Инструмент")}</th>
              <th>{t("Интервал")}</th>
              <th>{t("Свечей")}</th>
              <th>{t("Объём")}</th>
            </tr>
          </thead>
          <tbody id="history-storage-details">
            {groups.map((group) => (
              <tr key={`${group.uid}:${group.timeframe}`}>
                <td>
                  {state.rows.find((row) => row.uid === group.uid)?.ticker ?? group.uid.slice(0, 8)}
                </td>
                <td>{t(PERIOD_LABELS[group.timeframe])}</td>
                <td>{number(group.bars, 0)}</td>
                <td>{bytes(group.bytes)}</td>
              </tr>
            ))}
            {!groups.length && (
              <tr>
                <td colSpan={4}>{t("Сохранённых свечей нет")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </details>
      <label>
        {t("Очистить котировки")}
        <select
          id="clear-history-instrument"
          value={uid}
          onChange={(e) => {
            setUid(e.target.value);
            setConfirm(false);
          }}
        >
          <option value="">{t("Все инструменты")}</option>
          {ids.map((id) => (
            <option key={id} value={id}>
              {state.rows.find((row) => row.uid === id)?.ticker ?? id}
            </option>
          ))}
        </select>
      </label>
      <select
        id="clear-history-timeframe"
        value={timeframe}
        onChange={(e) => {
          setTimeframe(e.target.value);
          setConfirm(false);
        }}
      >
        <option value="">{t("Все таймфреймы")}</option>
        {(Object.entries(PERIOD_LABELS) as [Timeframe, string][]).map(([tf, label]) => (
          <option key={tf} value={tf}>
            {t(label)}
          </option>
        ))}
      </select>
      <button
        type="button"
        id="clear-history"
        className="danger-button"
        disabled={busy || !state.authenticated}
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            return;
          }
          setBusy(true);
          void controller
            .clearHistory(uid || null, timeframe ? (timeframe as Timeframe) : null)
            .then(() => {
              setConfirm(false);
              refresh();
            })
            .catch((error: unknown) =>
              controller.notify(error instanceof Error ? error.message : t("Не удалось очистить"))
            )
            .finally(() => setBusy(false));
        }}
      >
        {confirm ? t("Подтвердить очистку выбранных котировок") : t("Очистить выбранные котировки")}
      </button>
      {confirm && (
        <button type="button" onClick={() => setConfirm(false)}>
          {t("Отмена")}
        </button>
      )}
      <p>
        {t(
          "Рисунки, изображения, настройки и ключ сохранятся. Новые свечи продолжат записываться."
        )}
      </p>
    </section>
  );
}
function TransferSettings() {
  const { controller, state } = useTerminal(),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(false),
    input = useRef<HTMLInputElement>(null);
  return (
    <section className="transfer-settings">
      <h3>{t("Перенос между устройствами")}</h3>
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
          disabled={busy || state.backupBusy || !state.authenticated}
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
          disabled={busy || state.backupBusy || !state.authenticated}
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
    </section>
  );
}
export function AccountDialog() {
  const { controller, state } = useTerminal(),
    [name, setName] = useState(state.name),
    [token, setToken] = useState(""),
    [remember, setRemember] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      id="account-dialog"
      title={state.authenticated ? t("Ваш личный аккаунт") : t("Подключите свой аккаунт")}
      onClose={() => controller.setDialog(null)}
    >
      <form
        id="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          const input = token;
          setToken("");
          setBusy(true);
          setError("");
          void controller
            .login(input, name, remember)
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
          {busy ? t("Проверяем ключ…") : t("Подключить котировки")}
        </button>
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
      </form>
      <StorageSettings />
      <TransferSettings />
      <ApplicationInfo />
      <span className="dialog-footer">{t("Личные данные остаются на вашем устройстве")}</span>
    </Modal>
  );
}
