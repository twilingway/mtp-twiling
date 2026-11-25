import { selectedMarketRow } from "../../model/selected-instrument.js";
import { t } from "../../i18n/messages.js";
import { memo } from "react";
import type { ChartEngine } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { TerminalIndicatorControls } from "./TerminalIndicatorControls.js";
import { TimeframeMenu } from "./intervals/TimeframeMenu.js";
import { isNativeIntervalId } from "../../model/intervals/registry.js";
import { DERIVED_INTERVAL_UNAVAILABLE } from "../../model/intervals/native-timeframes.js";
import {
  DEFAULT_INTERVAL_FAVORITES,
  toggleIntervalFavorite
} from "../../model/intervals/favorites.js";
const InstallButton = memo(function InstallButton() {
  useTerminal();
  return (
    <button id="install-app" className="install-button" hidden>
      {t("Установить")}
    </button>
  );
});
export function Toolbar() {
  const { controller, state } = useTerminal(),
    p = state.preferences,
    row = selectedMarketRow(state.rows, p);
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
        className="symbol-button"
        id="symbol-button"
        onClick={() => controller.setDialog(state.ready ? "instruments" : "account")}
        title={t("Найти инструмент")}
      >
        <span className="tiny-search">⌕</span>
        <b id="top-symbol">{row?.ticker || t("Инструмент")}</b>
      </button>
      <nav className="timeframes" aria-label={t("Таймфрейм")}>
        <TimeframeMenu
          value={p.timeframe}
          favorites={p.favoriteIntervals ?? DEFAULT_INTERVAL_FAVORITES}
          availability={{
            ...DERIVED_INTERVAL_UNAVAILABLE,
            ...(row?.providerRef
              ? {
                  "2m": "Bybit: интервал пока не поддерживается",
                  "10m": "Bybit: интервал пока не поддерживается"
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
      <InstallButton />
      <label className="engine-label" htmlFor="engine">
        {t("График")}
      </label>
      <select
        id="engine"
        aria-label={t("Библиотека графика")}
        value={p.engine}
        onChange={(e) => {
          void controller.setPreferences({ engine: e.target.value as ChartEngine });
        }}
      >
        <option value="tradingview">TradingView Lightweight</option>
        <option value="kline">KLineChart</option>
      </select>
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
