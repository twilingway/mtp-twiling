import { marketAvailable } from "./market-readiness.js";
import { providerLabel } from "./provider-label.js";
import { t, systemText } from "../../i18n/messages.js";
import { memo, useMemo, useState } from "react";
import type { TechnicalSupplementalInputs } from "../../charts/adapter.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { precision } from "../../charts/adapter.js";
import { useTerminal } from "./context.js";
import { number, signClass } from "./state.js";
import { InstrumentIcon } from "./Watchlist.js";
import { ChartCanvas, ChartGestures } from "./ChartSurface.js";
import { ChartDemonstration } from "./ChartDemonstration.js";
import { ChartRangeZoom } from "./ChartRangeZoom.js";
import { ImageLayer } from "./ImageLayer.js";
import { DrawingAxisLabels } from "./DrawingAxisLabels.js";
import { SelectedDrawingLock } from "./SelectedDrawingLock.js";
import { CandleCountdown } from "./CandleCountdown.js";
import { IndicatorLegend } from "./IndicatorLegend.js";
import { ohlcDisplayMode } from "../../model/ohlc-legend.js";
import { ChartOhlcMeta } from "./ChartOhlcMeta.js";
import { ChartRangeControl } from "./intervals/ChartRangeControl.js";
import { InlineTimeframeControl } from "./intervals/InlineTimeframeControl.js";
import { ChartNavigation } from "./ChartNavigation.js";
import { TechnicalIndicatorPanels } from "./TechnicalIndicatorPanels.js";
import { useTechnicalPaneMetrics } from "./use-technical-pane-metrics.js";
import { SupplementalStudyStatusContext } from "./SupplementalStudyStatus.js";
import { useOpenInterest } from "./use-open-interest.js";
import { useQuoteTurnover } from "./use-quote-turnover.js";
import { CalendarAnalysisTables } from "./CalendarAnalysisTables.js";
import { useExtraStudyData } from "./use-extra-study-data.js";
import { marketBreadthCoverage } from "../../model/technical-indicators/catalog-expansion/market-breadth.js";
const Version = memo(function Version() {
  return <span id="app-version" hidden />;
});
export function ChartPanel({
  slot = 1,
  active = true,
  activate
}: {
  slot?: number;
  active?: boolean;
  activate?: () => void;
} = {}) {
  const [scrollTop, setScrollTop] = useState(0);
  const drawingProjection = useMemo(() => new EventTarget(), []);
  const { controller, state } = useTerminal(),
    metrics = useTechnicalPaneMetrics(controller),
    price = metrics.find((metric) => metric.key === "price"),
    headingHeight = price ? Math.max(0, price.height - scrollTop - 2) : undefined,
    available = marketAvailable(state),
    p = state.preferences,
    row = selectedMarketRow(state.rows, p),
    ohlcMode = ohlcDisplayMode(p.chartSettings),
    digits = row ? precision(row) : 2,
    busy = available && (state.loading || state.importingBackup === true);
  const openInterest = useOpenInterest(controller, state, row);
  const quoteTurnover = useQuoteTurnover(controller, state, row);
  const extra = useExtraStudyData(controller, state, row);
  const observations = openInterest.observations;
  const volumeStudies = quoteTurnover.volumeStudies;
  const additional = extra.data;
  const supplemental = useMemo<TechnicalSupplementalInputs>(
    () => ({
      ...additional,
      ...(observations ? { openInterest: observations } : {}),
      ...(volumeStudies || additional.volumeStudies
        ? { volumeStudies: { ...volumeStudies, ...additional.volumeStudies } }
        : {})
    }),
    [observations, volumeStudies, additional]
  );
  const breadthInput = additional.marketBreadth;
  const coverage = useMemo(
    () =>
      p.timeframe === "1d" && breadthInput
        ? marketBreadthCoverage(state.candles, breadthInput)
        : undefined,
    [breadthInput, p.timeframe, state.candles]
  );
  const breadthStatus = (metric: keyof NonNullable<typeof coverage>) =>
    ({
      status:
        p.timeframe !== "1d"
          ? "unsupported"
          : !breadthInput
            ? "needs-file"
            : coverage?.[metric]
              ? "ready"
              : "empty",
      ...(breadthInput && { currency: breadthInput.marketId })
    }) as const;
  const studyStatus = {
    openInterest,
    quoteTurnover,
    priceTarget: extra.priceTarget,
    intrabarVolume: extra.intrabarVolume,
    netVolume: extra.netVolume,
    priceLevel: extra.priceLevel,
    correlation: extra.correlation,
    marketBreadth: {
      line: breadthStatus("line"),
      ratio: breadthStatus("ratio"),
      cvi: breadthStatus("cvi")
    }
  };
  return (
    <section
      id={slot === 1 ? "chart-panel" : `chart-panel-${slot}`}
      className="chart-panel"
      aria-label={slot === 1 ? t("График инструмента") : `${t("График инструмента")} ${slot}`}
      aria-busy={busy}
      data-history-loading={busy || undefined}
      data-chart-slot={slot === 1 ? slot : undefined}
      data-chart-active={slot === 1 ? active : undefined}
      onPointerDownCapture={activate}
      onFocusCapture={activate}
      onContextMenuCapture={activate}
    >
      <div
        className="chart-heading"
        data-grid-depth="true"
        style={{
          maxHeight: headingHeight,
          visibility: headingHeight === 0 ? "hidden" : undefined,
          ...(price?.width && { width: price.width, right: "auto" })
        }}
      >
        <div className="chart-instrument-heading">
          <div className="instrument-title">
            <button
              type="button"
              className="chart-instrument-button"
              aria-haspopup="dialog"
              aria-label={`${t("Инструмент графика")} ${slot} · ${row?.ticker ?? t("Найти инструмент")}`}
              onClick={() =>
                controller.setDialog(slot === 1 && !state.ready ? "account" : "instruments")
              }
            >
              {row && (
                <InstrumentIcon
                  key={row.uid ?? row.symbol}
                  row={row}
                  {...(slot === 1 ? { id: "chart-icon" } : {})}
                />
              )}
              <span id={slot === 1 ? "instrument-name" : undefined}>
                {row?.name ?? (p.symbol || t("Выберите инструмент"))}
              </span>
            </button>
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
            <InlineTimeframeControl slot={slot} provider={row?.providerRef?.provider} />
            <SelectedDrawingLock />
            {ohlcMode === "icon" && <ChartOhlcMeta />}
          </div>
          <ChartRangeControl slot={slot} placement="plot" />
        </div>
        {ohlcMode === "corner" && <ChartOhlcMeta />}
        <div className="chart-price">
          <strong id={slot === 1 ? "chart-price" : undefined}>{number(row?.price, digits)}</strong>
          <span id={slot === 1 ? "chart-change" : undefined} className={signClass(row?.change)}>
            {available
              ? `${number(row?.change, digits, true)} (${number(row?.changePercent, 2, true)}%)${row?.comparisonBasis === "rolling-24h" ? ` · ${t("24ч")}` : ""}`
              : t("Выберите источник котировок")}
          </span>
        </div>
        <SupplementalStudyStatusContext.Provider value={studyStatus}>
          <IndicatorLegend slot={slot} />
        </SupplementalStudyStatusContext.Provider>
      </div>
      <div
        className="chart-scroll-host"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <ChartGestures drawingProjection={drawingProjection}>
          <ChartCanvas
            slot={slot}
            supplemental={supplemental}
            drawingProjection={drawingProjection}
          />
          <ChartDemonstration active={active} />
          <ChartRangeZoom active={active} />
          <CalendarAnalysisTables
            tables={extra.calendar.tables}
            refresh={extra.calendar.refresh}
            {...(p.locale ? { locale: p.locale } : {})}
          />
          <ImageLayer drawingProjection={drawingProjection} />
          <DrawingAxisLabels drawingProjection={drawingProjection} />
          <CandleCountdown drawingProjection={drawingProjection} />
          <SupplementalStudyStatusContext.Provider value={studyStatus}>
            <TechnicalIndicatorPanels metrics={metrics} />
          </SupplementalStudyStatusContext.Provider>
          {slot > 1 && !row && (
            <div className="auxiliary-chart-empty chart-message">
              <button
                type="button"
                className="primary-button"
                onClick={() => controller.setDialog("instruments")}
              >
                {t("Выберите инструмент")}
              </button>
            </div>
          )}
          {(slot === 1 || row) &&
            (!available ||
              ((!state.candles.length || state.historyViewReady === false) && !state.loading)) && (
              <div className="chart-message" id={slot === 1 ? "chart-message" : undefined}>
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
                {!available && slot === 1 && (
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
      {slot === 1 && <ChartNavigation />}
      {slot === 1 && <Version />}
    </section>
  );
}
