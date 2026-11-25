import { useTerminal } from "../context.js";
import { ClockZoneControl } from "../ClockZoneControl.js";
import { t } from "../../../i18n/messages.js";
const RANGE_OPTIONS = [
  [1, "1 день"],
  [5, "5 дней"],
  [30, "30 дней"],
  [90, "90 дней"],
  [180, "180 дней"],
  [365, "365 дней"],
  [1825, "1825 дней"],
  [3650, "3650 дней"]
] as const;
/** History lookback is independent of candle interval and camera zoom. */
export function ChartRangeControl() {
  const { controller, state } = useTerminal();
  const days = state.preferences.rangeDays;
  return (
    <div className="chart-range-control">
      <label htmlFor="range">{t("История")}</label>
      <select
        id="range"
        aria-label={t("Период истории")}
        value={days}
        disabled={
          state.loading ||
          state.historyViewReady === false ||
          state.backupBusy ||
          state.importingBackup ||
          state.importRecoveryRequired
        }
        onChange={(event) => {
          const owner = state.owner;
          void controller
            .setPreferences({ rangeDays: Number(event.target.value) })
            .catch((error: unknown) => {
              if (controller.getSnapshot().owner === owner)
                controller.notify(
                  error instanceof Error ? error.message : t("Не удалось восстановить график.")
                );
            });
        }}
      >
        {!RANGE_OPTIONS.some(([value]) => value === days) ? (
          <option value={days}>
            {days} {t("дн.")}
          </option>
        ) : null}
        {RANGE_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </select>
      <span className="chart-range-note">{t("Глубина загрузки")}</span>
      <ClockZoneControl />
    </div>
  );
}
