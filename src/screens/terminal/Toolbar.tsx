import { memo, useState } from "react";
import type { ChartEngine, IndicatorKey, Timeframe } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { INDICATOR_NAMES, PERIOD_LABELS } from "./state.js";
const InstallButton = memo(function InstallButton() {
  return (
    <button id="install-app" className="install-button" hidden>
      Установить
    </button>
  );
});
export function Toolbar() {
  const { controller, state } = useTerminal(),
    p = state.preferences;
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  return (
    <header className="topbar">
      <a className="brand" href="./" aria-label="mtp.twiling.ru">
        <span className="brand-icon">∿</span>
        <span>
          MTP <b>Twiling</b>
        </span>
      </a>
      <div className="divider" />
      <button
        className="symbol-button"
        id="symbol-button"
        onClick={() => controller.setDialog(state.authenticated ? "instruments" : "account")}
        title="Найти инструмент"
      >
        <span className="tiny-search">⌕</span>
        <b id="top-symbol">{p.symbol || "Инструмент"}</b>
      </button>
      <nav className="timeframes" aria-label="Таймфрейм">
        {(Object.keys(PERIOD_LABELS) as Timeframe[]).map((tf) => (
          <button
            key={tf}
            data-timeframe={tf}
            className={tf === p.timeframe ? "active" : ""}
            onClick={() => {
              void controller.setTimeframe(tf);
            }}
          >
            {PERIOD_LABELS[tf]}
          </button>
        ))}
        <select
          id="range"
          aria-label="Период истории"
          value={p.rangeDays}
          onChange={(e) => {
            void controller.setPreferences({ rangeDays: Number(e.target.value) });
          }}
        >
          {[
            [1, "1Д"],
            [5, "5Д"],
            [30, "1М"],
            [90, "3М"],
            [180, "6М"],
            [365, "1Г"],
            [1825, "5Л"]
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </nav>
      <div className="divider" />
      <div className="indicator-control">
        <button
          id="indicators-button"
          className="text-button"
          onClick={() => setIndicatorsOpen(!indicatorsOpen)}
        >
          ⌃ <span>Индикаторы</span>
        </button>
        {indicatorsOpen && (
          <div className="popover" id="indicators-panel">
            <strong>Индикаторы</strong>
            {(Object.entries(INDICATOR_NAMES) as [IndicatorKey, string][]).map(([key, name]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  id={`indicator-${key}`}
                  checked={p.indicators[key]}
                  onChange={() => {
                    void controller.toggleIndicator(key);
                  }}
                />
                {name}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="top-spacer" />
      <InstallButton />
      <label className="engine-label" htmlFor="engine">
        График
      </label>
      <select
        id="engine"
        aria-label="Библиотека графика"
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
        title="Аккаунт и настройки"
        onClick={() => controller.setDialog("account")}
      >
        <span className="avatar">Я</span>
        <i
          className={`account-connection ${state.status}`}
          aria-label={state.status === "connected" ? "Т-Банк подключён" : "Т-Банк не подключён"}
        />
        <span id="account-name">{state.name || "Подключить API"}</span>
      </button>
    </header>
  );
}
