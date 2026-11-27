import { ToolbarScroll } from "./ToolbarScroll.js";
import { t } from "../../i18n/messages.js";
import { useTerminal, useTerminalState } from "./context.js";
import { selectControlsState, selectToolbarState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";
import { NativeChartTypeMenu } from "./NativeChartTypeMenu.js";
import { ChartLayoutPicker } from "./ChartLayoutPicker.js";
import type { ChartLayoutPickerProps } from "./ChartLayoutPicker.js";
import { publishWorkspaceTimeframe } from "./workspace-sync-controller.js";
import type { TerminalController } from "./controller.js";
import { TerminalBrandMenu } from "./TerminalBrandMenu.js";
import { TerminalFullscreenControl } from "./TerminalFullscreenControl.js";
import { TerminalIndicatorControls } from "./TerminalIndicatorControls.js";
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
  const { controller, state } = useTerminal(selectToolbarState, shallowEqual),
    p = state.preferences,
    ticker = state.selectedTicker || t("Инструмент"),
    searchLabel = t("Найти инструмент"),
    shortIntervalUnavailable =
      state.selectedProvider === "okx"
        ? "OKX: интервал пока не поддерживается"
        : "Bybit: интервал пока не поддерживается";
  const account = accountController ?? controller;
  const accountState = useTerminalState(account, selectControlsState, shallowEqual);
  return (
    <header className="topbar">
      <ToolbarScroll>
        <TerminalBrandMenu account={account} accountState={accountState} editor={controller}>
          {() => (
            <>
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
            </>
          )}
        </TerminalBrandMenu>
        <div className="divider" />
        <div className="chart-symbol-controls">
          <button
            type="button"
            className="symbol-button"
            id="symbol-button"
            aria-haspopup="dialog"
            aria-label={`${ticker} · ${searchLabel}`}
            onClick={() =>
              state.ready ? controller.setDialog("instruments") : account.setDialog("account")
            }
            title={`${ticker} · ${searchLabel}`}
          >
            <b id="top-symbol">{ticker}</b>
          </button>
          <NativeChartTypeMenu />
        </div>
        <nav className="timeframes" aria-label={t("Таймфрейм")}>
          <TimeframeMenu
            value={p.timeframe}
            favorites={p.favoriteIntervals ?? DEFAULT_INTERVAL_FAVORITES}
            availability={{
              ...DERIVED_INTERVAL_UNAVAILABLE,
              ...(state.selectedProvider
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
        <TerminalFullscreenControl />
      </ToolbarScroll>
    </header>
  );
}
