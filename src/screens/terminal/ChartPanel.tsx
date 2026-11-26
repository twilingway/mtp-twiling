import { marketAvailable } from "./market-readiness.js";
import { providerLabel } from "./provider-label.js";
import { t, systemText } from "../../i18n/messages.js";
import { memo, useMemo, useState } from "react";
import type { TechnicalSupplementalInputs } from "../../charts/adapter.js";
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
import { useTechnicalPaneMetrics } from "./use-technical-pane-metrics.js";
import { SupplementalStudyStatusContext } from "./SupplementalStudyStatus.js";
import { useOpenInterest } from "./use-open-interest.js";
import { useQuoteTurnover } from "./use-quote-turnover.js";
const Version = memo(function Version() {
  return (
    <span id="app-version" hidden>
      PWA
    </span>
  );
});
export function ChartPanel() {
  const [scrollTop, setScrollTop] = useState(0);
  const { controller, state } = useTerminal(),
    metrics = useTechnicalPaneMetrics(controller),
    price = metrics.find((metric) => metric.key === "price"),
    headingHeight = price ? Math.max(0, price.height - scrollTop - 2) : undefined,
    available = marketAvailable(state),
    p = state.preferences,
    row = selectedMarketRow(state.rows, p),
    barIndex = state.crosshairBar
      ? state.candles.findIndex((bar) => bar.timestamp === state.crosshairBar?.timestamp)
      : state.candles.length - 1,
    bar = state.candles[barIndex] ?? state.crosshairBar ?? undefined,
    digits = row ? precision(row) : 2,
    busy = available && (state.loading || state.importingBackup === true);
  const openInterest = useOpenInterest(controller, state, row);
  const quoteTurnover = useQuoteTurnover(controller, state, row);
  const observations = openInterest.observations;
  const volumeStudies = quoteTurnover.volumeStudies;
  const supplemental = useMemo<TechnicalSupplementalInputs>(
    () => ({
      ...(observations ? { openInterest: observations } : {}),
      ...(volumeStudies ? { volumeStudies } : {})
    }),
    [observations, volumeStudies]
  );
  const studyStatus = { openInterest, quoteTurnover };
  return (
    <section
      id="chart-panel"
      className="chart-panel"
      aria-label={t("График инструмента")}
      aria-busy={busy}
      data-history-loading={busy || undefined}
    >
      <div
        className="chart-heading"
        style={{ maxHeight: headingHeight, visibility: headingHeight === 0 ? "hidden" : undefined }}
      >
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
                ? `${providerLabel(row.providerRef)} · ${row.productKind === "spot" ? "Spot" : "USDT perpetual"}`
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
        <SupplementalStudyStatusContext.Provider value={studyStatus}>
          <IndicatorLegend />
        </SupplementalStudyStatusContext.Provider>
      </div>
      <div
        className="chart-scroll-host"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <ChartGestures>
          <ChartCanvas supplemental={supplemental} />
          <ImageLayer />
          <DrawingAxisLabels />
          <CandleCountdown />
          <SupplementalStudyStatusContext.Provider value={studyStatus}>
            <TechnicalIndicatorPanels metrics={metrics} />
          </SupplementalStudyStatusContext.Provider>
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
                  ? t(
                      "Bybit и OKX доступны без ключа. Для российских инструментов подключите Т‑Банк."
                    )
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
