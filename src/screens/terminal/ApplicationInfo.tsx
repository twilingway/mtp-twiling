import { selectApplicationInfoState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";
import { t, systemText } from "../../i18n/messages.js";
import { APP_VERSION, BUILD_ID } from "../../generated/app-version.js";
import { useTerminal } from "./context.js";

export function ApplicationInfo() {
  const { state } = useTerminal(selectApplicationInfoState, shallowEqual);
  return (
    <details className="application-info">
      <summary>{t("О приложении и подключении")}</summary>
      <p>
        mtp.twiling.ru · v{APP_VERSION} · {BUILD_ID}
      </p>
      <p>
        {state.error
          ? systemText(state.error)
          : state.authenticated && state.status === "connected"
            ? t("Т-Банк: подключено")
            : state.authenticated
              ? t("Сохранённые котировки; подключаемся к Т-Банку…")
              : state.marketReady
                ? t("Публичные данные Bybit и OKX · без ключа банка")
                : t("Открываем локальный профиль")}
      </p>
      <p>{systemText(state.historyHelp)}</p>
      <p>{t("История, рисунки и изображения сохраняются в IndexedDB на устройстве.")}</p>
      <p>
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
          TradingView Lightweight Charts™
        </a>
        <br />
        {t("Copyright (с) 2025 TradingView, Inc.")}
        <br />
        <a href="./licenses/lightweight-charts-LICENSE.txt" target="_blank" rel="noopener">
          Apache License 2.0
        </a>
      </p>
      <p>
        <a href="https://klinecharts.com/" target="_blank" rel="noopener noreferrer">
          KLineChart
        </a>{" "}
        · Apache License 2.0
      </p>
    </details>
  );
}
