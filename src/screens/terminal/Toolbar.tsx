import { t } from "../../i18n/messages.js";
import { memo, useState } from "react";
import type { ChartEngine, IndicatorKey } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { INDICATOR_NAMES } from "./state.js";
import { MtpIndicatorGroup } from "./MtpIndicatorGroup.js";
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
    p = state.preferences;
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
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
        onClick={() => controller.setDialog(state.authenticated ? "instruments" : "account")}
        title={t("Найти инструмент")}
      >
        <span className="tiny-search">⌕</span>
        <b id="top-symbol">{p.symbol || t("Инструмент")}</b>
      </button>
      <nav className="timeframes" aria-label={t("Таймфрейм")}>
        <TimeframeMenu
          value={p.timeframe}
          favorites={p.favoriteIntervals ?? DEFAULT_INTERVAL_FAVORITES}
          availability={DERIVED_INTERVAL_UNAVAILABLE}
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
      <div className="indicator-control">
        <button
          id="indicators-button"
          aria-label={t("Индикаторы")}
          className="text-button"
          onClick={() => setIndicatorsOpen(!indicatorsOpen)}
        >
          ⌃ <span>{t("Индикаторы")}</span>
        </button>
        {indicatorsOpen && (
          <div className="popover" id="indicators-panel">
            <strong>{t("Индикаторы")}</strong>
            <MtpIndicatorGroup
              flags={p.indicators}
              onToggle={(key) => {
                void controller.toggleIndicator(key);
              }}
            />
            {(Object.entries(INDICATOR_NAMES) as [IndicatorKey, string][])
              .filter(([key]) => !key.startsWith("mtp"))
              .map(([key, name]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    id={`indicator-${key}`}
                    checked={!!p.indicators[key]}
                    onChange={() => {
                      void controller.toggleIndicator(key);
                    }}
                  />
                  {t(name)}
                </label>
              ))}
          </div>
        )}
      </div>
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
            state.status === "connected" ? t("Т-Банк подключён") : t("Т-Банк не подключён")
          }
        />
        <span id="account-name">{state.name || t("Подключить API")}</span>
      </button>
    </header>
  );
}
