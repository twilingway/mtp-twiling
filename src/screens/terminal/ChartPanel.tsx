import { marketAvailable } from "./market-readiness.js";
import { t, systemText } from "../../i18n/messages.js";
import { memo } from "react";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { precision } from "../../charts/adapter.js";
import { useTerminal } from "./context.js";
import { PERIOD_LABELS, number, signClass } from "./state.js";
import { InstrumentIcon } from "./Watchlist.js";
import { ChartCanvas, ChartGestures } from "./ChartSurface.js";
import { ImageLayer } from "./ImageLayer.js";
import { DrawingAxisLabels } from "./DrawingAxisLabels.js";
import { CandleCountdown } from "./CandleCountdown.js";
import { IndicatorLegend } from "./IndicatorLegend.js";
import { OhlcLegend } from "./OhlcLegend.js";
import { ChartRangeControl } from "./intervals/ChartRangeControl.js";
import { ChartNavigation } from "./ChartNavigation.js";
import { TechnicalIndicatorPanels } from "./TechnicalIndicatorPanels.js";
const Version = memo(function Version() {
  return (
    <span id="app-version" hidden>
      PWA
    </span>
  );
});
export function ChartPanel() {
  const { controller, state } = useTerminal(),
    available = marketAvailable(state),
    p = state.preferences,
    row = selectedMarketRow(state.rows, p),
    barIndex = state.crosshairBar
      ? state.candles.findIndex((bar) => bar.timestamp === state.crosshairBar?.timestamp)
      : state.candles.length - 1,
    bar = state.candles[barIndex] ?? state.crosshairBar ?? undefined,
    digits = row ? precision(row) : 2,
    busy = available && (state.loading || state.importingBackup === true);
  return (
    <section
      id="chart-panel"
      className="chart-panel"
      aria-label={t("График инструмента")}
      aria-busy={busy}
      data-history-loading={busy || undefined}
    >
      <div className="chart-heading">
        <div className="instrument-title">
          {row && <InstrumentIcon key={row.uid ?? row.symbol} row={row} id="chart-icon" />}
          <h1 id="instrument-name">{row?.name ?? (p.symbol || t("Выберите инструмент"))}</h1>
          <span
            className="market-tag"
            title={
              row?.type === "currency"
                ? `${t("Валюта")} · ${
                    row.exchange === "moex_close"
                      ? t("MOEX · данные закрытия")
                      : row.exchange === "dealer_fx_otc"
                        ? t("Дилер · внебиржевой")
                        : (row.classCode ?? row.exchange ?? "MOEX")
                  }`
                : undefined
            }
          >
            {row?.exchange === "dealer_fx_otc" || row?.realExchange === "REAL_EXCHANGE_DEALER"
              ? t("Дилер")
              : row?.providerRef
                ? `Bybit · ${row.productKind === "spot" ? "Spot" : "USDT perpetual"}`
                : "MOEX"}
          </span>
          <span id="chart-period">{t(PERIOD_LABELS[p.timeframe])}</span>
        </div>
        <OhlcLegend
          bar={bar}
          previousClose={state.candles[barIndex - 1]?.close}
          digits={digits}
          settings={p.chartSettings}
        />
        <div className="chart-price">
          <strong id="chart-price">{number(row?.price, digits)}</strong>
          <span id="chart-change" className={signClass(row?.change)}>
            {available
              ? `${number(row?.change, digits, true)} (${number(row?.changePercent, 2, true)}%)${row?.comparisonBasis === "rolling-24h" ? ` · ${t("24ч")}` : ""}`
              : t("Выберите источник котировок")}
          </span>
        </div>
        <IndicatorLegend />
      </div>
      <div className="chart-scroll-host">
        <ChartGestures>
          <ChartCanvas />
          <ImageLayer />
          <DrawingAxisLabels />
          <CandleCountdown />
          <TechnicalIndicatorPanels />
          {(!available ||
            ((!state.candles.length || state.historyViewReady === false) && !state.loading)) && (
            <div className="chart-message" id="chart-message">
              <span className="message-icon">⌃</span>
              <h2>
                {!available
                  ? t("Ваш рынок. Ваш график.")
                  : !state.rows.length
                    ? t("Добавьте инструмент")
                    : state.historyViewReady === false
                      ? t("Не удалось восстановить окно графика")
                      : t("История недоступна")}
              </h2>
              <p>
                {!available
                  ? t("Bybit доступен без ключа. Для российских инструментов подключите Т‑Банк.")
                  : !state.rows.length
                    ? t("Нажмите + в списке котировок, чтобы открыть график.")
                    : systemText(state.historyHelp)}
              </p>
              {!available && (
                <button
                  id="connect-chart"
                  className="primary-button"
                  onClick={() => controller.setDialog("account")}
                >
                  {t("Подключить API")}
                </button>
              )}
              {available && !state.rows.length && (
                <button
                  className="primary-button"
                  onClick={() => controller.setDialog("instruments")}
                >
                  {t("Добавить инструмент")}
                </button>
              )}
              {available && state.rows.length > 0 && (
                <button
                  className="primary-button"
                  onClick={() => {
                    void (
                      state.importRecoveryRequired
                        ? controller.recoverBackup()
                        : controller.loadHistory()
                    ).catch((error: unknown) =>
                      controller.notify(
                        error instanceof Error
                          ? error.message
                          : t("Не удалось восстановить график.")
                      )
                    );
                  }}
                >
                  {state.importRecoveryRequired
                    ? t("Повторить восстановление")
                    : t("Повторить загрузку")}
                </button>
              )}
            </div>
          )}
        </ChartGestures>
      </div>
      <ChartNavigation />
      <ChartRangeControl />
      <Version />
    </section>
  );
}
