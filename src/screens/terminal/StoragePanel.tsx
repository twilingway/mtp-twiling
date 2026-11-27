import { selectStoragePanelState } from "./terminal-state-selection.js";
import { shallowEqual } from "./snapshot-selector.js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HistorySettingsModel, selectedHistory } from "../../model/history-settings.js";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import { useTerminal } from "./context.js";
import { PERIOD_LABELS, number } from "./state.js";
import { StorageHistoryList } from "./StorageHistoryList.js";

function bytes(value: number): string {
  const unit = value >= 1024 * 1024 ? 1024 * 1024 : 1024;
  return (
    new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(value / unit) +
    " " +
    t(unit === 1024 ? "КБ" : "МБ")
  );
}
export function StoragePanel() {
  const { controller, state } = useTerminal(selectStoragePanelState, shallowEqual),
    session = controller.sessionKey(),
    [model] = useState(
      () =>
        new HistorySettingsModel({
          identity: () => ({
            owner: controller.getSnapshot().owner,
            session: controller.sessionKey()
          }),
          blocked: () => {
            const current = controller.getSnapshot();
            return (
              current.owner === "guest" ||
              !!(current.importingBackup || current.importRecoveryRequired || current.backupBusy)
            );
          },
          stats: controller.getStorageStats,
          clear: controller.clearHistory
        })
    ),
    view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    void model.refresh();
  }, [model, state.owner, session]);
  const stats = view.owner === state.owner ? view.stats : null,
    history = stats?.candles,
    groups = history?.groups ?? [],
    ids = [...new Set(groups.map((group) => group.uid))],
    selected = selectedHistory(history ?? null, view.selection),
    blocked =
      view.phase !== "ready" ||
      !!(state.importingBackup || state.importRecoveryRequired || state.backupBusy) ||
      state.owner === "guest",
    label = (uid: string) => {
      const row = state.rows.find((item) => item.uid === uid);
      return row ? `${row.ticker || row.symbol} · ${row.name}` : uid;
    },
    timeframes = [
      ...new Set(
        groups
          .filter((group) => view.selection.uid === "all" || group.uid === view.selection.uid)
          .map((group) => group.timeframe)
      )
    ];
  return (
    <section className="storage-panel" aria-labelledby="history-settings-title">
      <h3 id="history-settings-title">{t("История на этом устройстве")}</h3>
      <p>
        {t(
          "Объём относится к сохранённым свечам текущего профиля. Можно удалить одну группу или явно выбрать все инструменты и интервалы."
        )}
      </p>
      {view.error && (
        <p role="alert">
          {t(
            view.error === "load"
              ? "Не удалось прочитать объём истории. Повторите попытку."
              : view.error === "changed"
                ? "Профиль изменился. Обновите список перед очисткой."
                : "Не удалось очистить историю. Проверьте хранилище и повторите попытку."
          )}
        </p>
      )}
      <div className="storage-summary" id="history-storage-size">
        <div>
          <strong>{history ? bytes(history.bytes) : "—"}</strong>
          <small>{t("История свечей")}</small>
        </div>
        <div>
          <strong>{history ? number(history.bars, 0) : "—"}</strong>
          <small>{t("Свечей")}</small>
        </div>
        <div>
          <strong>{history ? ids.length : "—"}</strong>
          <small>{t("Инструментов")}</small>
        </div>
        <div>
          <strong>{history ? groups.length : "—"}</strong>
          <small>{t("Групп интервалов")}</small>
        </div>
      </div>
      <p className="storage-browser-estimate" id="browser-storage-size">
        {stats ? (
          <>
            {t("Всё приложение в браузере")}:{" "}
            {stats.browser.usage === undefined
              ? t("Оценка недоступна")
              : bytes(stats.browser.usage)}
            {stats.browser.quota ? ` / ${bytes(stats.browser.quota)}` : ""}.{" "}
            {t("Это приблизительная оценка, включая изображения и кэш сайта.")}
          </>
        ) : view.phase === "loading" ? (
          t("Считаем…")
        ) : (
          ""
        )}
      </p>
      <button
        type="button"
        id="refresh-storage"
        disabled={view.phase === "clearing"}
        onClick={() => {
          void model.refresh();
        }}
      >
        {t("Обновить объём")}
      </button>
      <StorageHistoryList
        key={state.owner}
        groups={groups}
        rows={state.rows}
        blocked={blocked}
        bytes={bytes}
        onSelect={(uid, timeframe) => model.select(uid, timeframe)}
      />
      <fieldset className="history-delete-scope" disabled={blocked}>
        <legend>{t("Что очистить")}</legend>
        <label htmlFor="clear-history-instrument">{t("Инструмент")}</label>
        <select
          id="clear-history-instrument"
          value={view.selection.uid}
          onChange={(event) => model.select(event.target.value, "")}
        >
          <option value="">{t("Выберите инструмент")}</option>
          <option value="all">{t("Все инструменты")}</option>
          {ids.map((uid) => (
            <option key={uid} value={uid}>
              {label(uid)}
            </option>
          ))}
        </select>
        <label htmlFor="clear-history-timeframe">{t("Интервал")}</label>
        <select
          id="clear-history-timeframe"
          value={view.selection.timeframe}
          disabled={!view.selection.uid}
          onChange={(event) => model.select(view.selection.uid, event.target.value)}
        >
          <option value="">{t("Выберите интервал")}</option>
          <option value="all">{t("Все таймфреймы")}</option>
          {timeframes.map((timeframe) => (
            <option key={timeframe} value={timeframe}>
              {t(PERIOD_LABELS[timeframe])}
            </option>
          ))}
        </select>
        <p id="history-delete-preview">
          {selected ? (
            <>
              {t("Выбрано")}: {bytes(selected.bytes)} · {number(selected.bars, 0)} {t("свечей")} ·{" "}
              {selected.groups.length} {t("групп")}
            </>
          ) : (
            t("Сначала выберите инструмент и интервал или строку таблицы.")
          )}
        </p>
        <button
          type="button"
          id="clear-history"
          className="danger-button"
          disabled={!selected?.groups.length || !!view.confirmation}
          onClick={() => model.requestClear()}
        >
          {t("Очистить выбранную историю…")}
        </button>
      </fieldset>
      {view.confirmation && (
        <div
          className="history-delete-confirm"
          role="group"
          aria-labelledby="history-confirm-title"
        >
          <h4 id="history-confirm-title">{t("Удалить выбранную историю с устройства?")}</h4>
          <p>
            {view.selection.uid === "all" ? t("Все инструменты") : label(view.selection.uid)} ·{" "}
            {view.selection.timeframe === "all"
              ? t("Все таймфреймы")
              : t(PERIOD_LABELS[view.confirmation.groups[0]!.timeframe])}
          </p>
          <p>
            {bytes(view.confirmation.bytes)} · {number(view.confirmation.bars, 0)} {t("свечей")} ·{" "}
            {view.confirmation.groups.length} {t("групп")}
          </p>
          <p>
            {t(
              "Удалится только история выбранного профиля и её отметки загрузки. Рисунки, изображения, настройки и API-ключ сохранятся. Новые свечи продолжат записываться."
            )}
          </p>
          <div className="settings-actions">
            <button
              type="button"
              id="confirm-clear-history"
              className="danger-button"
              disabled={blocked}
              onClick={() => {
                void model.confirmClear();
              }}
            >
              {view.phase === "clearing" ? t("Очищаем…") : t("Да, удалить выбранную историю")}
            </button>
            <button
              type="button"
              disabled={view.phase === "clearing"}
              onClick={() => model.cancelClear()}
            >
              {t("Отмена")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
