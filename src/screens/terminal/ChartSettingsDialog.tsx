import { t } from "../../i18n/messages.js";
import { useState } from "react";
import type { ChartEngine, ChartSettings } from "../../model/types.js";
import { useTerminal } from "./context.js";
import { INDICATOR_NAMES } from "./state.js";
import { Modal } from "./Modal.js";
import { TRADINGVIEW_CANDLE_STYLE } from "../../model/candle-palette.js";
import { chartBackground, terminalTheme, withTheme } from "../../model/theme.js";
import { TimeZonePicker } from "./ClockZoneControl.js";
import { ChartEngineSelect } from "./ChartEngineSelect.js";
import type { Locale } from "../../i18n/preferences.js";

const CANDLE_PARTS = [
  ["bodyVisible", "Тело свечи", "upColor", "downColor"],
  ["borderVisible", "Границы", "borderUpColor", "borderDownColor"],
  ["wickVisible", "Фитили", "wickUpColor", "wickDownColor"]
] as const;
export function ChartSettingsDialog() {
  const { controller, state } = useTerminal(),
    [settings, setSettings] = useState<ChartSettings>({ ...state.preferences.chartSettings });
  const [locale, setLocale] = useState<Locale>(state.preferences.locale ?? "ru");
  const [timeZone, setTimeZone] = useState(state.preferences.timeZone ?? "Europe/Moscow");
  const [engine, setEngine] = useState<ChartEngine>();
  const update = (patch: ChartSettings) => setSettings((previous) => ({ ...previous, ...patch }));
  return (
    <Modal
      id="chart-settings-dialog"
      title={t("Настройки графика")}
      onClose={() => controller.setDialog(null)}
    >
      <form
        id="chart-settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const engineUpdate = engine && engine !== state.preferences.engine ? { engine } : {};
          void controller
            .setPreferences({ ...engineUpdate, locale, timeZone, chartSettings: settings })
            .then(() => controller.setDialog(null));
        }}
      >
        <div className="display-preferences">
          <label htmlFor="chart-settings-engine">
            {t("Библиотека графика")}
            <ChartEngineSelect
              id="chart-settings-engine"
              value={engine ?? state.preferences.engine}
              onChange={setEngine}
            />
          </label>
          <label>
            {t("Язык")}
            <select
              name="locale"
              value={locale}
              onChange={(event) => setLocale(event.target.value === "en" ? "en" : "ru")}
            >
              <option value="ru">{t("Русский")}</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>{t("Часовой пояс")}</label>
          <TimeZonePicker
            value={timeZone}
            locale={locale}
            now={controller.marketNow()}
            onChange={setTimeZone}
          />
        </div>
        <h3>{t("Инструмент")}</h3>
        {CANDLE_PARTS.map(([visible, label, up, down]) => (
          <div className="drawing-style-row" key={visible}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name={visible}
                checked={settings[visible] !== false}
                onChange={(e) => update({ [visible]: e.target.checked })}
              />
              {t(label)}
            </label>
            <label>
              {t("Рост")}
              <input
                type="color"
                name={up}
                value={settings[up] ?? TRADINGVIEW_CANDLE_STYLE[up]}
                onChange={(e) => update({ [up]: e.target.value })}
              />
            </label>
            <label>
              {t("Падение")}
              <input
                type="color"
                name={down}
                value={settings[down] ?? TRADINGVIEW_CANDLE_STYLE[down]}
                onChange={(e) => update({ [down]: e.target.value })}
              />
            </label>
          </div>
        ))}
        <button type="button" onClick={() => update(TRADINGVIEW_CANDLE_STYLE)}>
          {t("Цвета как в вашем TradingView")}
        </button>
        <h3>{t("Оформление")}</h3>
        <label>
          {t("Тема интерфейса")}
          <select
            name="theme"
            value={terminalTheme(settings)}
            onChange={(e) =>
              setSettings((previous) =>
                withTheme(previous, e.target.value === "light" ? "light" : "dark")
              )
            }
          >
            <option value="dark">{t("Тёмная")}</option>
            <option value="light">{t("Светлая")}</option>
          </select>
        </label>
        <label>
          {t("Фон")}
          <input
            type="color"
            name="background"
            value={chartBackground(settings)}
            onChange={(e) => update({ background: e.target.value })}
          />
        </label>
        {(
          [
            ["grid", t("Линии сетки")],
            ["showLegend", t("Названия индикаторов")],
            ["priceLine", t("Линия последней цены")],
            ["showCandleCountdown", t("Отсчёт до закрытия свечи")]
          ] as const
        ).map(([key, label]) => (
          <label className="checkbox-label" key={key}>
            <input
              type="checkbox"
              name={key}
              checked={settings[key] !== false}
              onChange={(e) => update({ [key]: e.target.checked })}
            />
            {t(label)}
          </label>
        ))}
        <label>
          {t("Размер шрифта шкал")}
          <select
            name="scaleFontSize"
            value={settings.scaleFontSize ?? 11}
            onChange={(e) => update({ scaleFontSize: Number(e.target.value) })}
          >
            {[10, 11, 12, 13, 14].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <footer>
          <button type="button" onClick={() => controller.setDialog(null)}>
            {t("Отмена")}
          </button>
          <button className="primary-button">{t("Ок")}</button>
        </footer>
      </form>
    </Modal>
  );
}
export function IndicatorSettingsDialog() {
  const { controller, state } = useTerminal(),
    key = state.editingIndicator,
    previous = state.preferences.chartSettings.indicatorOptions?.[key],
    [color, setColor] = useState(
      previous?.color ?? (key.startsWith("mtp") ? "#1e90ff" : key === "ma" ? "#ddad56" : "#7b8fff")
    ),
    [width, setWidth] = useState(previous?.width ?? 1),
    [opacity, setOpacity] = useState(previous?.opacity ?? (key.startsWith("mtp") ? 0.65 : 1));
  return (
    <Modal
      id="indicator-settings-dialog"
      title={t(INDICATOR_NAMES[key])}
      onClose={() => controller.setDialog(null)}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void controller
            .setChartSettings({
              indicatorOptions: {
                ...state.preferences.chartSettings.indicatorOptions,
                [key]: { color, width, opacity }
              }
            })
            .then(() => controller.setDialog(null));
        }}
      >
        <p>{t("Источник: закрытие свечи (Close)")}</p>
        <label>
          {t("Цвет линии")}
          <input
            name="color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          {t("Толщина")}
          <select name="width" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Прозрачность:")}
          {Math.round((1 - opacity) * 100)}%
          <input
            name="transparency"
            type="range"
            min="0"
            max="100"
            value={Math.round((1 - opacity) * 100)}
            onChange={(e) => setOpacity(1 - Number(e.target.value) / 100)}
          />
        </label>
        <footer>
          <button type="button" onClick={() => controller.setDialog(null)}>
            {t("Отмена")}
          </button>
          <button className="primary-button">{t("Ок")}</button>
        </footer>
      </form>
    </Modal>
  );
}
