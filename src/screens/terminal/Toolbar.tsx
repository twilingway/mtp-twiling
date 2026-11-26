import { selectedMarketRow } from "../../model/selected-instrument.js";
import { t } from "../../i18n/messages.js";
import { useTerminal } from "./context.js";
import { ChartEngineSelect } from "./ChartEngineSelect.js";
import { TerminalIndicatorControls } from "./TerminalIndicatorControls.js";
import { TimeframeMenu } from "./intervals/TimeframeMenu.js";
import { isNativeIntervalId } from "../../model/intervals/registry.js";
import { DERIVED_INTERVAL_UNAVAILABLE } from "../../model/intervals/native-timeframes.js";
import {
  DEFAULT_INTERVAL_FAVORITES,
  toggleIntervalFavorite
} from "../../model/intervals/favorites.js";
export function Toolbar() {
  const { controller, state } = useTerminal(),
    p = state.preferences,
    row = selectedMarketRow(state.rows, p),
    ticker = row?.ticker || t("Инструмент"),
    searchLabel = t("Найти инструмент"),
    shortIntervalUnavailable =
      row?.providerRef?.provider === "okx"
        ? "OKX: интервал пока не поддерживается"
        : "Bybit: интервал пока не поддерживается";
  return (
    <header className="topbar">
      <a className="brand" href="./" aria-label="MTP TWILING" title="MTP TWILING">
        <img className="brand-icon" src="./icon.svg" width={25} height={25} alt="" />
        <span>
          MTP <b>TWILING</b>
        </span>
      </a>
      <div className="divider" />
      <button
        type="button"
        className="symbol-button"
        id="symbol-button"
        aria-haspopup="dialog"
        aria-label={`${ticker} · ${searchLabel}`}
        onClick={() => controller.setDialog(state.ready ? "instruments" : "account")}
        title={searchLabel}
      >
        <span className="tiny-search" aria-hidden="true">
          ⌕
        </span>
        <b id="top-symbol">{ticker}</b>
      </button>
      <nav className="timeframes" aria-label={t("Таймфрейм")}>
        <TimeframeMenu
          value={p.timeframe}
          favorites={p.favoriteIntervals ?? DEFAULT_INTERVAL_FAVORITES}
          availability={{
            ...DERIVED_INTERVAL_UNAVAILABLE,
            ...(row?.providerRef
              ? {
                  "2m": shortIntervalUnavailable,
                  "10m": shortIntervalUnavailable
                }
              : {})
          }}
          onSelect={(id) => {
            if (isNativeIntervalId(id)) void controller.setTimeframe(id);
          }}
          onToggleFavorite={(id) => {
            void controller.setPreferences({
              favoriteIntervals: toggleIntervalFavorite(
                p.favoriteIntervals ?? DEFAULT_INTERVAL_FAVORITES,
                id
              )
            });
          }}
        />
      </nav>
      <div className="divider" />
      <TerminalIndicatorControls />
      <div className="top-spacer" />
      <div id="install-actions" className="install-actions" hidden>
        <button type="button" id="install-app" className="install-button">
          {t("Установить приложение")}
        </button>
        <a
          className="install-certificate-link"
          href="./android-certificate.html"
          target="_blank"
          rel="noopener"
          aria-label={t("Сертификат Т‑Банка на Android")}
        >
          {t("Сертификат Т‑Банка")}
        </a>
      </div>
      <label className="engine-label" htmlFor="engine">
        {t("График")}
      </label>
      <ChartEngineSelect
        id="engine"
        value={p.engine}
        onChange={(engine) => {
          void controller.setPreferences({ engine });
        }}
      />
      <button
        id="account-button"
        className="account-button"
        title={t("Аккаунт и настройки")}
        onClick={() => controller.setDialog("account")}
      >
        <span className="avatar">{t("Я")}</span>
        <i
          className={`account-connection ${state.status}`}
          aria-label={
            state.authenticated && state.status === "connected"
              ? t("Т-Банк подключён")
              : t("Т-Банк не подключён")
          }
        />
        <span id="account-name">{state.name || t("Аккаунт и источники")}</span>
      </button>
    </header>
  );
}
