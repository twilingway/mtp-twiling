import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WelcomeModel } from "../../model/welcome.js";
import { loadWelcomeHidden, saveWelcomeHidden } from "../../services/welcome-preferences.js";
import { t } from "../../i18n/messages.js";
import { Modal } from "./Modal.js";
import { useTerminal } from "./context.js";

function WelcomeDialog({ model }: { model: WelcomeModel }) {
  const { controller } = useTerminal(),
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
          "Личный терминал для графиков, индикаторов и разметки. Криптовалюты Bybit доступны без ключа. Для российских инструментов подключите свой ключ Т‑Банка."
        )}
      </p>
      <ol className="welcome-steps">
        <li>
          <h3>{t("Выберите источник котировок")}</h3>
          <p>
            {t(
              "Чтобы открыть Bybit, продолжите без подключения банка и найдите монету через поиск инструментов."
            )}
          </p>
          <p>
            {t(
              "Выпустите личный API-токен Т‑Инвестиций с правами только для чтения и вставьте его в настройках аккаунта. Приложение не совершает сделки."
            )}
          </p>
          <a href="https://www.tbank.ru/invest/settings/" target="_blank" rel="noopener noreferrer">
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
          "Установленное приложение хранит данные на вашем устройстве. Очистка данных сайта или приложения удалит сохранения только на этом устройстве. Настройки и разметку можно восстановить с личного Google Диска, если синхронизация была включена."
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
        <button
          id="welcome-connect"
          className="primary-button"
          type="button"
          disabled={status.saving || !status.ready}
          onClick={() => finish(true)}
        >
          {t("Подключить Т‑Банк")}
        </button>
        <button
          id="welcome-continue"
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

export function WelcomeGate() {
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
    if (!status.ready) return;
    if (status.hidden || state.dialog === "welcome") {
      consumed.current = true;
      return;
    }
    if (state.ready && state.dialog === null && !consumed.current) {
      consumed.current = true;
      controller.setDialog("welcome");
    }
  }, [controller, state.ready, state.dialog, status.ready, status.hidden]);
  return state.dialog === "welcome" ? <WelcomeDialog model={model} /> : null;
}
