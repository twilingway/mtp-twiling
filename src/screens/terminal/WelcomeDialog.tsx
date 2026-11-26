import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WelcomeModel } from "../../model/welcome.js";
import { loadWelcomeHidden, saveWelcomeHidden } from "../../services/welcome-preferences.js";
import { t } from "../../i18n/messages.js";
import { Modal } from "./Modal.js";
import { useTerminal } from "./context.js";

function WelcomeDialog({ model }: { model: WelcomeModel }) {
  const { controller, state } = useTerminal(),
    status = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot),
    [choice, setHide] = useState<boolean | null>(null),
    hide = choice ?? status.hidden;
  const finish = (connect = false) => {
    void model.finish(hide).then((saved) => {
      if (saved) controller.setDialog(connect ? "account" : null);
    });
  };
  return (
    <Modal id="welcome-dialog" title={t("Добро пожаловать в MTP TWILING")} onClose={() => finish()}>
      <p className="welcome-lead">
        {t(
          state.authenticated
            ? "Личный терминал для графиков, индикаторов и разметки."
            : "Личный терминал для графиков, индикаторов и разметки. Криптовалюты Bybit и OKX доступны без ключа. Для российских инструментов подключите свой ключ Т‑Банка."
        )}
      </p>
      <ol className="welcome-steps">
        <li>
          {state.authenticated ? (
            <>
              <h3>{t("Т‑Банк подключён")}</h3>
              <p>{t("Инструменты Т‑Банка, Bybit и OKX можно найти через поиск.")}</p>
            </>
          ) : (
            <>
              <h3>{t("Выберите источник котировок")}</h3>
              <p>
                {t(
                  "Для криптовалют продолжите без подключения банка и найдите монету через поиск инструментов."
                )}
              </p>
              <p>
                {t(
                  "Выпустите личный API-токен Т‑Инвестиций с правами только для чтения и вставьте его в настройках аккаунта. Приложение не совершает сделки."
                )}
              </p>
              <a
                href="https://www.tbank.ru/invest/settings/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Открыть настройки Т‑Инвестиций")}
              </a>
              {" · "}
              <a
                href="https://developer.tbank.ru/invest/intro/intro/token"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Официальная инструкция по токену")}
              </a>
            </>
          )}
        </li>
        <li>
          <h3>{t("Переносите рабочее пространство")}</h3>
          <p>
            {t(
              "В разделе Google Диск подключите свой Google-аккаунт для синхронизации настроек, инструментов, индикаторов, рисунков и изображений между устройствами. История свечей остаётся локальной; её можно отдельно экспортировать в JSON."
            )}
          </p>
        </li>
        <li>
          <h3>{t("Знайте, где находятся данные")}</h3>
          <p>
            {t(
              "Сервер приложения раздаёт оболочку и обновления. Ключ банка, котировки и локальные сохранения находятся в браузере устройства; запросы к Т‑Банку идут напрямую. Если включить Drive, выбранные переносимые данные хранятся на вашем личном Google Диске."
            )}
          </p>
          <a href="./privacy.html" target="_blank" rel="noopener">
            {t("Политика конфиденциальности")}
          </a>
          {" · "}
          <a
            href="https://github.com/twilingway/mtp-twiling"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Открытый код на GitHub")}
          </a>
        </li>
      </ol>
      <p className="welcome-note">
        {t(
          "Терминал хранит данные в вашем браузере. Очистка данных сайта удалит локальные сохранения. Если синхронизация была включена, настройки и разметку можно восстановить с личного Google Диска."
        )}
      </p>
      <label className="checkbox-label">
        <input
          id="welcome-do-not-show"
          type="checkbox"
          checked={hide}
          disabled={status.saving || !status.ready}
          onChange={(event) => setHide(event.target.checked)}
        />
        {t("Больше не показывать на этом устройстве")}
      </label>
      {status.error && (
        <p role="alert" id="welcome-storage-error">
          {t(
            status.error === "load"
              ? "Не удалось прочитать настройку приветствия. Можно продолжить без её сохранения."
              : "Не удалось сохранить настройку приветствия. Повторите попытку или продолжите без сохранения."
          )}
        </p>
      )}
      <div className="settings-actions">
        {state.authenticated ? null : (
          <button
            id="welcome-connect"
            className="primary-button"
            type="button"
            disabled={status.saving || !status.ready}
            onClick={() => finish(true)}
          >
            {t("Подключить Т‑Банк")}
          </button>
        )}
        <button
          id="welcome-continue"
          className={state.authenticated ? "primary-button" : undefined}
          type="button"
          disabled={status.saving || !status.ready}
          onClick={() => finish()}
        >
          {status.saving ? t("Сохраняем…") : t("Продолжить")}
        </button>
        {status.error === "save" && (
          <button type="button" onClick={() => controller.setDialog(null)}>
            {t("Продолжить без сохранения")}
          </button>
        )}
      </div>
      <small>{t("Это окно всегда доступно: Аккаунт и настройки → Помощь и первый запуск.")}</small>
    </Modal>
  );
}

export function WelcomeGate({ startupSettled }: { startupSettled: boolean }) {
  const { controller, state } = useTerminal(),
    [model] = useState(
      () => new WelcomeModel({ load: loadWelcomeHidden, save: saveWelcomeHidden })
    ),
    status = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot),
    consumed = useRef(false);
  useEffect(() => {
    void model.load();
  }, [model]);
  useEffect(() => {
    if (state.authenticated || status.hidden || state.dialog === "welcome") {
      consumed.current = true;
      return;
    }
    if (
      startupSettled &&
      status.ready &&
      state.ready &&
      !state.profileTransition &&
      state.dialog === null &&
      !consumed.current
    ) {
      consumed.current = true;
      controller.setDialog("welcome");
    }
  }, [
    controller,
    startupSettled,
    state.authenticated,
    state.dialog,
    state.profileTransition,
    state.ready,
    status.hidden,
    status.ready
  ]);
  return state.dialog === "welcome" ? <WelcomeDialog model={model} /> : null;
}
