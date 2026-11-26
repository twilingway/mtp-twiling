import { selectedMarketRow } from "../../model/selected-instrument.js";
import { chartLayout } from "../../model/chart-workspace-layout.js";
import { t } from "../../i18n/messages.js";
import { useTerminal } from "./context.js";
import { ChartEngineSelect } from "./ChartEngineSelect.js";
import { ChartLayoutPicker } from "./ChartLayoutPicker.js";
import type { ChartLayoutPickerProps } from "./ChartLayoutPicker.js";
import { publishWorkspaceTimeframe } from "./workspace-sync-controller.js";
import type { TerminalController } from "./controller.js";
import { TerminalFullscreenControl } from "./TerminalFullscreenControl.js";
import { TerminalIndicatorControls } from "./TerminalIndicatorControls.js";
import { MobileChartTools } from "./MobileChartTools.js";
import { TimeframeMenu } from "./intervals/TimeframeMenu.js";
import { isNativeIntervalId } from "../../model/intervals/registry.js";
import { DERIVED_INTERVAL_UNAVAILABLE } from "../../model/intervals/native-timeframes.js";
import {
  DEFAULT_INTERVAL_FAVORITES,
  toggleIntervalFavorite
} from "../../model/intervals/favorites.js";
export function Toolbar({
  layout,
  accountController
}: {
  layout?: ChartLayoutPickerProps;
  accountController?: TerminalController;
} = {}) {
  const { controller, state } = useTerminal(),
    p = state.preferences,
    row = selectedMarketRow(state.rows, p),
    ticker = row?.ticker || t("Инструмент"),
    searchLabel = t("Найти инструмент"),
    shortIntervalUnavailable =
      row?.providerRef?.provider === "okx"
        ? "OKX: интервал пока не поддерживается"
        : "Bybit: интервал пока не поддерживается";
  const account = accountController ?? controller;
  const accountState = account === controller ? state : account.getSnapshot();
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
        onClick={() =>
          state.ready ? controller.setDialog("instruments") : account.setDialog("account")
        }
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
            if (!isNativeIntervalId(id)) return;
            const owner = state.owner;
            void controller
              .setTimeframe(id)
              .then(() => {
                if (controller.getSnapshot().owner === owner)
                  publishWorkspaceTimeframe(controller, id);
              })
              .catch((error: unknown) => {
                if (controller.getSnapshot().owner === owner)
                  controller.notify(
                    error instanceof Error ? error.message : t("Не удалось выполнить действие.")
                  );
              });
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
      {layout && <ChartLayoutPicker {...layout} />}
      <MobileChartTools
        controller={account}
        panelOpen={!!accountState.mobilePanelOpen && !accountState.preferences.rightPanelCollapsed}
        objectsOpen={accountState.objectPanel}
        count={chartLayout(layout?.layoutId)?.count ?? 1}
        layout={layout}
      >
        <TerminalFullscreenControl />
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
      </MobileChartTools>
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
        onClick={() => account.setDialog("account")}
      >
        <span className="avatar">{t("Я")}</span>
        <i
          className={`account-connection ${accountState.status}`}
          aria-label={
            accountState.authenticated && accountState.status === "connected"
              ? t("Т-Банк подключён")
              : t("Т-Банк не подключён")
          }
        />
        <span id="account-name">{accountState.name || t("Аккаунт и источники")}</span>
      </button>
    </header>
  );
}
