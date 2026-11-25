import { memo } from "react";
import type { IndicatorKey } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { precision } from "../../charts/adapter.js";
import { useTerminal } from "./context.js";
import { INDICATOR_NAMES, PERIOD_LABELS, number, signClass } from "./state.js";
import { InstrumentIcon } from "./Watchlist.js";
import { ChartCanvas, ChartGestures } from "./ChartSurface.js";
import { ImageLayer } from "./ImageLayer.js";
import { DrawingAxisLabels } from "./DrawingAxisLabels.js";
import { CandleCountdown } from "./CandleCountdown.js";
import { VisibilityIcon } from "./VisibilityIcon.js";
const Version = memo(function Version() {
  return (
    <span id="app-version" hidden>
      PWA
    </span>
  );
});
function IndicatorLegend() {
  const { controller, state } = useTerminal(),
    p = state.preferences;
  return (
    <div
      id="indicator-legend"
      className="indicator-legend"
      aria-label="Индикаторы графика"
      hidden={p.chartSettings.showLegend === false}
    >
      {(Object.entries(INDICATOR_NAMES) as [IndicatorKey, string][])
        .filter(
          ([key]) =>
            key.startsWith("mtp") ||
            key === "volume" ||
            p.indicators[key] ||
            p.chartSettings.indicatorOptions?.[key]
        )
        .map(([key, name]) => (
          <div
            key={key}
            className={`legend-row ${p.indicators[key] ? "" : "legend-hidden"}`}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.setContext({
                x: e.clientX,
                y: e.clientY,
                target: { kind: "indicator", key }
              });
            }}
          >
            <button
              data-legend-indicator={key}
              onClick={() => {
                void controller.toggleIndicator(key);
              }}
              title={`${p.indicators[key] ? "Скрыть" : "Показать"} ${name}`}
            >
              {name}
            </button>
            <button
              data-legend-indicator={key}
              onClick={() => {
                void controller.toggleIndicator(key);
              }}
              aria-label={`${p.indicators[key] ? "Скрыть" : "Показать"} ${name}`}
            >
              <VisibilityIcon hidden={!p.indicators[key]} />
            </button>
          </div>
        ))}
    </div>
  );
}
export function ChartPanel() {
  const { controller, state } = useTerminal(),
    p = state.preferences,
    row = selectedMarketRow(state.rows, p),
    bar = state.crosshairBar
      ? (state.candles.find((bar) => bar.timestamp === state.crosshairBar?.timestamp) ??
        state.crosshairBar)
      : state.candles.at(-1),
    digits = row ? precision(row) : 2;
  return (
    <section className="chart-panel" aria-label="График инструмента">
      <div className="chart-heading">
        <div className="instrument-title">
          {row && <InstrumentIcon key={row.uid ?? row.symbol} row={row} id="chart-icon" />}
          <h1 id="instrument-name">{row?.name ?? (p.symbol || "Выберите инструмент")}</h1>
          <span className="market-tag">MOEX</span>
          <span id="chart-period">{PERIOD_LABELS[p.timeframe]}</span>
        </div>
        <div className="ohlc" id="ohlc">
          ОТКР {number(bar?.open, digits)} МАКС {number(bar?.high, digits)} МИН{" "}
          {number(bar?.low, digits)} ЗАКР {number(bar?.close, digits)}
        </div>
        <div className="chart-price">
          <strong id="chart-price">{number(row?.price, digits)}</strong>
          <span id="chart-change" className={signClass(row?.change)}>
            {state.authenticated
              ? `${number(row?.change, digits, true)} (${number(row?.changePercent, 2, true)}%)`
              : "Подключите личный API-ключ"}
          </span>
        </div>
      </div>
      <ChartGestures>
        <ChartCanvas />
        <IndicatorLegend />
        <ImageLayer />
        <DrawingAxisLabels />
        <CandleCountdown />
        {(!state.authenticated || !state.candles.length) && (
          <div className="chart-message" id="chart-message">
            <span className="message-icon">⌃</span>
            <h2>
              {!state.authenticated
                ? "Ваш рынок. Ваш график."
                : !state.rows.length
                  ? "Добавьте инструмент"
                  : state.loading
                    ? "Загружаем историю"
                    : "История недоступна"}
            </h2>
            <p>
              {!state.authenticated
                ? "Подключите Т‑Инвестиции, чтобы увидеть реальные котировки и историю."
                : !state.rows.length
                  ? "Нажмите + в списке котировок, чтобы открыть график."
                  : state.historyHelp}
            </p>
            {!state.authenticated && (
              <button
                id="connect-chart"
                className="primary-button"
                onClick={() => controller.setDialog("account")}
              >
                Подключить API
              </button>
            )}
            {state.authenticated && !state.rows.length && (
              <button
                className="primary-button"
                onClick={() => controller.setDialog("instruments")}
              >
                Добавить инструмент
              </button>
            )}
          </div>
        )}
      </ChartGestures>
      <Version />
    </section>
  );
}
