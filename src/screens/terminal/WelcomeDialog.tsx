import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WelcomeModel } from "../../model/welcome.js";
import { loadWelcomeHidden, saveWelcomeHidden } from "../../services/welcome-preferences.js";
import { t } from "../../i18n/messages.js";
import { Modal } from "./Modal.js";
import { ServiceLinks } from "./ServiceLinks.js";
import { useTerminal } from "./context.js";

function WelcomeDialog({ model }: { model: WelcomeModel }) {
  const { controller, state } = useTerminal(),
    status = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot),
    [choice, setHide] = useState<boolean | null>(null),
    hide = choice ?? status.hidden;
  const details = useRef<HTMLDetailsElement>(null);
  const finish = (connect = false) => {
    void model.finish(hide).then((saved) => {
      if (saved) controller.setDialog(connect ? "account" : null);
    });
  };
  return (
    <Modal id="welcome-dialog" title="MTP Twiling" onClose={() => finish()}>
      <div className="welcome-intro">
        <p className="welcome-lead">{t("Графики, индикаторы и разметка.")}</p>
        <p>{t(state.authenticated ? "Т‑Банк подключён" : "Bybit и OKX — без ключа банка.")}</p>
      </div>
      <div className="settings-actions welcome-actions">
        <button
          id="welcome-continue"
          className="primary-button"
          type="button"
          disabled={status.saving || !status.ready}
          onClick={() => finish()}
        >
          {status.saving ? t("Сохраняем…") : t("Открыть графики")}
        </button>
        {!state.authenticated && (
          <button
            id="welcome-connect"
            type="button"
            disabled={status.saving || !status.ready}
            onClick={() => finish(true)}
          >
            {t("Подключить Т‑Банк")}
          </button>
        )}
      </div>
      <p className="welcome-privacy">{t("Ключ банка — на устройстве. Облако — по желанию.")}</p>
      <label className="checkbox-label welcome-hide">
        <input
          id="welcome-do-not-show"
          type="checkbox"
          checked={hide}
          aria-label={t("Больше не показывать на этом устройстве")}
          disabled={status.saving || !status.ready}
          onChange={(event) => setHide(event.target.checked)}
        />
        {t("Больше не показывать")}
      </label>
      {status.error && (
        <p role="alert" id="welcome-storage-error" className="welcome-error">
          {t(
            status.error === "load"
              ? "Не удалось прочитать настройку приветствия. Можно продолжить без её сохранения."
              : "Не удалось сохранить настройку приветствия. Повторите попытку или продолжите без сохранения."
          )}
        </p>
      )}
      {status.error === "save" && (
        <div className="settings-actions welcome-fallback">
          <button type="button" onClick={() => controller.setDialog(null)}>
            {t("Продолжить без сохранения")}
          </button>
        </div>
      )}
      <details ref={details} className="welcome-details">
        <summary>{t("Источники и данные")}</summary>
        <div className="welcome-details-content">
          <section>
            <h3>{t("Котировки и ключ банка")}</h3>
            <p>{t("Инструменты Т‑Банка, Bybit и OKX можно найти через поиск.")}</p>
            {!state.authenticated && (
              <>
                <p>
                  {t(
                    "Для российских инструментов нужен личный токен Т‑Инвестиций с правами только для чтения. Сделки в терминале не выполняются."
                  )}
                </p>
                <div className="welcome-token-links">
                  <a
                    href="https://www.tbank.ru/invest/settings/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Открыть настройки Т‑Инвестиций")}
                  </a>
                  <a
                    href="https://developer.tbank.ru/invest/intro/intro/token"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Официальная инструкция по токену")}
                  </a>
                </div>
              </>
            )}
          </section>
          <section>
            <h3>{t("Хранение и синхронизация")}</h3>
            <p>
              {t(
                "История, рисунки и изображения сохраняются в браузере. Очистка данных сайта удалит локальные сохранения."
              )}
            </p>
            <p>
              {t(
                "Для переноса настроек и разметки между устройствами можно подключить личное облако в настройках. История свечей остаётся локальной и экспортируется отдельно в JSON."
              )}
            </p>
          </section>
          <p className="welcome-help-note">{t("Помощь всегда доступна в меню MTP Twiling.")}</p>
        </div>
      </details>
      <ServiceLinks
        onHelp={() => {
          if (!details.current) return;
          details.current.open = true;
          details.current.querySelector("summary")?.focus();
        }}
      />
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
